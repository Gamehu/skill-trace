import fs from 'node:fs/promises'
import path from 'node:path'
import YAML from 'yaml'
import { PLUGINS_DIR, USER_SKILLS_DIR } from './config.ts'
import type { SkillSource } from './types.ts'

export interface SkillEntry {
  id: string
  name: string
  dirName: string
  description: string
  source: SkillSource
  dir: string
  frontmatter: Record<string, unknown>
  body: string
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.venv', '__pycache__'])

async function exists(p: string) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

// Finds directories containing a SKILL.md, without descending into a skill once found.
async function findSkillDirs(root: string, maxDepth: number): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: string, depth: number) {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    if (entries.some((e) => e.isFile() && e.name === 'SKILL.md')) {
      out.push(dir)
      return
    }
    if (depth >= maxDepth) return
    await Promise.all(
      entries
        .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && !SKIP_DIRS.has(e.name))
        .map((e) => walk(path.join(dir, e.name), depth + 1)),
    )
  }
  await walk(root, 0)
  return out.sort()
}

export function parseSkillMarkdown(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!m) return { frontmatter: {}, body: raw }
  let frontmatter: Record<string, unknown> = {}
  try {
    const parsed = YAML.parse(m[1])
    if (parsed && typeof parsed === 'object') frontmatter = parsed as Record<string, unknown>
  } catch {
    // Malformed frontmatter: show the body anyway.
  }
  return { frontmatter, body: raw.slice(m[0].length) }
}

export async function readSkill(dir: string, source: SkillSource): Promise<Omit<SkillEntry, 'id'> | null> {
  let raw: string
  try {
    raw = await fs.readFile(path.join(dir, 'SKILL.md'), 'utf8')
  } catch {
    return null
  }
  const { frontmatter, body } = parseSkillMarkdown(raw)
  const dirName = path.basename(dir)
  return {
    name: typeof frontmatter.name === 'string' ? frontmatter.name : dirName,
    dirName,
    description: typeof frontmatter.description === 'string' ? frontmatter.description.trim() : '',
    source,
    dir,
    frontmatter,
    body,
  }
}

/** Scans user, plugin and project skill directories. `projectDirs` are working directories seen in transcripts. */
export async function scanSkills(projectDirs: string[]): Promise<Omit<SkillEntry, 'id'>[]> {
  const found: { dir: string; source: SkillSource }[] = []

  for (const dir of await findSkillDirs(USER_SKILLS_DIR, 4)) {
    // ~/.claude/skills/<name> is authored by the user; anything nested deeper is synced from elsewhere.
    const nested = path.relative(USER_SKILLS_DIR, dir).includes(path.sep)
    found.push({ dir, source: nested ? 'plugin' : 'user' })
  }
  for (const dir of await findSkillDirs(PLUGINS_DIR, 8)) found.push({ dir, source: 'plugin' })
  for (const cwd of new Set(projectDirs)) {
    const root = path.join(cwd, '.claude', 'skills')
    if (await exists(root)) for (const dir of await findSkillDirs(root, 2)) found.push({ dir, source: 'project' })
  }

  const seen = new Set<string>()
  const skills = await Promise.all(
    found
      .filter(({ dir }) => !seen.has(dir) && seen.add(dir))
      .map(({ dir, source }) => readSkill(dir, source)),
  )
  return skills.filter((s) => s !== null)
}

export async function listSkillFiles(dir: string): Promise<{ path: string; size: number }[]> {
  const out: { path: string; size: number }[] = []
  async function walk(d: string) {
    let entries
    try {
      entries = await fs.readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name) || out.length >= 200) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) await walk(p)
      else if (e.isFile()) {
        const stat = await fs.stat(p).catch(() => null)
        out.push({ path: path.relative(dir, p), size: stat?.size ?? 0 })
      }
    }
  }
  await walk(dir)
  return out.sort((a, b) => a.path.localeCompare(b.path))
}
