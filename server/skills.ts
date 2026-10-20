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
    // SKILL.md is often a symlink (e.g. gstack links each skill into ~/.claude/skills).
    if (entries.some((e) => (e.isFile() || e.isSymbolicLink()) && e.name === 'SKILL.md')) {
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

/**
 * Line-based reading of `key: value` frontmatter, for files strict YAML rejects. Skill descriptions
 * often contain ": " ("Use when: …"), which YAML reads as a nested mapping but Claude Code accepts.
 * Indented lines continue the previous value; `>` and `|` block markers are honored loosely.
 */
export function parseLooseFrontmatter(src: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  let key: string | null = null
  let block: '>' | '|' | null = null
  for (const line of src.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (m) {
      key = m[1]
      const v = m[2].trim()
      block = v === '>' || v === '>-' ? '>' : v === '|' || v === '|-' ? '|' : null
      out[key] = block ? '' : v.replace(/^(['"])([\s\S]*)\1$/, '$2')
    } else if (key && /^\s+\S/.test(line)) {
      const prev = String(out[key] ?? '')
      out[key] = prev ? `${prev}${block === '|' ? '\n' : ' '}${line.trim()}` : line.trim()
    }
  }
  return out
}

export function parseSkillMarkdown(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!m) return { frontmatter: {}, body: raw }
  let frontmatter: Record<string, unknown>
  try {
    const parsed = YAML.parse(m[1])
    frontmatter = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : parseLooseFrontmatter(m[1])
  } catch {
    frontmatter = parseLooseFrontmatter(m[1])
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

/**
 * Lists install paths of the plugins Claude Code actually loads. The plugin cache also keeps
 * superseded versions and marketplaces hold the whole catalog, so neither is scanned directly.
 */
async function installedPluginPaths(): Promise<string[]> {
  try {
    const raw = await fs.readFile(path.join(PLUGINS_DIR, 'installed_plugins.json'), 'utf8')
    const data = JSON.parse(raw) as { plugins?: Record<string, { installPath?: unknown }[]> }
    return Object.values(data.plugins ?? {})
      .flat()
      .map((p) => p.installPath)
      .filter((p): p is string => typeof p === 'string')
  } catch {
    return []
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
  for (const root of await installedPluginPaths()) {
    for (const dir of await findSkillDirs(root, 4)) found.push({ dir, source: 'plugin' })
  }
  // Worktrees under .claude/worktrees carry copies of the main checkout's project skills.
  const worktree = `${path.sep}.claude${path.sep}worktrees${path.sep}`
  for (const cwd of new Set(projectDirs.filter((d) => !d.includes(worktree)))) {
    const root = path.join(cwd, '.claude', 'skills')
    if (await exists(root)) for (const dir of await findSkillDirs(root, 2)) found.push({ dir, source: 'project' })
  }

  // The same SKILL.md can be reachable through several symlinked paths; keep the shallowest one,
  // which is the path Claude Code loads it from.
  const resolved = await Promise.all(
    found.map(async (f) => ({ ...f, real: await fs.realpath(path.join(f.dir, 'SKILL.md')).catch(() => f.dir) })),
  )
  const depth = (p: string) => p.split(path.sep).length
  const byReal = new Map<string, (typeof resolved)[number]>()
  for (const f of resolved) {
    const prev = byReal.get(f.real)
    if (!prev || depth(f.dir) < depth(prev.dir)) byReal.set(f.real, f)
  }
  const skills = await Promise.all([...byReal.values()].map(({ dir, source }) => readSkill(dir, source)))
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
