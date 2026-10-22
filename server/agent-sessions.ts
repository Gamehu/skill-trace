import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { RUNNING_GRACE_MS } from './config.ts'
import { asksForInput, clip, firstLine, isShortAnswer, newRun, plainSummary, toolKind, toolShape, type ParsedSession } from './transcripts.ts'
import type { FileChange, HumanKind, RunDetail, RunStatus, TokenUsage, ToolKind, TraceEvent } from './types.ts'

type ToolEvent = Extract<TraceEvent, { type: 'tool' }>

const MAX_PROMPT = 8_000
/** Generous cap on the sqlite3 CLI's JSON output; each text column is already cut to 20 000 characters in SQL. */
const SQLITE_MAX_BUFFER = 128 * 1024 * 1024
const execFileAsync = promisify(execFile)

/** Tool payloads arrive as strings or as JSON values; both are shown as text. */
const asText = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value))

/** Codex and OpenCode tool names. Anything else is looked up among Claude Code's. */
const TOOL_KINDS: Record<string, ToolKind> = {
  exec: 'exec',
  exec_command: 'exec',
  write_stdin: 'exec',
  shell: 'exec',
  wait: 'exec',
  bash: 'exec',
  apply_patch: 'write',
  write: 'write',
  edit: 'write',
  patch: 'write',
  multiedit: 'write',
  read: 'read',
  grep: 'read',
  glob: 'read',
  list: 'read',
  view_image: 'read',
  web_search: 'web',
  webfetch: 'web',
  websearch: 'web',
  codesearch: 'web',
  task: 'agent',
  spawn_agent: 'agent',
  wait_agent: 'agent',
  send_message: 'agent',
  followup_task: 'agent',
  list_agents: 'agent',
  interrupt_agent: 'agent',
}

function kindOf(name: string): ToolKind {
  if (name.startsWith('mcp__')) return 'mcp'
  return TOOL_KINDS[name.toLowerCase()] ?? toolKind(name)
}

/** The run's last words, when it ended on them rather than on a step. */
function lastText(run: RunDetail): string | null {
  const last = run.events.at(-1)
  return last?.type === 'text' ? last.text : null
}

function human(run: RunDetail, at: number, kind: HumanKind, text: string) {
  run.events.push({ type: 'human', id: `h${run.events.length}-${at}`, at, kind, text: clip(text, 4000) })
  run.endedAt = Math.max(run.endedAt, at)
}

/**
 * Whether a person's message after the agent stopped belongs to the run: it answers what the run asked,
 * it is a bare "ok" or "2", or it follows an interruption.
 */
function continuesRun(run: RunDetail, text: string): boolean {
  const last = run.events.at(-1)
  return (last?.type === 'human' && last.kind === 'interrupt') || asksForInput(lastText(run) ?? '') || isShortAnswer(text)
}

/**
 * Status of a run still open when its log ends.
 *
 * @param turnEnded - Whether the agent finished its turn (rather than stopping mid-way).
 * @param fresh - Whether the log was written to within the grace period.
 */
function endStatus(run: RunDetail, turnEnded: boolean, fresh: boolean): RunStatus {
  const last = run.events.at(-1)
  if (last?.type === 'human' && last.kind === 'interrupt') return 'interrupted'
  if (turnEnded) return fresh && asksForInput(lastText(run) ?? '') ? 'waiting' : 'done'
  return fresh ? 'running' : 'interrupted'
}

function finish(run: RunDetail, status: RunStatus) {
  run.status = status
  run.outcome.text = run.events.findLast((e): e is Extract<TraceEvent, { type: 'text' }> => e.type === 'text')?.text ?? null
  run.outcome.files = changedFiles(run)
  run.result = plainSummary(run.outcome.text)
  run.humanTurns = run.events.filter((e) => e.type === 'human').length
  run.filesChanged = run.outcome.files.length
  run.shape = toolShape(run)
}

/** Names of files changed by successful, explicitly file-writing tools. Their inputs do not reliably contain a full diff. */
function changedFiles(run: RunDetail): FileChange[] {
  const files = new Map<string, FileChange>()
  const add = (name: string, op: FileChange['op']) => {
    const file = run.cwd && name.startsWith(`${run.cwd}${path.sep}`) ? name.slice(run.cwd.length + 1) : name
    if (!file || files.has(file)) return
    files.set(file, { path: file, op, additions: 0, deletions: 0, edits: [] })
  }
  for (const event of run.events) {
    if (event.type !== 'tool' || event.isError || event.end == null) continue
    const tool = event.name.toLowerCase()
    if (['write', 'edit', 'multiedit', 'patch'].includes(tool)) {
      if (event.filePath) add(event.filePath, 'edit')
      try {
        const input: unknown = JSON.parse(event.input)
        if (input && typeof input === 'object' && !Array.isArray(input)) {
          const args = input as Record<string, unknown>
          const file = args.filePath ?? args.file_path ?? args.path
          if (typeof file === 'string') add(file, 'edit')
        }
      } catch {
        // Patch tools can also receive plain text.
      }
    }
    if (tool === 'apply_patch' || (['exec', 'exec_command'].includes(tool) && /(?:tools\.)?apply_patch\s*\(/.test(event.input))) {
      for (const match of event.input.replace(/\\n/g, '\n').matchAll(/^\*\*\* (Add|Update|Delete) File: (.+)$/gm)) {
        add(match[2].trim(), match[1] === 'Add' ? 'create' : 'edit')
      }
    }
  }
  return [...files.values()]
}

function messageText(content: unknown): string {
  return Array.isArray(content)
    ? content.filter((block) => block && typeof block.text === 'string').map((block) => block.text as string).join('\n')
    : ''
}

/**
 * The person's words in a Codex user message, or null for context Codex sends as a user message on its own:
 * AGENTS.md, the environment, or UI state wrapped in one tag (`<external_codex_apps_open_page>{…}</…>`).
 * Context attached to a request comes first, the words after "## My request:".
 */
function codexUserText(text: string): string | null {
  const request = text.match(/\n## My request[^:\n]*:\s*\n([\s\S]+)$/)
  if (request) return request[1].trim()
  if (text.startsWith('# AGENTS.md instructions')) return null
  const questionReply = text.match(/^<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>$/)
  if (questionReply) {
    try {
      const replies: unknown = JSON.parse(questionReply[1])
      if (Array.isArray(replies)) {
        const answers = replies.flatMap((reply) => reply && typeof reply === 'object' && 'answer' in reply && typeof reply.answer === 'string' ? [reply.answer] : [])
        if (answers.length) return answers.join('\n')
      }
    } catch {
      // Keep the text if a future Codex version changes the wrapper's format.
    }
    return questionReply[1].trim() || null
  }
  if (/^<([\w-]+)[^>]*>[\s\S]*<\/\1>$/.test(text)) return null
  return text
}

// Codex has no dedicated Skill tool. A recorded read of SKILL.md is the observable activation.
const SKILL_PATH = /(\/[^\s"'`]+\/skills\/[^/\s"'`]+)\/SKILL\.md/g
const READ_COMMAND = /\b(?:cat|sed|head|tail|less|more)\b/
/** How far before a SKILL.md path the read command must appear, so a path merely mentioned in a larger script is skipped. */
const READ_COMMAND_REACH = 220

function isSkillReadCall(name: string, input: string): boolean {
  if (name !== 'exec_command' && name !== 'exec') return false
  if (name === 'exec' && input.match(/\btools\.(\w+)\s*\(/)?.[1] !== 'exec_command') return false
  return READ_COMMAND.test(input)
}

/**
 * The SKILL.md text inside a read's output. Codex wraps command output in status lines and, in code mode,
 * in JSON (one result per line, after a warning when it cut the output), so every string in it is searched
 * for the skill's frontmatter.
 */
function loadedSkill(output: unknown, skill: string): string | null {
  const texts: string[] = []
  const parsed = (json: string) => {
    try {
      collect(JSON.parse(json))
      return true
    } catch {
      return false // plain text that happens to start with a bracket
    }
  }
  const collect = (value: unknown) => {
    if (typeof value === 'string') {
      texts.push(value)
      if (/^\s*[[{]/.test(value) && parsed(value)) return
      for (const line of value.split('\n')) if (/^\s*[[{]/.test(line)) parsed(line)
    } else if (Array.isArray(value)) value.forEach(collect)
    else if (value && typeof value === 'object') Object.values(value).forEach(collect)
  }
  collect(output)
  // One read can print several SKILL.md files back to back; each starts at its frontmatter.
  const docs = texts.flatMap((t) => {
    const starts = [...t.matchAll(/^---\r?\n(?:(?!---).*\r?\n)*?name:/gm)].map((m) => m.index)
    return starts.map((start, i) => t.slice(start, starts[i + 1]))
  })
  return docs.find((d) => new RegExp(`^name:\\s*['"]?${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?\\s*$`, 'm').test(d)) ?? docs[0] ?? null
}

const loadedText = (output: unknown, skill: string) => clip(loadedSkill(output, skill) ?? '') || null

const zeroUsage = (): TokenUsage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })

/**
 * Finds the skill runs in one Codex rollout log. A run starts when the agent reads a SKILL.md with a shell
 * command and lasts until the person sends a new request; a reply to the run's question or a bare "ok" stays in it.
 *
 * @param raw - The rollout's JSONL text.
 * @param meta - The session id, the file's modification time, and the current time (tests pin it).
 * @returns The working directory recorded in the log, and its runs in order.
 */
export function parseCodexTranscript(raw: string, meta: { sessionId: string; mtimeMs: number; now?: number }): { cwd: string | null; runs: RunDetail[] } {
  const runs: RunDetail[] = []
  const pending = new Map<string, ToolEvent>()
  const seenThisTurn = new Set<string>()
  const fresh = (meta.now ?? Date.now()) - meta.mtimeMs < RUNNING_GRACE_MS
  let cwd: string | null = null
  let prompt: string | null = null
  let model: string | null = null
  let active: RunDetail | null = null
  // The call that read the active run's SKILL.md: its output is the instructions the agent loaded.
  let loadCall: string | null = null
  // Runs of skills read together with the active one, each holding only that read, until its output arrives.
  let loading: { run: RunDetail; event: ToolEvent }[] = []
  // 'none' while the log has no turn events (older Codex versions); 'busy' once the agent works on the current turn.
  let turn: 'none' | 'open' | 'busy' | 'ended' = 'none'
  // Codex reports a turn's usage as running totals, so each record adds what changed since the previous one.
  let turnUsage = zeroUsage()

  const close = (status: RunStatus) => {
    for (const { run } of loading) {
      finish(run, status)
      runs.push(run)
    }
    loading = []
    if (!active) return
    finish(active, status)
    runs.push(active)
    active = null
    loadCall = null
    pending.clear()
  }
  const record = (run: RunDetail, event: ToolEvent) => {
    run.events.push(event)
    run.toolCalls++
    run.endedAt = Math.max(run.endedAt, event.start)
  }
  const complete = (run: RunDetail, event: ToolEvent, p: any, at: number) => {
    event.end = at
    event.output = clip(asText(p.output))
    event.isError = p.is_error === true
    if (event.isError) run.errors++
    run.endedAt = Math.max(run.endedAt, at)
  }

  for (const line of raw.split('\n')) {
    if (!line) continue
    let rec: any
    try {
      rec = JSON.parse(line)
    } catch {
      continue // a partially written last line
    }
    const at = Date.parse(rec.timestamp)
    if (!Number.isFinite(at)) continue
    const p = rec.payload ?? {}

    if (rec.type === 'session_meta') {
      if (typeof p.cwd === 'string') cwd = p.cwd
      continue
    }
    if (rec.type === 'turn_context') {
      if (typeof p.model === 'string') model = p.model
      continue
    }
    if (rec.type === 'event_msg') {
      if (p.type === 'task_started') {
        seenThisTurn.clear()
        turn = 'open'
        turnUsage = zeroUsage()
      } else if (p.type === 'task_complete') {
        turn = 'ended'
        if (active) active.endedAt = Math.max(active.endedAt, at)
      } else if (p.type === 'turn_aborted') {
        turn = 'ended'
        if (active) human(active, at, 'interrupt', '')
      }
      continue
    }
    if (rec.type === 'token_usage_record') {
      const u = p.turn_token_usage ?? {}
      const total: TokenUsage = {
        input: Number(u.input_tokens ?? 0),
        output: Number(u.output_tokens ?? 0),
        cacheRead: Number(u.cached_input_tokens ?? 0),
        cacheWrite: Number(u.cache_write_input_tokens ?? 0),
      }
      if (active) {
        active.tokens.input += Math.max(0, total.input - turnUsage.input)
        active.tokens.output += Math.max(0, total.output - turnUsage.output)
        active.tokens.cacheRead += Math.max(0, total.cacheRead - turnUsage.cacheRead)
        active.tokens.cacheWrite += Math.max(0, total.cacheWrite - turnUsage.cacheWrite)
      }
      turnUsage = total
      continue
    }
    if (rec.type !== 'response_item') continue

    if (p.type === 'message') {
      const text = messageText(p.content).trim()
      if (p.role === 'assistant' && text) {
        if (turn !== 'none') turn = 'busy'
        if (active) {
          active.events.push({ type: 'text', id: p.id ?? `text-${at}`, text: clip(text), at })
          active.endedAt = at
        }
      } else if (p.role === 'user') {
        const words = codexUserText(text)
        if (!words) continue
        // Typed while Codex was working, the message steers the run; after it stopped, it may answer it.
        if (active && turn === 'busy') human(active, at, 'steer', words)
        else if (active && (text.startsWith('<send_user_message_question_reply>') || continuesRun(active, words))) human(active, at, 'reply', words)
        else {
          close('done')
          prompt = clip(words, MAX_PROMPT)
          seenThisTurn.clear()
        }
      }
      continue
    }

    if (p.type === 'custom_tool_call' || p.type === 'function_call') {
      if (turn !== 'none') turn = 'busy'
      const input = asText(p.input ?? p.arguments)
      const callId = String(p.call_id ?? p.id ?? `call-${at}`)
      const name = String(p.name ?? 'tool')
      const step = (): ToolEvent => ({
        type: 'tool',
        id: callId,
        name,
        kind: kindOf(name),
        summary: firstLine(input),
        input: clip(input),
        output: null,
        isError: false,
        start: at,
        end: null,
      })
      const skillDirs: string[] = []
      for (const match of isSkillReadCall(name, input) ? input.matchAll(SKILL_PATH) : []) {
        if (!READ_COMMAND.test(input.slice(Math.max(0, match.index - READ_COMMAND_REACH), match.index))) continue
        const dir = match[1]
        if (seenThisTurn.has(dir)) continue
        seenThisTurn.add(dir)
        skillDirs.push(dir)
      }
      if (skillDirs.length) close('done')
      // Skills read in one call are loaded together. Each gets a run holding the read; the work that follows
      // goes to the last one, the way a skill loaded later takes over from an earlier one.
      for (const [i, dir] of skillDirs.entries()) {
        const skill = path.basename(dir)
        const run = newRun({
          id: `codex:${meta.sessionId}:${callId}:${skill}`,
          agent: 'codex',
          skill,
          args: null,
          trigger: 'model',
          sessionId: meta.sessionId,
          project: cwd ? path.basename(cwd) : meta.sessionId,
          cwd,
          prompt,
          input: prompt,
          startedAt: at,
          model,
        })
        run.baseDir = dir
        const event = step()
        record(run, event)
        if (i < skillDirs.length - 1) loading.push({ run, event })
        else {
          active = run
          loadCall = callId
          pending.set(callId, event)
        }
      }
      if (!skillDirs.length && active) {
        const event = step()
        record(active, event)
        pending.set(callId, event)
      }
    } else if (p.type === 'custom_tool_call_output' || p.type === 'function_call_output') {
      const callId = String(p.call_id ?? '')
      for (const { run, event } of loading.filter((l) => l.event.id === callId)) {
        complete(run, event, p, at)
        run.loaded = loadedText(p.output, run.skill)
        finish(run, 'done')
        runs.push(run)
      }
      loading = loading.filter((l) => l.event.id !== callId)
      const event = pending.get(callId)
      if (!event || !active) continue
      pending.delete(callId)
      complete(active, event, p, at)
      if (callId === loadCall) active.loaded = loadedText(p.output, active.skill)
    }
  }
  if (active) close(endStatus(active, turn === 'ended', fresh))
  return { cwd, runs }
}

async function codexFiles(root: string): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: string, depth: number) {
    if (depth > 5) return
    for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(full, depth + 1)
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) out.push(full)
    }
  }
  await walk(root, 0)
  return out
}

const codexCache = new Map<string, ParsedSession>()

/**
 * Parses one Codex rollout, reusing the previous result while the file's size and modification time are unchanged.
 *
 * @param file - Path of the rollout's `.jsonl`.
 * @returns The session, or null when the file is gone or cannot be read.
 */
export async function parseCodexFile(file: string): Promise<ParsedSession | null> {
  const stat = await fs.stat(file).catch(() => null)
  const cached = codexCache.get(file)
  if (stat && cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached
  const raw = stat && (await fs.readFile(file, 'utf8').catch(() => null))
  if (!stat || raw == null) {
    codexCache.delete(file)
    return null
  }
  const id = path.basename(file, '.jsonl')
  // Cheap pre-check: rollouts that never touch a SKILL.md are not JSON-parsed.
  const parsed = raw.includes('/SKILL.md')
    ? parseCodexTranscript(raw, { sessionId: id, mtimeMs: stat.mtimeMs })
    : { runs: [], cwd: raw.match(/"cwd":"((?:[^"\\]|\\.)*)"/)?.[1] ?? null }
  const session: ParsedSession = {
    id,
    file,
    project: parsed.cwd ? path.basename(parsed.cwd) : id,
    cwd: parsed.cwd,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    runs: parsed.runs,
  }
  codexCache.set(file, session)
  return session
}

/**
 * Loads every Codex rollout under the given session folders (`sessions/YYYY/MM/DD/rollout-….jsonl`).
 *
 * @param roots - Codex session folders in effect.
 * @returns One session per readable rollout.
 */
export async function loadCodexSessions(roots: string[]): Promise<ParsedSession[]> {
  const files = (await Promise.all(roots.map(codexFiles))).flat()
  const out: ParsedSession[] = []
  // Bounded concurrency, as for Claude Code logs.
  for (let i = 0; i < files.length; i += 16) {
    const batch = await Promise.all(files.slice(i, i + 16).map(parseCodexFile))
    for (const s of batch) if (s) out.push(s)
  }
  const live = new Set(files)
  for (const file of codexCache.keys()) if (!live.has(file)) codexCache.delete(file)
  return out
}

/** One text or tool part of an OpenCode message, with the message's fields it belongs to (see `OPEN_CODE_QUERY`). */
export interface OpenCodeRow {
  sessionId: string
  /** The part's id. */
  id: string
  messageId: string
  /** When the part was created, in epoch milliseconds. */
  at: number
  cwd: string | null
  role: string
  /** `text` or `tool`. */
  type: string
  tool: string | null
  /** The skill a `skill` tool call loads. */
  name: string | null
  title: string | null
  input: string | null
  /** Extracted before the full input is truncated for display. */
  filePath: string | null
  output: string | null
  text: string | null
  /** Set on text OpenCode adds to a user message on its own. */
  synthetic: number | null
  status: string | null
  start: number | null
  end: number | null
  model: string | null
  /** When the message was completed; null while the agent is still writing it. */
  completed: number | null
  /** Why the message ended; `tool-calls` means the agent goes on after the tools return. */
  finish: string | null
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
}

/**
 * Groups OpenCode message parts into sessions and finds their skill runs. A run starts at a `skill` tool
 * call and lasts until the person sends a new request; a reply to the run's question or a bare "ok" stays in it.
 *
 * @param rows - Parts of sessions that used a skill, ordered by session and time.
 * @param dbPath - The database they came from; it names each session's file.
 * @param mtimeMs - The database's modification time.
 * @param now - The current time (tests pin it).
 * @returns One session per session id, each with its runs in order.
 */
export function parseOpenCodeRows(rows: OpenCodeRow[], dbPath: string, mtimeMs: number, now = Date.now()): ParsedSession[] {
  const sessions = new Map<string, ParsedSession>()
  const active = new Map<string, RunDetail>()
  const prompts = new Map<string, string>()
  const seenMessages = new Set<string>()
  const lastAt = new Map<string, number>()
  const turnEnded = new Map<string, boolean>()
  const close = (sessionId: string, status: RunStatus) => {
    const run = active.get(sessionId)
    if (!run) return
    finish(run, status)
    sessions.get(sessionId)?.runs.push(run)
    active.delete(sessionId)
  }
  const countTokens = (run: RunDetail, row: OpenCodeRow) => {
    const key = `${row.sessionId}:${row.messageId}`
    if (seenMessages.has(key)) return
    seenMessages.add(key)
    run.tokens.input += row.inputTokens ?? 0
    run.tokens.output += row.outputTokens ?? 0
    run.tokens.cacheRead += row.cacheReadTokens ?? 0
    run.tokens.cacheWrite += row.cacheWriteTokens ?? 0
  }

  for (const row of rows) {
    let session = sessions.get(row.sessionId)
    if (!session) {
      session = { id: row.sessionId, file: `${dbPath}#${row.sessionId}`, project: row.cwd ? path.basename(row.cwd) : row.sessionId,
        cwd: row.cwd, mtimeMs, size: 0, runs: [] }
      sessions.set(row.sessionId, session)
    }
    lastAt.set(row.sessionId, Math.max(lastAt.get(row.sessionId) ?? 0, row.at, row.end ?? 0))
    if (row.role === 'assistant') turnEnded.set(row.sessionId, row.completed != null && row.finish !== 'tool-calls')

    if (row.role === 'user') {
      const text = row.type === 'text' && !row.synthetic ? row.text?.trim() : ''
      if (!text) continue
      const run = active.get(row.sessionId)
      // OpenCode queues what is typed while it works, so every user message comes after the agent stopped.
      if (run && continuesRun(run, text)) human(run, row.at, 'reply', text)
      else {
        close(row.sessionId, 'done')
        prompts.set(row.sessionId, clip(text, MAX_PROMPT))
      }
      continue
    }
    if (row.type === 'tool' && row.tool === 'skill' && row.name) {
      close(row.sessionId, 'done')
      const prompt = prompts.get(row.sessionId) ?? null
      const run = newRun({
        id: `opencode:${row.id}`,
        agent: 'opencode',
        skill: row.name,
        args: null,
        trigger: 'model',
        sessionId: row.sessionId,
        project: session.project,
        cwd: row.cwd,
        prompt,
        input: prompt,
        startedAt: row.start ?? row.at,
        model: row.model,
      })
      run.loaded = row.output
      if (row.status === 'error') run.errors++
      countTokens(run, row)
      active.set(row.sessionId, run)
      continue
    }
    const run = active.get(row.sessionId)
    if (!run) continue
    countTokens(run, row)
    if (row.type === 'text' && row.text?.trim()) {
      run.events.push({ type: 'text', id: row.id, text: clip(row.text.trim()), at: row.at })
      run.endedAt = Math.max(run.endedAt, row.at)
    } else if (row.type === 'tool' && row.tool) {
      const event: ToolEvent = {
        type: 'tool',
        id: row.id,
        name: row.tool,
        kind: kindOf(row.tool),
        summary: firstLine(row.title ?? row.tool),
        input: row.input ?? '',
        filePath: row.filePath ?? undefined,
        output: row.output,
        isError: row.status === 'error',
        start: row.start ?? row.at,
        end: row.end,
      }
      run.events.push(event)
      run.toolCalls++
      if (event.isError) run.errors++
      run.endedAt = Math.max(run.endedAt, event.end ?? event.start)
    }
  }
  for (const [id, run] of active) close(id, endStatus(run, turnEnded.get(id) ?? false, now - (lastAt.get(id) ?? 0) < RUNNING_GRACE_MS))
  return [...sessions.values()]
}

const OPEN_CODE_QUERY = `
WITH skilled AS (
  SELECT DISTINCT session_id FROM part WHERE json_extract(data, '$.tool') = 'skill'
)
SELECT p.session_id AS sessionId, p.id, p.message_id AS messageId, p.time_created AS at,
  s.directory AS cwd, json_extract(m.data, '$.role') AS role,
  json_extract(p.data, '$.type') AS type, json_extract(p.data, '$.tool') AS tool,
  json_extract(p.data, '$.state.input.name') AS name,
  json_extract(p.data, '$.state.title') AS title,
  substr(json_extract(p.data, '$.state.input'), 1, 20000) AS input,
  json_extract(p.data, '$.state.input.filePath') AS filePath,
  substr(json_extract(p.data, '$.state.output'), 1, 20000) AS output,
  substr(json_extract(p.data, '$.text'), 1, 20000) AS text,
  json_extract(p.data, '$.synthetic') AS synthetic,
  json_extract(p.data, '$.state.status') AS status,
  json_extract(p.data, '$.state.time.start') AS start,
  json_extract(p.data, '$.state.time.end') AS end,
  json_extract(m.data, '$.modelID') AS model,
  json_extract(m.data, '$.time.completed') AS completed,
  json_extract(m.data, '$.finish') AS finish,
  json_extract(m.data, '$.tokens.input') AS inputTokens,
  json_extract(m.data, '$.tokens.output') AS outputTokens,
  json_extract(m.data, '$.tokens.cache.read') AS cacheReadTokens,
  json_extract(m.data, '$.tokens.cache.write') AS cacheWriteTokens
FROM part p JOIN skilled k ON k.session_id = p.session_id
JOIN message m ON m.id = p.message_id
JOIN session_v2 s ON s.id = p.session_id
WHERE json_extract(p.data, '$.type') IN ('text', 'tool')
ORDER BY p.session_id, p.time_created, p.id`

/** File name of OpenCode's session database inside its data folder. */
export const OPENCODE_DB = 'opencode.db'

let sqliteModule: Promise<typeof import('node:sqlite') | null> | undefined
// Imported on first use: Node 20 has no node:sqlite, and newer versions warn that it is experimental.
const loadSqlite = () => (sqliteModule ??= import('node:sqlite').catch(() => null))

const warned = new Set<string>()

async function queryOpenCode(dbPath: string): Promise<OpenCodeRow[]> {
  const sqlite = await loadSqlite()
  if (sqlite) {
    const db = new sqlite.DatabaseSync(dbPath, { readOnly: true })
    try {
      return db.prepare(OPEN_CODE_QUERY).all() as unknown as OpenCodeRow[]
    } finally {
      db.close()
    }
  }
  // Without node:sqlite, fall back to the sqlite3 CLI that macOS and many Linux installs provide.
  const { stdout } = await execFileAsync('sqlite3', ['-readonly', '-json', dbPath, OPEN_CODE_QUERY], { maxBuffer: SQLITE_MAX_BUFFER })
  return stdout.trim() ? (JSON.parse(stdout) as OpenCodeRow[]) : []
}

/**
 * Reads the skill sessions in one OpenCode database (OpenCode 1.x keeps them in SQLite).
 *
 * @param dbPath - Path of `opencode.db`.
 * @returns Its sessions; an empty list when the database does not exist; null when it cannot be read
 *   (no SQLite driver, a schema from another OpenCode version), which is logged once per cause.
 */
export async function loadOpenCodeDb(dbPath: string): Promise<ParsedSession[] | null> {
  const stat = await fs.stat(dbPath).catch(() => null)
  if (!stat) return []
  try {
    return parseOpenCodeRows(await queryOpenCode(dbPath), dbPath, stat.mtimeMs)
  } catch (err) {
    const message = `skill-trace: cannot read OpenCode sessions from ${dbPath}: ${err instanceof Error ? err.message : String(err)}`
    if (!warned.has(message)) {
      warned.add(message)
      console.warn(message)
    }
    return null
  }
}

/**
 * Loads the OpenCode database in each data folder. One unreadable database does not stop the others.
 *
 * @param roots - OpenCode data folders in effect.
 * @returns Every skill session found.
 */
export async function loadOpenCodeSessions(roots: string[]): Promise<ParsedSession[]> {
  const loaded = await Promise.all(roots.map((root) => loadOpenCodeDb(path.join(root, OPENCODE_DB))))
  return loaded.flatMap((sessions) => sessions ?? [])
}
