import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { parseSkillMarkdown, scanSkills } from './skills.ts'
import { detectDefaults } from './settings.ts'

test('frontmatter with a colon inside the description still parses', () => {
  const { frontmatter, body } = parseSkillMarkdown(
    '---\nname: incident-triage\ndescription: First 10 minutes of an incident: pull logs, then report.\n---\n\n# Body\n',
  )
  assert.equal(frontmatter.name, 'incident-triage')
  assert.equal(frontmatter.description, 'First 10 minutes of an incident: pull logs, then report.')
  assert.equal(body, '\n# Body\n')
})

test('loose frontmatter keeps folded and quoted values', () => {
  const { frontmatter } = parseSkillMarkdown('---\nname: "x: y"\ndescription: Use when: the user asks\n  for a report.\nallowed-tools: Bash, Read\n---\nbody')
  assert.equal(frontmatter.name, 'x: y')
  assert.equal(frontmatter.description, 'Use when: the user asks for a report.')
  assert.equal(frontmatter['allowed-tools'], 'Bash, Read')
})

test('valid YAML is read as YAML', () => {
  const { frontmatter } = parseSkillMarkdown('---\nname: a\nmetadata:\n  version: 2\n---\n')
  assert.deepEqual(frontmatter, { name: 'a', metadata: { version: 2 } })
})

test('scans Codex plugin cache and shared agent skills', async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-trace-'))
  t.after(() => fs.rm(home, { recursive: true, force: true }))
  const shared = path.join(home, '.agents', 'skills', 'shared')
  const example = path.join(home, '.codex', 'plugins', 'cache', 'vendor', 'example')
  const superseded = path.join(example, '1.0.0', 'skills', 'cached')
  const plugin = path.join(example, '1.1.0', 'skills', 'cached')
  for (const dir of [shared, superseded, plugin]) {
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${path.basename(dir)}\n---\nBody`)
  }
  // The cache keeps the superseded version; the one written last is in use.
  const old = new Date(Date.now() - 86_400_000)
  await fs.utimes(path.join(example, '1.0.0'), old, old)
  const skills = await scanSkills(detectDefaults({}, home), [])
  assert.deepEqual(skills.find((s) => s.name === 'shared')?.agents, ['codex', 'opencode'])
  assert.deepEqual(skills.filter((s) => s.name === 'cached').map((s) => [s.dir, s.agents, s.source]), [[plugin, ['codex'], 'plugin']])
})
