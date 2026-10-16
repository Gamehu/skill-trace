import fs from 'node:fs/promises'
import path from 'node:path'
import { PROJECTS_DIR, RUNNING_GRACE_MS } from './config.ts'
import type { FileChange, HumanKind, RunDetail, RunStatus, RunTrigger, TokenUsage, ToolKind, TraceEvent } from './types.ts'

export interface ParsedSession {
  id: string
  file: string
  project: string
  cwd: string | null
  mtimeMs: number
  size: number
  runs: RunDetail[]
}

type ToolEvent = Extract<TraceEvent, { type: 'tool' }>

const MAX_TEXT = 20_000
const SKILL_LOADED_PREFIX = 'Base directory for this skill:'

// Cheap pre-check so transcripts without any skill activity are never JSON-parsed.
const SKILL_MARKERS = ['"name":"Skill"', SKILL_LOADED_PREFIX]

export function toolKind(name: string): ToolKind {
  if (name.startsWith('mcp__')) return 'mcp'
  switch (name) {
    case 'Read':
    case 'Grep':
    case 'Glob':
    case 'LS':
    case 'NotebookRead':
      return 'read'
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return 'write'
    case 'Bash':
    case 'BashOutput':
    case 'KillShell':
    case 'PowerShell':
    case 'Monitor':
      return 'exec'
    case 'WebFetch':
    case 'WebSearch':
      return 'web'
    case 'Agent':
    case 'Task':
    case 'SendMessage':
      return 'agent'
    default:
      return 'other'
  }
}

function clip(s: string, max = MAX_TEXT) {
  return s.length > max ? `${s.slice(0, max)}\n… (${s.length - max} more characters)` : s
}

function relPath(p: unknown, cwd: string | null) {
  if (typeof p !== 'string') return ''
  if (cwd && p.startsWith(cwd + path.sep)) return p.slice(cwd.length + 1)
  return p
}

function summarize(name: string, input: Record<string, unknown>, cwd: string | null): string {
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  switch (name) {
    case 'Bash':
      return str('description') || str('command')
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return relPath(input.file_path ?? input.notebook_path, cwd)
    case 'Grep':
      return [str('pattern'), relPath(input.path, cwd)].filter(Boolean).join('  in ')
    case 'Glob':
      return str('pattern')
    case 'WebFetch':
      return str('url')
    case 'WebSearch':
      return str('query')
    case 'Agent':
    case 'Task':
      return str('description') || str('prompt')
    case 'Skill':
      return str('skill')
  }
  const first = Object.values(input).find((v) => typeof v === 'string' && v.length > 0)
  return typeof first === 'string' ? first : ''
}

function blockText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return content == null ? '' : JSON.stringify(content, null, 2)
  return content
    .map((b) => {
      if (b?.type === 'text') return b.text as string
      if (b?.type === 'image') return '[image]'
      if (b?.type === 'tool_reference') return `[tool: ${b.tool_name}]`
      return JSON.stringify(b)
    })
    .join('\n')
}

function firstLine(s: string, max = 240) {
  const line = s.trim().split('\n').find((l) => l.trim()) ?? ''
  return line.length > max ? `${line.slice(0, max)}…` : line
}

/** The person's words without the tags Claude Code wraps around pasted content. */
function promptText(text: string): string {
  return text.replace(/<\/?pasted[^>]*>/g, '').trim()
}

/** Turns a user turn into a one-line label; system-generated turns get a readable description. */
export function promptLabel(text: string): string {
  if (text.startsWith('<task-notification>')) return 'Background task finished'
  // Pasted content arrives wrapped in tags (e.g. <pasted_content id=…>); show the content itself.
  return firstLine(text.replace(/<\/?pasted[^>]*>/g, ''), 400)
}

interface Builder {
  run: RunDetail
  msgIds: Set<string>
  lastTs: number
  endTurn: boolean
  /** Raw inputs of file-writing tool calls, for the outcome's file list. */
  writes: Map<string, Record<string, unknown>>
}

type AskEvent = Extract<TraceEvent, { type: 'ask' }>
type PlanEvent = Extract<TraceEvent, { type: 'plan' }>

function emptyUsage(): TokenUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
}

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const REJECTED = /doesn't want to proceed|tool use was rejected|user rejected|declined to answer/i

/** The reason a person typed when declining, if any ("…the user said:\n<reason>"). */
function rejectionReason(text: string): string {
  return text.match(/the user said:\s*([\s\S]+)$/i)?.[1].trim() ?? ''
}

/** Whether Claude's last words before stopping read as a question to the person. */
export function asksForInput(text: string): boolean {
  const tail = text.trim().slice(-400)
  if (/[?？]\s*[)）*_`]*\s*$/.test(tail)) return true
  return /请确认|确认一下|是否|要不要|需要我|你想|您想|请选择|选哪|哪一个|哪个方案|可以吗|好吗|继续吗|告诉我|should i\b|would you like|do you want|which (one|option)|let me know|please confirm|shall i\b/i.test(tail)
}

/** Short replies that only make sense as an answer to what came before ("ok", "确认", "2"). */
export function isShortAnswer(text: string): boolean {
  const t = text.trim()
  if (t.length > 24) return false
  return /^(y|yes|yep|yeah|ok|okay|sure|go|go ahead|continue|proceed|lgtm|do it|好|好的|行|可以|确认|确定|继续|是|是的|对|对的|没问题|同意|就这样|嗯|开始|执行|选?\s*[0-9a-dA-D一二三四]|方案\s*[0-9a-dA-D一二三四]|第?\s*[0-9一二三四]\s*个?)[\s。.!！,，~]*$/i.test(t)
}

function countLines(s: string) {
  return s ? s.split('\n').length : 0
}

/** Line counts after trimming the lines both sides share at the start and end. */
function lineDelta(before: string, after: string): [number, number] {
  const a = before ? before.split('\n') : []
  const b = after ? after.split('\n') : []
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  let j = 0
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++
  return [b.length - i - j, a.length - i - j]
}

function fileChanges(run: RunDetail, writes: Map<string, Record<string, unknown>>, cwd: string | null): FileChange[] {
  const byPath = new Map<string, FileChange>()
  for (const e of run.events) {
    if (e.type !== 'tool' || !WRITE_TOOLS.has(e.name) || e.isError || e.end === null) continue
    const input = writes.get(e.id)
    if (!input) continue
    const p = relPath(input.file_path ?? input.notebook_path, cwd)
    if (!p) continue
    const edits: { old: string; new: string }[] = []
    if (e.name === 'Write') edits.push({ old: '', new: String(input.content ?? '') })
    else if (e.name === 'MultiEdit' && Array.isArray(input.edits))
      for (const ed of input.edits) edits.push({ old: String(ed?.old_string ?? ''), new: String(ed?.new_string ?? '') })
    else if (e.name === 'NotebookEdit') edits.push({ old: '', new: String(input.new_source ?? '') })
    else edits.push({ old: String(input.old_string ?? ''), new: String(input.new_string ?? '') })

    const fc = byPath.get(p) ?? { path: p, op: e.name === 'Write' && /created/i.test(e.output ?? '') ? 'create' : 'edit', additions: 0, deletions: 0, edits: [] }
    for (const ed of edits) {
      const [add, del] = e.name === 'Write' ? [countLines(ed.new), 0] : lineDelta(ed.old, ed.new)
      fc.additions += add
      fc.deletions += del
      fc.edits.push({ old: clip(ed.old, 12_000), new: clip(ed.new, 12_000) })
    }
    byPath.set(p, fc)
  }
  return [...byPath.values()]
}

/** The skill's conclusion: text Claude wrote after its last action, or its last words if it ended on an action. */
function finalText(events: TraceEvent[]): string | null {
  let lastAction = -1
  events.forEach((e, i) => {
    if (e.type !== 'text' && e.type !== 'thinking') lastAction = i
  })
  const after = events.slice(lastAction + 1).filter((e) => e.type === 'text')
  const texts = after.length ? after : events.filter((e) => e.type === 'text').slice(-1)
  return texts.length ? texts.map((e) => (e.type === 'text' ? e.text : '')).join('\n\n') : null
}

function plainSummary(md: string | null): string | null {
  if (!md) return null
  const lines = md
    .split('\n')
    .filter((l) => !/^\s*\|/.test(l) && !/^\s*(-{3,}|```)/.test(l)) // tables, rules, fences
    .map((l) =>
      l
        .replace(/^\s*(#+|[-*>]|\d+\.)\s+/, '')
        .replace(/\*\*|__|`/g, '')
        .replace(/(^|\s)[*_](?=\S)|(?<=\S)[*_](?=\s|$)/g, '$1')
        .trim(),
    )
    .filter(Boolean)
  const s = lines.slice(0, 3).join(' · ')
  return s.length > 280 ? `${s.slice(0, 280)}…` : s || null
}

export function parseTranscript(
  raw: string,
  meta: { sessionId: string; project: string; mtimeMs: number; now?: number },
): { runs: RunDetail[]; cwd: string | null } {
  const now = meta.now ?? Date.now()
  const runs: RunDetail[] = []
  const pending = new Map<string, ToolEvent>()
  const pendingAsk = new Map<string, AskEvent | PlanEvent>()
  let cwd: string | null = null
  let lastPrompt: string | null = null
  let lastInput: string | null = null
  let model: string | null = null
  let active: Builder | null = null
  const fresh = now - meta.mtimeMs < RUNNING_GRACE_MS

  const lastText = (b: Builder) => {
    for (let i = b.run.events.length - 1; i >= 0; i--) {
      const e = b.run.events[i]
      if (e.type === 'text') return e.text
      if (e.type !== 'thinking') return null
    }
    return null
  }

  const finish = (status?: RunStatus) => {
    if (!active) return
    const { run } = active
    const ends = run.events.map((e) => (e.type === 'tool' ? (e.end ?? e.start) : 'answeredAt' in e ? (e.answeredAt ?? e.at) : e.at))
    run.endedAt = Math.max(run.startedAt, active.lastTs, ...ends)
    const last = run.events[run.events.length - 1]
    const openQuestion = run.events.some((e) => (e.type === 'ask' || e.type === 'plan') && e.answeredAt === null)
    if (status) run.status = status
    else if (last?.type === 'human' && last.kind === 'interrupt') run.status = 'interrupted'
    else if (openQuestion) run.status = fresh ? 'waiting' : 'interrupted'
    else if (active.endTurn) run.status = fresh && asksForInput(lastText(active) ?? '') ? 'waiting' : 'done'
    else run.status = fresh ? 'running' : 'interrupted'

    run.outcome = { text: finalText(run.events), files: fileChanges(run, active.writes, cwd) }
    const open = run.events.find((e) => (e.type === 'ask' || e.type === 'plan') && e.answeredAt === null)
    run.result =
      run.status === 'waiting' && open
        ? open.type === 'ask'
          ? (open.questions[0]?.question ?? 'A question is waiting for you')
          : 'A plan is waiting for your approval'
        : plainSummary(run.outcome.text)
    run.filesChanged = run.outcome.files.length
    run.humanTurns = run.events.filter((e) => e.type === 'ask' || e.type === 'plan' || e.type === 'human').length
    // Slash commands without a loaded skill (e.g. /clear) are not skill runs.
    if (run.trigger === 'model' || run.baseDir) runs.push(run)
    active = null
  }

  const start = (id: string, skill: string, args: string | null, trigger: RunTrigger, ts: number) => {
    finish()
    active = {
      run: {
        id,
        skill,
        skillId: null,
        args,
        trigger,
        status: 'running',
        sessionId: meta.sessionId,
        project: meta.project,
        cwd,
        prompt: trigger === 'slash' ? `/${skill}${args ? ` ${args}` : ''}` : lastPrompt,
        input: trigger === 'slash' ? (args ?? null) : lastInput,
        startedAt: ts,
        endedAt: ts,
        toolCalls: 0,
        errors: 0,
        tokens: emptyUsage(),
        shape: [],
        result: null,
        humanTurns: 0,
        filesChanged: 0,
        outcome: { text: null, files: [] },
        baseDir: null,
        loaded: null,
        model,
        events: [],
      },
      msgIds: new Set(),
      lastTs: ts,
      endTurn: false,
      writes: new Map(),
    }
    return active
  }

  const human = (b: Builder, ts: number, kind: HumanKind, text: string, tool?: string) => {
    b.run.events.push({ type: 'human', id: `h${b.run.events.length}-${ts}`, at: ts, kind, text: clip(text, 4000), ...(tool ? { tool } : {}) })
    b.lastTs = Math.max(b.lastTs, ts)
  }

  for (const line of raw.split('\n')) {
    if (!line) continue
    let rec: any
    try {
      rec = JSON.parse(line)
    } catch {
      continue // a partially written last line
    }
    if (rec.isSidechain) continue
    if (typeof rec.cwd === 'string' && !cwd) cwd = rec.cwd
    const ts = Date.parse(rec.timestamp)
    if (Number.isNaN(ts)) continue
    const b = active as Builder | null

    // Messages typed while Claude is working are delivered mid-turn as queued commands.
    if (rec.type === 'attachment' && rec.attachment?.type === 'queued_command') {
      const a = rec.attachment
      if (b && a.origin?.kind === 'human' && typeof a.prompt === 'string' && a.prompt.trim()) human(b, ts, 'steer', a.prompt.trim())
      continue
    }

    if (rec.type === 'user' && rec.message) {
      const content = rec.message.content
      const blocks: any[] = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : []

      for (const block of blocks) {
        if (block.type !== 'tool_result') continue
        const resultText = blockText(block.content)
        const ask = pendingAsk.get(block.tool_use_id)
        if (ask) {
          pendingAsk.delete(block.tool_use_id)
          ask.answeredAt = ts
          const declined = block.is_error === true || REJECTED.test(resultText)
          if (ask.type === 'ask') {
            ask.declined = declined
            const answers = rec.toolUseResult?.answers
            if (answers && typeof answers === 'object') ask.answers = Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, String(v)]))
            else if (!declined) {
              const pairs = [...resultText.matchAll(/"([^"]+)"="([^"]*)"/g)].map((m) => [m[1], m[2]])
              ask.answers = pairs.length ? Object.fromEntries(pairs) : null
            }
          } else {
            ask.approved = !declined
            ask.feedback = declined ? rejectionReason(resultText) || null : null
          }
          if (b) b.lastTs = Math.max(b.lastTs, ts)
          continue
        }
        const ev = pending.get(block.tool_use_id)
        if (!ev) continue
        pending.delete(block.tool_use_id)
        ev.end = ts
        ev.output = clip(resultText)
        ev.isError = block.is_error === true
        if (b && ev.isError && REJECTED.test(resultText)) human(b, ts, 'reject', rejectionReason(resultText), ev.name)
        else if (ev.isError && b) b.run.errors++
        if (b) b.lastTs = Math.max(b.lastTs, ts)
      }

      const text = blocks
        .filter((x) => x.type === 'text')
        .map((x) => x.text as string)
        .join('\n')
      if (!text) continue

      if (text.startsWith(SKILL_LOADED_PREFIX)) {
        if (b && !b.run.baseDir) {
          const [first, ...rest] = text.slice(SKILL_LOADED_PREFIX.length).split('\n')
          b.run.baseDir = first.trim()
          b.run.loaded = clip(rest.join('\n').trim())
        }
        continue
      }
      const command = text.match(/<command-name>\/?([^<\s]+)<\/command-name>/)
      if (command) {
        const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1].trim() || null
        start(rec.uuid ?? `${meta.sessionId}-${ts}`, command[1], args, 'slash', ts)
        continue
      }
      if (rec.isMeta || text.startsWith('<local-command') || text.startsWith('<system-reminder>')) continue
      if (text.startsWith('[Request interrupted by user')) {
        if (b) human(b, ts, 'interrupt', '')
        continue
      }
      // A person's message stays in the run when it answers the skill: Claude had just asked something,
      // the reply is a bare "ok"/"2", or Claude was mid-work (steering after an interruption).
      if (b && !text.startsWith('<task-notification>')) {
        const last = b.run.events[b.run.events.length - 1]
        const interrupted = last?.type === 'human' && last.kind === 'interrupt'
        if (interrupted || !b.endTurn || asksForInput(lastText(b) ?? '') || isShortAnswer(text)) {
          human(b, ts, b.endTurn ? 'reply' : 'steer', promptText(text))
          b.endTurn = false
          continue
        }
      }
      // Otherwise a new turn closes whatever skill run was in progress.
      finish()
      lastPrompt = promptLabel(text)
      lastInput = clip(promptText(text), 8000)
      continue
    }

    if (rec.type === 'assistant' && rec.message) {
      const msg = rec.message
      if (typeof msg.model === 'string' && msg.model !== '<synthetic>') model = msg.model
      for (const block of Array.isArray(msg.content) ? msg.content : []) {
        if (block.type === 'tool_use' && block.name === 'Skill') {
          const input = block.input ?? {}
          const skill = String(input.skill ?? input.command ?? 'unknown')
          const args = typeof input.args === 'string' && input.args ? input.args : null
          const nb: Builder = start(block.id, skill, args, 'model', ts)
          nb.msgIds.add(msg.id) // usage of the invoking message belongs to what came before
          continue
        }
        const cur = active as Builder | null
        if (!cur) continue
        cur.lastTs = Math.max(cur.lastTs, ts)
        const input = block.input && typeof block.input === 'object' ? block.input : {}
        if (block.type === 'tool_use' && block.name === 'AskUserQuestion') {
          const questions = (Array.isArray(input.questions) ? input.questions : []).map((q: any) => ({
            question: String(q?.question ?? ''),
            header: typeof q?.header === 'string' ? q.header : null,
            multiSelect: q?.multiSelect === true,
            options: (Array.isArray(q?.options) ? q.options : []).map((o: any) => ({
              label: String(o?.label ?? ''),
              description: typeof o?.description === 'string' ? o.description : null,
            })),
          }))
          const ev: AskEvent = { type: 'ask', id: block.id, at: ts, answeredAt: null, questions, answers: null, declined: false }
          pendingAsk.set(block.id, ev)
          cur.run.events.push(ev)
        } else if (block.type === 'tool_use' && block.name === 'ExitPlanMode') {
          const ev: PlanEvent = { type: 'plan', id: block.id, at: ts, answeredAt: null, plan: clip(String(input.plan ?? '')), approved: null, feedback: null }
          pendingAsk.set(block.id, ev)
          cur.run.events.push(ev)
        } else if (block.type === 'tool_use') {
          const ev: ToolEvent = {
            type: 'tool',
            id: block.id,
            name: block.name,
            kind: toolKind(block.name),
            summary: firstLine(summarize(block.name, input, cwd)),
            input: clip(JSON.stringify(input, null, 2)),
            output: null,
            isError: false,
            start: ts,
            end: null,
          }
          if (WRITE_TOOLS.has(block.name)) cur.writes.set(block.id, input)
          pending.set(block.id, ev)
          cur.run.events.push(ev)
          cur.run.toolCalls++
        } else if (block.type === 'text' && block.text?.trim()) {
          cur.run.events.push({ type: 'text', id: `${rec.uuid}-t`, text: clip(block.text.trim()), at: ts })
        } else if (block.type === 'thinking' || block.type === 'redacted_thinking') {
          cur.run.events.push({ type: 'thinking', id: `${rec.uuid}-k`, at: ts })
        }
      }
      const cur = active as Builder | null
      if (cur && msg.id && !cur.msgIds.has(msg.id)) {
        cur.msgIds.add(msg.id)
        const u = msg.usage ?? {}
        cur.run.tokens.input += u.input_tokens ?? 0
        cur.run.tokens.output += u.output_tokens ?? 0
        cur.run.tokens.cacheRead += u.cache_read_input_tokens ?? 0
        cur.run.tokens.cacheWrite += u.cache_creation_input_tokens ?? 0
      }
      if (cur) cur.endTurn = msg.stop_reason === 'end_turn' || msg.stop_reason === 'stop_sequence'
    }
  }
  finish()

  for (const run of runs) {
    if (run.model === null) run.model = model
    run.shape = run.events
      .filter((e): e is ToolEvent => e.type === 'tool')
      .map((e) => [e.start - run.startedAt, Math.max(0, (e.end ?? run.endedAt) - e.start), e.kind])
  }
  return { runs, cwd }
}

const cache = new Map<string, ParsedSession>()

export async function parseSessionFile(file: string, force = false): Promise<ParsedSession | null> {
  const stat = await fs.stat(file).catch(() => null)
  if (!stat) {
    cache.delete(file)
    return null
  }
  const cached = cache.get(file)
  if (!force && cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached

  const raw = await fs.readFile(file, 'utf8')
  const id = path.basename(file, '.jsonl')
  const project = path.basename(path.dirname(file))
  const hasSkills = SKILL_MARKERS.some((m) => raw.includes(m))
  const { runs, cwd } = hasSkills
    ? parseTranscript(raw, { sessionId: id, project, mtimeMs: stat.mtimeMs })
    : { runs: [], cwd: raw.match(/"cwd":"((?:[^"\\]|\\.)*)"/)?.[1] ?? null }
  const session: ParsedSession = {
    id,
    file,
    project: cwd ? path.basename(cwd) : project,
    cwd,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    runs,
  }
  for (const r of runs) r.project = session.project
  cache.set(file, session)
  return session
}

export async function listSessionFiles(): Promise<string[]> {
  const projects = await fs.readdir(PROJECTS_DIR, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const p of projects) {
    if (!p.isDirectory()) continue
    const dir = path.join(PROJECTS_DIR, p.name)
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) if (e.isFile() && e.name.endsWith('.jsonl')) files.push(path.join(dir, e.name))
  }
  return files
}

export async function loadAllSessions(): Promise<ParsedSession[]> {
  const files = await listSessionFiles()
  const out: ParsedSession[] = []
  // Bounded concurrency keeps large ~/.claude directories from exhausting file handles.
  for (let i = 0; i < files.length; i += 16) {
    const batch = await Promise.all(files.slice(i, i + 16).map((f) => parseSessionFile(f)))
    for (const s of batch) if (s) out.push(s)
  }
  const live = new Set(files)
  for (const file of cache.keys()) if (!live.has(file)) cache.delete(file)
  return out
}
