import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseSkillMarkdown } from './skills.ts'

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
