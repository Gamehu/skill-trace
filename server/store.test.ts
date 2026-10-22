import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

// The store reads the settings in effect, which come from the home folder and the environment.
const home = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-trace-store-'))
after(() => fs.rm(home, { recursive: true, force: true }))
process.env.HOME = home
process.env.SKILL_TRACE_CONFIG = path.join(home, 'config.json')
for (const name of ['CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'SKILL_TRACE_CLAUDE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME']) delete process.env[name]
const { loadSettings } = await import('./settings.ts')
const { store } = await import('./store.ts')

const T0 = Date.parse('2026-10-20T08:00:00Z')
const at = (s: number) => new Date(T0 + s * 1000).toISOString()
const claudeLog = path.join(home, '.claude', 'projects', 'app', 'claude-1.jsonl')
const codexLog = path.join(home, '.codex', 'sessions', '2026', '10', '20', 'rollout-1.jsonl')
const opencodeDir = path.join(home, '.local', 'share', 'opencode')

const claudeRun = [
  { type: 'user', timestamp: at(0), uuid: 'u0', cwd: '/work/app', message: { role: 'user', content: 'tidy up' } },
  { type: 'assistant', timestamp: at(1), uuid: 'a1', message: { id: 'm1', role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Skill', input: { skill: 'mystery' } }], stop_reason: 'tool_use' } },
  { type: 'user', timestamp: at(2), uuid: 'u2', isMeta: true, message: { role: 'user', content: [{ type: 'text', text: 'Base directory for this skill: /gone/mystery\n\n# Mystery' }] } },
]
const codexRun = (callId: string, s: number) => [
  { timestamp: at(s), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ text: `request ${callId}` }] } },
  { timestamp: at(s + 1), type: 'response_item', payload: { type: 'function_call', call_id: callId, name: 'exec_command', arguments: '{"cmd":"cat /gone/skills/mystery/SKILL.md"}' } },
]
const jsonl = (recs: unknown[]) => recs.map((r) => JSON.stringify(r)).join('\n') + '\n'

await fs.mkdir(path.dirname(claudeLog), { recursive: true })
await fs.mkdir(path.dirname(codexLog), { recursive: true })
await fs.writeFile(claudeLog, jsonl(claudeRun))
await fs.writeFile(codexLog, jsonl(codexRun('c1', 10)))
await loadSettings()
await store.reload()

test('a changed file is routed to the session log it belongs to', () => {
  assert.deepEqual(store.sessionSource(claudeLog), { agent: 'claude-code', file: claudeLog })
  assert.deepEqual(store.sessionSource(codexLog), { agent: 'codex', file: codexLog })
  // Subagent logs one level deeper are not Claude Code sessions.
  assert.equal(store.sessionSource(path.join(path.dirname(claudeLog), 'claude-1', 'subagents', 'a.jsonl')), null)
  const db = path.join(opencodeDir, 'opencode.db')
  assert.deepEqual(store.sessionSource(`${db}-wal`), { agent: 'opencode', file: db })
  assert.equal(store.sessionSource(path.join(opencodeDir, 'xopencode.db')), null)
  assert.equal(store.sessionSource(path.join(home, 'notes.jsonl')), null)
})

test('an unscanned skill run by two agents is one entry listing both', () => {
  const mystery = store.listSkills().filter((s) => s.name === 'mystery')
  assert.equal(mystery.length, 1)
  assert.deepEqual([...mystery[0].agents].sort(), ['claude-code', 'codex'])
  assert.equal(mystery[0].stats.runs, 2)
})

test('refreshing a Codex rollout reports its session only when its runs changed', async () => {
  const source = store.sessionSource(codexLog)!
  assert.deepEqual(await store.refreshSession(source), [])
  await fs.appendFile(codexLog, jsonl(codexRun('c2', 20)))
  assert.deepEqual(await store.refreshSession(source), ['rollout-1'])
  assert.equal(store.listRuns({}).filter((r) => r.agent === 'codex').length, 2)
})

test('refreshing a session replaces a run when text changes without a new event or timestamp', async () => {
  const source = store.sessionSource(codexLog)!
  const reply = (text: string) => JSON.stringify({ timestamp: at(22), type: 'response_item', payload: {
    type: 'message', role: 'assistant', content: [{ text }],
  } })
  await fs.appendFile(codexLog, `${reply('First answer')}\n`)
  assert.deepEqual(await store.refreshSession(source), ['rollout-1'])
  const before = await fs.readFile(codexLog, 'utf8')
  await fs.writeFile(codexLog, before.replace(reply('First answer'), reply('Revised answer')))
  assert.deepEqual(await store.refreshSession(source), ['rollout-1'])
  assert.equal(store.getRun('codex:rollout-1:c2:mystery')?.result, 'Revised answer')
})
