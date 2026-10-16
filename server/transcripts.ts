import fs from 'node:fs/promises'
import path from 'node:path'
import { PROJECTS_DIR, RUNNING_GRACE_MS } from './config.ts'
import type { RunDetail, RunStatus, RunTrigger, TokenUsage, ToolKind, TraceEvent } from './types.ts'

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
}

function emptyUsage(): TokenUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
}

export function parseTranscript(
  raw: string,
  meta: { sessionId: string; project: string; mtimeMs: number; now?: number },
): { runs: RunDetail[]; cwd: string | null } {
  const now = meta.now ?? Date.now()
  const runs: RunDetail[] = []
  const pending = new Map<string, ToolEvent>()
  let cwd: string | null = null
  let lastPrompt: string | null = null
  let model: string | null = null
  let active: Builder | null = null

  const finish = (status?: RunStatus) => {
    if (!active) return
    const { run } = active
    const ends = run.events.map((e) => (e.type === 'tool' ? (e.end ?? e.start) : e.at))
    run.endedAt = Math.max(run.startedAt, active.lastTs, ...ends)
    run.status = status ?? (active.endTurn ? 'done' : now - meta.mtimeMs < RUNNING_GRACE_MS ? 'running' : 'interrupted')
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
        startedAt: ts,
        endedAt: ts,
        toolCalls: 0,
        errors: 0,
        tokens: emptyUsage(),
        shape: [],
        baseDir: null,
        loaded: null,
        model,
        events: [],
      },
      msgIds: new Set(),
      lastTs: ts,
      endTurn: false,
    }
    return active
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

    if (rec.type === 'user' && rec.message) {
      const content = rec.message.content
      const blocks: any[] = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : []

      for (const block of blocks) {
        if (block.type !== 'tool_result') continue
        const ev = pending.get(block.tool_use_id)
        if (!ev) continue
        pending.delete(block.tool_use_id)
        ev.end = ts
        ev.output = clip(blockText(block.content))
        ev.isError = block.is_error === true
        if (ev.isError && b) b.run.errors++
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
        finish('interrupted')
        continue
      }
      // A new turn closes whatever skill run was in progress.
      finish()
      lastPrompt = promptLabel(text)
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
        if (block.type === 'tool_use') {
          const input = block.input && typeof block.input === 'object' ? block.input : {}
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
