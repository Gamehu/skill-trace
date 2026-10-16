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

test('questions, plans and replies stay in the run, with what the person chose', () => {
  const { runs } = parse(
    jsonl(
      human(0, 'migrate the invoices table'),
      assistant(1, 'm1', [toolUse('s', 'Skill', { skill: 'db-migrate' })]),
      assistant(2, 'm2', [
        toolUse('q1', 'AskUserQuestion', {
          questions: [{ question: 'Which strategy?', header: 'Strategy', multiSelect: false, options: [{ label: 'Online', description: 'No lock' }, { label: 'Offline' }] }],
        }),
      ]),
      { ...result(10, 'q1', 'The user answered: "Which strategy?"="Online"'), toolUseResult: { answers: { 'Which strategy?': 'Online' } } },
      assistant(11, 'm3', [toolUse('p1', 'ExitPlanMode', { plan: '1. add column\n2. backfill' })]),
      result(15, 'p1', "The user doesn't want to proceed with this tool use. To tell you how to proceed, the user said:\nbackfill in batches", true),
      assistant(16, 'm4', [toolUse('w1', 'Bash', { command: 'rm -rf db/' })]),
      result(18, 'w1', "The user doesn't want to proceed with this tool use. The tool use was rejected.", true),
      assistant(19, 'm5', [{ type: 'text', text: 'Plan updated. Shall I apply it to staging?' }], 'end_turn'),
      human(40, '确认'),
      assistant(41, 'm6', [toolUse('e1', 'Edit', { file_path: '/work/app/db/m.sql', old_string: 'a\nb', new_string: 'a\nc\nd' })]),
      result(42, 'e1', 'The file has been updated.'),
      assistant(43, 'm7', [toolUse('w2', 'Write', { file_path: '/work/app/NOTES.md', content: 'one\ntwo' })]),
      result(44, 'w2', 'File created successfully at: /work/app/NOTES.md'),
      assistant(45, 'm8', [{ type: 'text', text: '## Done\nApplied **2** changes.' }], 'end_turn'),
      human(60, 'now write the weekly report'),
    ),
  )
  assert.equal(runs.length, 1)
  const [run] = runs
  assert.equal(run.input, 'migrate the invoices table')
  assert.equal(run.status, 'done')
  assert.equal(run.errors, 0, 'declines are decisions, not tool errors')
  assert.equal(run.humanTurns, 4)

  const ask = run.events.find((e) => e.type === 'ask')
  assert.ok(ask?.type === 'ask')
  assert.deepEqual(ask.answers, { 'Which strategy?': 'Online' })
  assert.equal(ask.questions[0].options[1].description, null)

  const plan = run.events.find((e) => e.type === 'plan')
  assert.ok(plan?.type === 'plan')
  assert.equal(plan.approved, false)
  assert.equal(plan.feedback, 'backfill in batches')

  const people = run.events.flatMap((e) => (e.type === 'human' ? [[e.kind, e.text, e.tool ?? null]] : []))
  assert.deepEqual(people, [
    ['reject', '', 'Bash'],
    ['reply', '确认', null],
  ])

  assert.equal(run.outcome.text, '## Done\nApplied **2** changes.')
  assert.equal(run.result, 'Done · Applied 2 changes.')
  assert.deepEqual(
    run.outcome.files.map((f) => [f.path, f.op, f.additions, f.deletions]),
    [
      ['db/m.sql', 'edit', 2, 1],
      ['NOTES.md', 'create', 2, 0],
    ],
  )
})

test('a new request after the skill finished starts outside the run', () => {
  const { runs } = parse(
    jsonl(
      assistant(1, 'm1', [toolUse('s', 'Skill', { skill: 'x' })]),
      assistant(2, 'm2', [{ type: 'text', text: 'All done.' }], 'end_turn'),
      human(10, 'refactor the auth module next'),
      assistant(11, 'm3', [toolUse('t1', 'Read', { file_path: '/a' })]),
      result(12, 't1', ''),
    ),
  )
  assert.equal(runs[0].toolCalls, 0)
  assert.equal(runs[0].humanTurns, 0)
})

test('steering: queued messages and instructions after an interruption belong to the run', () => {
  const queued = (s: number, prompt: string) => ({
    ...base,
    type: 'attachment',
    timestamp: at(s),
    uuid: `q${s}`,
    attachment: { type: 'queued_command', prompt, origin: { kind: 'human' } },
  })
  const { runs } = parse(
    jsonl(
      assistant(1, 'm1', [toolUse('s', 'Skill', { skill: 'x' })]),
      assistant(2, 'm2', [toolUse('t1', 'Bash', { command: 'make' })]),
      queued(3, 'also run the linter'),
      result(4, 't1', 'ok'),
      human(5, '[Request interrupted by user]'),
      human(6, 'use pnpm instead of npm for everything'),
      assistant(7, 'm3', [{ type: 'text', text: 'Switched to pnpm.' }], 'end_turn'),
    ),
  )
  const people = runs[0].events.flatMap((e) => (e.type === 'human' ? [[e.kind, e.text]] : []))
  assert.deepEqual(people, [
    ['steer', 'also run the linter'],
    ['interrupt', ''],
    ['steer', 'use pnpm instead of npm for everything'],
  ])
  assert.equal(runs[0].status, 'done')
})

test('a skill that stopped to ask is waiting while the session is fresh', () => {
  const raw = jsonl(assistant(1, 'm1', [toolUse('s', 'Skill', { skill: 'x' })]), assistant(2, 'm2', [{ type: 'text', text: '要我直接提交吗？' }], 'end_turn'))
  assert.equal(parseTranscript(raw, { sessionId: 's1', project: 'app', mtimeMs: T0, now: T0 + 5000 }).runs[0].status, 'waiting')
  assert.equal(parse(raw).runs[0].status, 'done')
})
