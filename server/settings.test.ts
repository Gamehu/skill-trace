import assert from 'node:assert/strict'
import { test } from 'node:test'
import { detectDefaults, diff, merge, resolvePath, settingsFile, validate } from './settings.ts'

const HOME = '/home/me'

test('defaults honor each agent’s own environment variables', () => {
  const d = detectDefaults({ CODEX_HOME: '/opt/codex', XDG_DATA_HOME: '/data' }, HOME)
  assert.deepEqual(d.agents['claude-code'].skills, ['/home/me/.claude/skills'])
  assert.deepEqual(d.agents['claude-code'].sessions, ['/home/me/.claude/projects'])
  assert.equal(d.agents.codex.skills[0], '/opt/codex/skills')
  assert.deepEqual(d.agents.opencode.skills, ['/home/me/.config/opencode/skills'])
  assert.deepEqual(d.agents.opencode.sessions, ['/data/opencode'])
  assert.equal(settingsFile({}, HOME), '/home/me/.config/skill-trace/config.json')
})

test('only changes are stored, and merging them back restores the settings', () => {
  const defaults = detectDefaults({}, HOME)
  const changed = structuredClone(defaults)
  changed.agents.codex.enabled = false
  changed.agents['claude-code'].skills = ['~/work/skills']
  changed.skillFilter = { mode: 'only', keys: ['/home/me/.claude/skills/pr-review'] }

  const stored = diff(defaults, changed)
  assert.deepEqual(stored, {
    agents: { 'claude-code': { skills: ['~/work/skills'] }, codex: { enabled: false } },
    skillFilter: { mode: 'only', keys: ['/home/me/.claude/skills/pr-review'] },
  })
  assert.deepEqual(merge(defaults, stored), changed)
  assert.deepEqual(diff(defaults, defaults), {})
})

test('malformed stored settings fall back to the defaults', () => {
  const defaults = detectDefaults({}, HOME)
  assert.deepEqual(merge(defaults, { agents: { codex: { enabled: 'yes', skills: [42] } }, skillFilter: { mode: 'some' } }), defaults)
  assert.deepEqual(merge(defaults, null), defaults)
})

test('validation asks for absolute paths', () => {
  const s = detectDefaults({}, HOME)
  assert.equal(validate(s), null)
  s.agents.opencode.skills = ['skills/here']
  assert.match(validate(s) ?? '', /not an absolute path/)
  assert.match(validate({}) ?? '', /Missing settings/)
})

test('~ expands to the home folder', () => {
  assert.equal(resolvePath('~/x/y', HOME), '/home/me/x/y')
  assert.equal(resolvePath('~', HOME), '/home/me')
  assert.equal(resolvePath(' /abs/path ', HOME), '/abs/path')
})
