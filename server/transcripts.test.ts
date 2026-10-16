import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseTranscript, promptLabel } from './transcripts.ts'

const T0 = Date.parse('2026-10-16T08:00:00Z')
const at = (s: number) => new Date(T0 + s * 1000).toISOString()
const base = { sessionId: 's1', cwd: '/work/app', isSidechain: false }

const human = (s: number, text: string) => ({ ...base, type: 'user', timestamp: at(s), uuid: `u${s}`, message: { role: 'user', content: text } })
const meta = (s: number, text: string) => ({ ...human(s, ''), isMeta: true, message: { role: 'user', content: [{ type: 'text', text }] } })
const assistant = (s: number, id: string, content: unknown[], stop = 'tool_use', usage = { input_tokens: 10, output_tokens: 5 }) => ({
  ...base,
  type: 'assistant',
  timestamp: at(s),
  uuid: `a${s}`,
  message: { id, model: 'claude-test', role: 'assistant', content, stop_reason: stop, usage },
})
const toolUse = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input })
const result = (s: number, id: string, content: string, isError = false) => ({
  ...base,
  type: 'user',
  timestamp: at(s),
  uuid: `r${s}`,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] },
})

const jsonl = (...recs: unknown[]) => recs.map((r) => JSON.stringify(r)).join('\n')
const parse = (raw: string, mtimeMs = T0) => parseTranscript(raw, { sessionId: 's1', project: 'app', mtimeMs, now: T0 + 3600_000 })

test('a Skill tool call starts a run that collects the following steps until the next prompt', () => {
  const { runs, cwd } = parse(
    jsonl(
      human(0, 'make a chart'),
      assistant(1, 'm1', [toolUse('t-skill', 'Skill', { skill: 'acme:charts', args: '--dark' })]),
      result(2, 't-skill', 'Launching skill: charts'),
      meta(2, 'Base directory for this skill: /skills/charts\n\n# Charts\nDo things.'),
      assistant(3, 'm2', [{ type: 'text', text: 'Reading data first.' }, toolUse('t1', 'Read', { file_path: '/work/app/data.csv' })]),
      result(4, 't1', 'a,b\n1,2'),
      assistant(5, 'm3', [toolUse('t2', 'Bash', { command: 'false', description: 'Run the build' })]),
      result(9, 't2', 'exit 1', true),
      assistant(10, 'm4', [{ type: 'text', text: 'Done.' }], 'end_turn'),
      human(20, 'thanks'),
      assistant(21, 'm5', [toolUse('t3', 'Read', { file_path: '/x' })]),
    ),
  )
  assert.equal(cwd, '/work/app')
  assert.equal(runs.length, 1)
  const [run] = runs
  assert.equal(run.id, 't-skill')
  assert.equal(run.skill, 'acme:charts')
  assert.equal(run.args, '--dark')
  assert.equal(run.prompt, 'make a chart')
  assert.equal(run.status, 'done')
  assert.equal(run.baseDir, '/skills/charts')
  assert.equal(run.loaded, '# Charts\nDo things.')
  assert.equal(run.toolCalls, 2)
  assert.equal(run.errors, 1)
  assert.equal(run.endedAt - run.startedAt, 9000)
  assert.deepEqual(run.tokens, { input: 30, output: 15, cacheRead: 0, cacheWrite: 0 })

  const tools = run.events.filter((e) => e.type === 'tool')
  assert.deepEqual(
    tools.map((t) => [t.name, t.kind, t.summary, t.end! - t.start, t.isError]),
    [
      ['Read', 'read', 'data.csv', 1000, false],
      ['Bash', 'exec', 'Run the build', 4000, true],
    ],
  )
  assert.deepEqual(run.shape, [
    [2000, 1000, 'read'],
    [4000, 4000, 'exec'],
  ])
})

test('usage is counted once per message even when its blocks span several records', () => {
  const { runs } = parse(
    jsonl(
      assistant(1, 'm1', [toolUse('s', 'Skill', { skill: 'x' })]),
      assistant(2, 'm2', [{ type: 'thinking', thinking: '' }]),
      assistant(2, 'm2', [toolUse('t1', 'Glob', { pattern: '*.ts' })]),
      result(3, 't1', 'a.ts'),
    ),
  )
  assert.equal(runs[0].tokens.output, 5)
  assert.equal(runs[0].events.filter((e) => e.type === 'thinking').length, 1)
})

test('a slash command counts as a skill run only when a skill was loaded', () => {
  const { runs } = parse(
    jsonl(
      human(0, '<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>'),
      human(1, '<command-name>/deploy</command-name>\n<command-args>staging</command-args>'),
      meta(1, 'Base directory for this skill: /skills/deploy\n\nDeploy it.'),
      assistant(2, 'm1', [toolUse('t1', 'Bash', { command: 'make deploy' })]),
      result(3, 't1', 'ok'),
      assistant(4, 'm2', [{ type: 'text', text: 'Deployed.' }], 'end_turn'),
    ),
  )
  assert.equal(runs.length, 1)
  assert.equal(runs[0].skill, 'deploy')
  assert.equal(runs[0].trigger, 'slash')
  assert.equal(runs[0].prompt, '/deploy staging')
  assert.equal(runs[0].toolCalls, 1)
})

test('a second Skill call closes the first run', () => {
  const { runs } = parse(
    jsonl(
      assistant(1, 'm1', [toolUse('s1', 'Skill', { skill: 'a' })]),
      assistant(2, 'm2', [toolUse('t1', 'Read', { file_path: '/f' })]),
      result(3, 't1', ''),
      assistant(4, 'm3', [toolUse('s2', 'Skill', { skill: 'b' })]),
      assistant(5, 'm4', [{ type: 'text', text: 'ok' }], 'end_turn'),
    ),
  )
  assert.deepEqual(
    runs.map((r) => [r.skill, r.toolCalls]),
    [
      ['a', 1],
      ['b', 0],
    ],
  )
})

test('an unfinished run is running while the transcript is fresh and interrupted once stale', () => {
  const raw = jsonl(assistant(1, 'm1', [toolUse('s', 'Skill', { skill: 'x' })]), assistant(2, 'm2', [toolUse('t1', 'Bash', { command: 'sleep 99' })]))
  const fresh = parseTranscript(raw, { sessionId: 's1', project: 'app', mtimeMs: T0, now: T0 + 5000 })
  assert.equal(fresh.runs[0].status, 'running')
  assert.equal(parse(raw).runs[0].status, 'interrupted')

  const cancelled = parse(jsonl(assistant(1, 'm1', [toolUse('s', 'Skill', { skill: 'x' })]), human(2, '[Request interrupted by user]')))
  assert.equal(cancelled.runs[0].status, 'interrupted')
})

test('malformed and partial lines are skipped', () => {
  const raw = jsonl(assistant(1, 'm1', [toolUse('s', 'Skill', { skill: 'x' })])) + '\n{"type":"assistant","mess'
  assert.equal(parse(raw).runs.length, 1)
})

test('system-generated turns get readable prompt labels', () => {
  assert.equal(promptLabel('<task-notification>\n<task-id>x</task-id>'), 'Background task finished')
  assert.equal(promptLabel('<pasted_content id="a">\nfix this\n</pasted_content>'), 'fix this')
  assert.equal(promptLabel('plain words'), 'plain words')
})
