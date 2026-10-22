import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { loadCodexSessions, loadOpenCodeDb, parseCodexTranscript, parseOpenCodeRows, type OpenCodeRow } from './agent-sessions.ts'

const T0 = Date.parse('2026-10-20T08:00:00Z')
const timestamp = (seconds: number) => new Date(T0 + seconds * 1000).toISOString()
const codex = (seconds: number, type: string, payload: unknown) => JSON.stringify({ timestamp: timestamp(seconds), type, payload })
const user = (seconds: number, text: string) => codex(seconds, 'response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text }] })
const said = (seconds: number, text: string) => codex(seconds, 'response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] })
const event = (seconds: number, type: string) => codex(seconds, 'event_msg', { type })
const readSkill = (seconds: number, callId: string, skill: string) =>
  codex(seconds, 'response_item', { type: 'function_call', call_id: callId, name: 'exec_command', arguments: `{"cmd":"cat /home/me/.codex/skills/${skill}/SKILL.md"}` })
const output = (seconds: number, callId: string, text: unknown) => codex(seconds, 'response_item', { type: 'function_call_output', call_id: callId, output: text })
const usage = (seconds: number, input: number, out: number) => codex(seconds, 'token_usage_record', { turn_token_usage: { input_tokens: input, output_tokens: out } })

test('Codex SKILL.md read starts a run with following tools and answer', () => {
  const raw = [
    codex(0, 'session_meta', { cwd: '/work/app' }),
    user(1, 'review this change'),
    codex(2, 'response_item', { type: 'custom_tool_call', call_id: 'c1', name: 'exec', input: 'await tools.exec_command({cmd:"cat /home/me/.codex/skills/review/SKILL.md"})' }),
    codex(3, 'response_item', { type: 'custom_tool_call_output', call_id: 'c1', output: '# Review' }),
    codex(4, 'response_item', { type: 'function_call', call_id: 'c2', name: 'exec_command', arguments: '{"cmd":"git diff"}' }),
    output(5, 'c2', 'one changed file'),
    said(6, 'Looks good.'),
    event(7, 'task_complete'),
  ].join('\n')
  const { cwd, runs } = parseCodexTranscript(raw, { sessionId: 's1', mtimeMs: T0, now: T0 + 60_000 })
  assert.equal(cwd, '/work/app')
  assert.equal(runs.length, 1)
  assert.equal(runs[0].skill, 'review')
  assert.equal(runs[0].baseDir, '/home/me/.codex/skills/review')
  assert.equal(runs[0].prompt, 'review this change')
  assert.equal(runs[0].status, 'done')
  assert.equal(runs[0].toolCalls, 2)
  assert.equal(runs[0].result, 'Looks good.')
  const tool = runs[0].events.find((e) => e.type === 'tool' && e.id === 'c2')
  assert.equal(tool?.type === 'tool' ? tool.output : null, 'one changed file')
})

test('Codex does not count a SKILL.md path written into a patch as a run', () => {
  const raw = [
    user(0, 'add a fixture'),
    codex(1, 'response_item', { type: 'custom_tool_call', call_id: 'patch', name: 'exec', input: 'await tools.apply_patch("+ await tools.exec_command({cmd: cat /home/me/.codex/skills/review/SKILL.md})")' }),
    output(2, 'patch', 'Done'),
    event(3, 'task_complete'),
  ].join('\n')
  assert.equal(parseCodexTranscript(raw, { sessionId: 'fixture', mtimeMs: T0, now: T0 + 60_000 }).runs.length, 0)
})

test('Codex does not count a SKILL.md path far from the read command in a shell script', () => {
  const script = `cat notes.txt; python3 - <<'EOF'\n# ${'x'.repeat(300)}\nprint("/home/me/.codex/skills/review/SKILL.md")\nEOF`
  const raw = [
    user(0, 'tidy the notes'),
    codex(1, 'response_item', { type: 'function_call', call_id: 'c1', name: 'exec_command', arguments: JSON.stringify({ cmd: script }) }),
    output(2, 'c1', 'ok'),
  ].join('\n')
  assert.equal(parseCodexTranscript(raw, { sessionId: 'script', mtimeMs: T0, now: T0 + 60_000 }).runs.length, 0)
})

test('Codex gives each skill read in one call a run holding that read, and the following work to the last', () => {
  const read = (skill: string) => `tools.exec_command({cmd:"cat /home/me/.codex/skills/${skill}/SKILL.md"})`
  const result = (skill: string) => JSON.stringify({ status: 'fulfilled', value: { output: `---\nname: ${skill}\n---\n# ${skill}` } })
  const raw = [
    user(0, 'design the page'),
    codex(1, 'response_item', { type: 'custom_tool_call', call_id: 'both', name: 'exec', input: `await Promise.allSettled([\n${read('brainstorm')},\n${read('frontend')}\n])` }),
    output(2, 'both', [{ type: 'input_text', text: 'Script completed\nOutput:\n' }, { type: 'input_text', text: `${result('brainstorm')}\n${result('frontend')}` }]),
    codex(3, 'response_item', { type: 'function_call', call_id: 'build', name: 'exec_command', arguments: '{"cmd":"npm run build"}' }),
    output(4, 'build', 'built'),
    said(5, 'Page designed.'),
    event(6, 'task_complete'),
  ].join('\n')
  const { runs } = parseCodexTranscript(raw, { sessionId: 'batch', mtimeMs: T0, now: T0 + 3600_000 })
  assert.deepEqual(
    runs.map((r) => [r.skill, r.toolCalls, r.status, r.loaded, r.endedAt - T0]),
    [
      ['brainstorm', 1, 'done', '---\nname: brainstorm\n---\n# brainstorm', 2000],
      ['frontend', 2, 'done', '---\nname: frontend\n---\n# frontend', 6000],
    ],
  )
})

test('Codex keeps tool work after an assistant message inside the same request', () => {
  const raw = [
    user(0, 'investigate'),
    codex(1, 'response_item', { type: 'custom_tool_call', call_id: 'read', name: 'exec', input: 'await tools.exec_command({cmd:"cat /home/me/.codex/skills/investigate/SKILL.md"})' }),
    said(2, 'First finding.'),
    codex(3, 'response_item', { type: 'function_call', call_id: 'more', name: 'exec_command', arguments: '{"cmd":"git status"}' }),
    output(4, 'more', 'clean'),
    user(10, 'next request'),
  ].join('\n')
  const { runs } = parseCodexTranscript(raw, { sessionId: 'followup', mtimeMs: T0, now: T0 + 60_000 })
  assert.equal(runs.length, 1)
  assert.equal(runs[0].endedAt, T0 + 4000)
  assert.equal(runs[0].toolCalls, 2)
})

test('Codex skips the context it sends as user messages and keeps a reply to the run’s question in the run', () => {
  const raw = [
    codex(0, 'session_meta', { cwd: '/work/app' }),
    event(1, 'task_started'),
    user(1, '# AGENTS.md instructions for /work/app\n\n<INSTRUCTIONS>\nBe brief.\n</INSTRUCTIONS>'),
    user(1, '<environment_context>\n  <cwd>/work/app</cwd>\n</environment_context>'),
    user(2, '<in-app-browser-context>\nOne tab.\n</in-app-browser-context>\n\n## My request:\nplan the release'),
    usage(3, 100, 10),
    readSkill(4, 'c1', 'plan'),
    output(5, 'c1', [{ type: 'input_text', text: 'Script completed\nOutput:\n' }, { type: 'input_text', text: JSON.stringify({ value: { output: '---\nname: plan\n---\n# Plan\nSteps.' } }) }]),
    codex(6, 'response_item', { type: 'function_call', call_id: 'c2', name: 'mcp__github__search_issues', arguments: '{"q":"release"}' }),
    output(6, 'c2', '[]'),
    said(7, 'Which release should I plan?'),
    usage(7, 150, 30),
    event(8, 'task_complete'),
    event(9, 'task_started'),
    user(9, '2'),
    said(10, 'Planned release 2.'),
    usage(10, 40, 5),
    event(11, 'task_complete'),
    event(20, 'task_started'),
    user(20, 'something else entirely'),
  ].join('\n')
  const { runs } = parseCodexTranscript(raw, { sessionId: 'reply', mtimeMs: T0 + 20_000, now: T0 + 21_000 })
  assert.equal(runs.length, 1)
  const run = runs[0]
  assert.equal(run.prompt, 'plan the release')
  assert.equal(run.loaded, '---\nname: plan\n---\n# Plan\nSteps.')
  assert.equal(run.status, 'done')
  assert.equal(run.humanTurns, 1)
  assert.deepEqual(run.events.filter((e) => e.type === 'human').map((e) => e.type === 'human' && [e.kind, e.text]), [['reply', '2']])
  assert.equal(run.result, 'Planned release 2.')
  // Usage before the skill was read belongs to the request, not the run; each turn's totals start again from zero.
  assert.deepEqual(run.tokens, { input: 90, output: 25, cacheRead: 0, cacheWrite: 0 })
  const kinds = run.events.flatMap((e) => (e.type === 'tool' ? [e.kind] : []))
  assert.deepEqual(kinds, ['exec', 'mcp'])
})

test('Codex records a structured question reply even when the assistant did not ask in its last message', () => {
  const reply = '<send_user_message_question_reply>\n' + JSON.stringify([{ questionItemId: 'q1', answer: 'Both agents' }]) + '\n</send_user_message_question_reply>'
  const raw = [
    user(0, 'check the agents'),
    readSkill(1, 'read', 'investigate'),
    output(2, 'read', '# Investigate'),
    event(3, 'task_complete'),
    user(4, reply),
    said(5, 'Both agents checked.'),
    event(6, 'task_complete'),
  ].join('\n')
  const [run] = parseCodexTranscript(raw, { sessionId: 'structured-reply', mtimeMs: T0, now: T0 + 60_000 }).runs
  assert.equal(run.humanTurns, 1)
  assert.deepEqual(run.events.filter((e) => e.type === 'human').map((e) => e.type === 'human' && [e.kind, e.text]), [['reply', 'Both agents']])
  assert.equal(run.result, 'Both agents checked.')
})

test('Codex records files named by a successful apply_patch call', () => {
  const raw = [
    codex(0, 'session_meta', { cwd: '/work/app' }),
    user(0, 'add a page'),
    readSkill(1, 'read', 'frontend'),
    output(2, 'read', '# Frontend'),
    codex(3, 'response_item', { type: 'function_call', call_id: 'patch', name: 'apply_patch', arguments: '*** Begin Patch\n*** Add File: /work/app/page.tsx\n+export default function Page() {}\n*** End Patch' }),
    output(4, 'patch', 'Success.'),
    event(5, 'task_complete'),
  ].join('\n')
  const [run] = parseCodexTranscript(raw, { sessionId: 'files', mtimeMs: T0, now: T0 + 60_000 }).runs
  assert.equal(run.filesChanged, 1)
  assert.deepEqual(run.outcome.files.map((file) => [file.path, file.op]), [['page.tsx', 'create']])
})

test('Codex run status at the end of the log follows the turn and the file’s age', () => {
  const start = [event(0, 'task_started'), user(0, 'review'), readSkill(1, 'c1', 'review'), output(2, 'c1', 'ok')]
  const status = (lines: string[], mtimeMs: number) => parseCodexTranscript(lines.join('\n'), { sessionId: 's', mtimeMs, now: T0 + 30_000 }).runs[0]

  const steered = status([...start, user(3, 'also check the tests'), said(4, 'Done.'), event(5, 'task_complete')], T0 + 5000)
  assert.equal(steered.status, 'done')
  assert.deepEqual(steered.events.filter((e) => e.type === 'human').map((e) => e.type === 'human' && e.kind), ['steer'])

  assert.equal(status(start, T0 + 25_000).status, 'running')
  assert.equal(status(start, T0 - 3600_000).status, 'interrupted')
  assert.equal(status([...start, said(3, 'Should I fix it?'), event(4, 'task_complete')], T0 + 25_000).status, 'waiting')
  assert.equal(status([...start, event(3, 'turn_aborted')], T0 + 25_000).status, 'interrupted')
})

test('Codex rollouts that cannot be read are skipped', { skip: process.getuid?.() === 0 && 'root can read any file' }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-trace-codex-'))
  const readable = path.join(root, 'rollout-a.jsonl')
  const locked = path.join(root, 'rollout-b.jsonl')
  await fs.writeFile(readable, user(0, 'hello'))
  await fs.writeFile(locked, user(0, 'hello'))
  await fs.chmod(locked, 0o000)
  t.after(async () => {
    await fs.chmod(locked, 0o600)
    await fs.rm(root, { recursive: true, force: true })
  })
  const sessions = await loadCodexSessions([root])
  assert.deepEqual(sessions.map((s) => s.file), [readable])
})

const row = (seconds: number, overrides: Partial<OpenCodeRow>): OpenCodeRow => ({
  sessionId: 's1', id: `p${seconds}`, messageId: `m${seconds}`, at: T0 + seconds * 1000,
  cwd: '/work/app', role: 'assistant', type: 'text', tool: null, name: null, title: null,
  input: null, filePath: null, output: null, text: null, synthetic: null, status: null, start: null, end: null,
  model: 'test-model', completed: null, finish: null,
  inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null,
  ...overrides,
})
const skillCall = (seconds: number, overrides: Partial<OpenCodeRow> = {}) =>
  row(seconds, { id: `skill${seconds}`, type: 'tool', tool: 'skill', name: 'charts', start: T0 + seconds * 1000, output: '# Charts', status: 'completed', ...overrides })

test('OpenCode skill tool starts a run and stops at its last event before the next request', () => {
  const rows = [
    row(0, { role: 'user', text: 'make a chart' }),
    skillCall(1, { end: T0 + 1100 }),
    row(2, { type: 'tool', tool: 'bash', title: 'Build chart', input: '{"command":"make"}', output: 'ok', start: T0 + 2000, end: T0 + 2500,
      inputTokens: 10, outputTokens: 5 }),
    row(3, { text: 'Chart created.', inputTokens: 4, outputTokens: 6 }),
    row(3600, { role: 'user', text: 'unrelated request' }),
  ]
  const sessions = parseOpenCodeRows(rows, '/data/opencode.db', T0, T0 + 7200_000)
  assert.equal(sessions.length, 1)
  assert.equal(sessions[0].runs.length, 1)
  const run = sessions[0].runs[0]
  assert.equal(run.skill, 'charts')
  assert.equal(run.status, 'done')
  assert.equal(run.prompt, 'make a chart')
  assert.equal(run.toolCalls, 1)
  assert.equal(run.result, 'Chart created.')
  assert.equal(run.endedAt, T0 + 3000)
  assert.equal(run.events[0].type === 'tool' && run.events[0].kind, 'exec')
  assert.deepEqual(run.tokens, { input: 14, output: 11, cacheRead: 0, cacheWrite: 0 })
})

test('OpenCode counts the skill message tokens once and records files written by tools', () => {
  const rows = [
    row(0, { role: 'user', text: 'make a page' }),
    skillCall(1, { messageId: 'assistant-1', inputTokens: 12, outputTokens: 3 }),
    row(2, { messageId: 'assistant-1', text: 'Using the page skill.', inputTokens: 12, outputTokens: 3 }),
    row(3, { type: 'tool', tool: 'write', input: JSON.stringify({ filePath: '/work/app/page.tsx', content: 'export default function Page() {}' }),
      status: 'completed', start: T0 + 3000, end: T0 + 3500, inputTokens: 4, outputTokens: 2 }),
  ]
  const [run] = parseOpenCodeRows(rows, '/data/opencode.db', T0, T0 + 3600_000)[0].runs
  assert.deepEqual(run.tokens, { input: 16, output: 5, cacheRead: 0, cacheWrite: 0 })
  assert.equal(run.filesChanged, 1)
  assert.deepEqual(run.outcome.files.map((file) => file.path), ['page.tsx'])
})

test('OpenCode counts one assistant message only once when it calls two skills', () => {
  const rows = [
    row(0, { role: 'user', text: 'compare two skills' }),
    skillCall(1, { messageId: 'assistant-1', inputTokens: 12_722, outputTokens: 289 }),
    skillCall(2, { messageId: 'assistant-1', name: 'tables', inputTokens: 12_722, outputTokens: 289 }),
  ]
  const runs = parseOpenCodeRows(rows, '/data/opencode.db', T0, T0 + 3600_000)[0].runs
  assert.equal(runs.length, 2)
  assert.equal(runs.reduce((sum, run) => sum + run.tokens.input, 0), 12_722)
  assert.equal(runs.reduce((sum, run) => sum + run.tokens.output, 0), 289)
})

test('OpenCode keeps a write path extracted before a long tool input is truncated', () => {
  const rows = [
    row(0, { role: 'user', text: 'write a large file' }),
    skillCall(1),
    row(2, { type: 'tool', tool: 'write', input: '{"content":"' + 'x'.repeat(20_000), filePath: '/work/app/large.ts',
      status: 'completed', start: T0 + 2000, end: T0 + 2500 }),
  ]
  const [run] = parseOpenCodeRows(rows, '/data/opencode.db', T0, T0 + 3600_000)[0].runs
  assert.deepEqual(run.outcome.files.map((file) => file.path), ['large.ts'])
})

test('OpenCode run status at the end of a session follows its last message and that session’s age', () => {
  const now = T0 + 86_400_000
  const recent = (s: number) => 86_400 - 60 + s
  const rows = [
    // Still working: the assistant's message is not completed and the session was written a minute ago.
    skillCall(recent(0), { sessionId: 'live' }),
    row(recent(1), { sessionId: 'live', type: 'tool', tool: 'bash', start: T0 + recent(1) * 1000, status: 'running' }),
    // Abandoned a day ago right after loading the skill.
    skillCall(0, { sessionId: 'old' }),
    // Finished its turn on a question a minute ago.
    skillCall(recent(0), { sessionId: 'asks', completed: T0 + recent(0) * 1000, finish: 'tool-calls' }),
    row(recent(2), { sessionId: 'asks', messageId: 'm-asks', text: 'Should I use a bar chart?', completed: T0 + recent(3) * 1000, finish: 'stop' }),
  ]
  const status = Object.fromEntries(parseOpenCodeRows(rows, '/data/opencode.db', now, now).map((s) => [s.id, s.runs[0].status]))
  assert.deepEqual(status, { live: 'running', old: 'interrupted', asks: 'waiting' })
})

test('OpenCode keeps a reply to the run’s question in the run and ignores text it adds itself', () => {
  const rows = [
    row(0, { role: 'user', text: 'make a chart' }),
    skillCall(1),
    row(2, { text: 'Should I use a bar chart?', completed: T0 + 2500, finish: 'stop' }),
    row(3, { role: 'user', text: 'Called the skill tool with the following input', synthetic: 1 }),
    row(3, { role: 'user', text: 'yes' }),
    row(4, { messageId: 'm4', text: 'Bar chart created.', completed: T0 + 4500, finish: 'stop' }),
  ]
  const [run] = parseOpenCodeRows(rows, '/data/opencode.db', T0, T0 + 3600_000)[0].runs
  assert.equal(run.status, 'done')
  assert.equal(run.humanTurns, 1)
  assert.equal(run.result, 'Bar chart created.')
})

test('OpenCode sessions are read from its SQLite database', async (t) => {
  const { DatabaseSync } = await import('node:sqlite')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-trace-opencode-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const dbPath = path.join(dir, 'opencode.db')
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE session_v2 (id TEXT PRIMARY KEY, directory TEXT);
    CREATE TABLE message (id TEXT PRIMARY KEY, data TEXT);
    CREATE TABLE part (id TEXT PRIMARY KEY, session_id TEXT, message_id TEXT, time_created INTEGER, data TEXT);
  `)
  db.prepare('INSERT INTO session_v2 VALUES (?, ?)').run('s1', '/work/app')
  const message = db.prepare('INSERT INTO message VALUES (?, ?)')
  message.run('m1', JSON.stringify({ role: 'user' }))
  message.run('m2', JSON.stringify({ role: 'assistant', modelID: 'test-model', time: { completed: T0 + 3000 }, finish: 'stop', tokens: { input: 7, output: 3, cache: { read: 1, write: 0 } } }))
  const part = db.prepare('INSERT INTO part VALUES (?, ?, ?, ?, ?)')
  part.run('p1', 's1', 'm1', T0, JSON.stringify({ type: 'text', text: 'make a chart' }))
  part.run('p2', 's1', 'm2', T0 + 1000, JSON.stringify({ type: 'tool', tool: 'skill', state: { status: 'completed', input: { name: 'charts' }, output: '# Charts', time: { start: T0 + 1000, end: T0 + 1100 } } }))
  part.run('p3', 's1', 'm2', T0 + 2000, JSON.stringify({ type: 'text', text: 'Chart created.' }))
  db.close()

  const sessions = await loadOpenCodeDb(dbPath)
  assert.equal(sessions?.length, 1)
  const [run] = sessions![0].runs
  assert.equal(sessions![0].file, `${dbPath}#s1`)
  assert.equal(run.skill, 'charts')
  assert.equal(run.prompt, 'make a chart')
  assert.equal(run.loaded, '# Charts')
  assert.equal(run.result, 'Chart created.')
  assert.equal(run.model, 'test-model')
})

test('An OpenCode database that cannot be queried is reported once and yields null', async (t) => {
  const { DatabaseSync } = await import('node:sqlite')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-trace-opencode-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const dbPath = path.join(dir, 'opencode.db')
  new DatabaseSync(dbPath).close()
  const warn = t.mock.method(console, 'warn', () => {})
  assert.equal(await loadOpenCodeDb(dbPath), null)
  assert.equal(await loadOpenCodeDb(dbPath), null)
  assert.equal(warn.mock.callCount(), 1)
  assert.deepEqual(await loadOpenCodeDb(path.join(dir, 'missing.db')), [])
})
