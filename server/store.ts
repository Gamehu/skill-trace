import fs from 'node:fs/promises'
import path from 'node:path'
import { listSkillFiles, parseSkillMarkdown, readSkill, scanSkills, type SkillEntry } from './skills.ts'
import { loadAllSessions, parseSessionFile, type ParsedSession } from './transcripts.ts'
import type { RunDetail, RunSummary, SkillDetail, SkillStats, SkillSummary } from './types.ts'

/** In-memory index over parsed transcripts and the skill catalog. Rebuilt incrementally on file changes. */
class Store {
  private sessions = new Map<string, ParsedSession>() // by file
  private skills: SkillEntry[] = []
  private runs: RunDetail[] = []
  private runById = new Map<string, RunDetail>()

  async init() {
    for (const s of await loadAllSessions()) this.sessions.set(s.file, s)
    await this.rebuild()
  }

  /** Re-parses one transcript; returns the session id if its skill runs changed. */
  async refreshSession(file: string): Promise<string | null> {
    const before = this.sessions.get(file)
    const s = await parseSessionFile(file)
    if (s) this.sessions.set(file, s)
    else this.sessions.delete(file)
    const changed = JSON.stringify(before?.runs.map(fingerprint)) !== JSON.stringify(s?.runs.map(fingerprint))
    const newProject = s?.cwd && !before?.cwd
    if (changed || newProject) await this.rebuild()
    return changed ? (s?.id ?? before?.id ?? null) : null
  }

  async rebuild() {
    const cwds = [...this.sessions.values()].map((s) => s.cwd).filter((c): c is string => !!c)
    const scanned = await scanSkills(cwds)
    const runs = [...this.sessions.values()].flatMap((s) => s.runs).sort((a, b) => b.startedAt - a.startedAt)

    // Skills that ran from a directory we did not scan (e.g. bundled with Claude Code) are added from the run's base dir.
    const knownDirs = new Set(scanned.map((s) => s.dir))
    const extraDirs = new Set(runs.map((r) => r.baseDir).filter((d): d is string => !!d && !knownDirs.has(d)))
    for (const dir of extraDirs) {
      const s = await readSkill(dir, 'builtin')
      if (s) scanned.push(s)
    }

    const ids = new Map<string, number>()
    const skills: SkillEntry[] = scanned.map((s) => ({ ...s, id: uniqueId(ids, s.dirName) }))

    // Whatever is left was invoked but has no SKILL.md on disk; fall back to the text captured in the transcript.
    // Runs are newest first, so the entry is built from the latest version and later runs match it by name.
    for (const run of runs) {
      run.skillId = matchSkill(run, skills)?.id ?? null
      if (run.skillId) continue
      const name = shortName(run.skill)
      const { frontmatter, body } = parseSkillMarkdown(run.loaded ?? '')
      const entry: SkillEntry = {
        id: uniqueId(ids, name),
        name,
        dirName: name,
        description: typeof frontmatter.description === 'string' ? frontmatter.description : firstParagraph(body),
        source: 'builtin',
        dir: run.baseDir ?? '',
        frontmatter,
        body,
      }
      skills.push(entry)
      run.skillId = entry.id
    }

    this.skills = skills
    this.runs = runs
    this.runById = new Map(runs.map((r) => [r.id, r]))
  }

  listSkills(): SkillSummary[] {
    return this.skills
      .map((s) => toSummary(s, this.runs.filter((r) => r.skillId === s.id)))
      .sort((a, b) => (b.stats.lastRunAt ?? 0) - (a.stats.lastRunAt ?? 0) || a.name.localeCompare(b.name))
  }

  async getSkill(id: string): Promise<SkillDetail | null> {
    const s = this.skills.find((x) => x.id === id)
    if (!s) return null
    const runs = this.runs.filter((r) => r.skillId === id)
    // Re-read so edits to SKILL.md show without waiting for the watcher.
    const fresh = s.dir ? await readSkill(s.dir, s.source) : null
    return {
      ...toSummary(fresh ? { ...s, ...fresh } : s, runs),
      frontmatter: (fresh ?? s).frontmatter,
      body: fresh?.body ?? (s.body || null),
      files: s.dir ? await listSkillFiles(s.dir) : [],
      daily: daily(runs, 30),
      runs: runs.slice(0, 100).map(stripRun),
    }
  }

  listRuns(filter: { skill?: string; limit?: number }): RunSummary[] {
    const runs = filter.skill ? this.runs.filter((r) => r.skillId === filter.skill) : this.runs
    return runs.slice(0, filter.limit ?? 500).map(stripRun)
  }

  getRun(id: string): RunDetail | null {
    return this.runById.get(id) ?? null
  }

  skillDirs(): string[] {
    return this.skills.map((s) => s.dir).filter(Boolean)
  }

  async readSkillFile(id: string, rel: string): Promise<string | null> {
    const s = this.skills.find((x) => x.id === id)
    if (!s?.dir) return null
    const full = path.resolve(s.dir, rel)
    if (!full.startsWith(s.dir + path.sep)) return null
    const stat = await fs.stat(full).catch(() => null)
    if (!stat?.isFile() || stat.size > 512_000) return null
    return fs.readFile(full, 'utf8')
  }
}

function fingerprint(r: RunDetail) {
  return [r.id, r.status, r.events.length, r.endedAt, r.baseDir]
}

function firstParagraph(md: string) {
  const para = md.split(/\n\s*\n/).find((p) => p.trim() && !p.trim().startsWith('#'))
  return para ? para.replace(/\s+/g, ' ').replace(/[*_`]/g, '').trim().slice(0, 300) : ''
}

function uniqueId(ids: Map<string, number>, name: string) {
  const base = slug(name)
  const n = (ids.get(base) ?? 0) + 1
  ids.set(base, n)
  return n === 1 ? base : `${base}-${n}`
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'skill'
}

// "plugin:name" and "anthropic-skills:name" both refer to the skill named "name".
function shortName(skill: string) {
  return skill.split(':').pop() ?? skill
}

function matchSkill(run: RunDetail, skills: SkillEntry[]): SkillEntry | undefined {
  if (run.baseDir) {
    const byDir = skills.find((s) => s.dir === run.baseDir)
    if (byDir) return byDir
  }
  const name = shortName(run.skill)
  const candidates = skills.filter((s) => s.dirName === name || s.name === name)
  // Prefer the project-level skill from the run's own working directory.
  return (
    candidates.find((s) => s.source === 'project' && run.cwd && s.dir.startsWith(run.cwd + path.sep)) ??
    candidates.find((s) => s.source !== 'project') ??
    candidates[0]
  )
}

function stats(runs: RunDetail[]): SkillStats {
  const finished = runs.filter((r) => r.status !== 'running')
  return {
    runs: runs.length,
    errors: runs.filter((r) => r.errors > 0).length,
    lastRunAt: runs[0]?.startedAt ?? null,
    avgDurationMs: finished.length
      ? Math.round(finished.reduce((sum, r) => sum + (r.endedAt - r.startedAt), 0) / finished.length)
      : null,
  }
}

function toSummary(s: SkillEntry, runs: RunDetail[]): SkillSummary {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    source: s.source,
    dir: s.dir || null,
    stats: stats(runs),
  }
}

function stripRun(r: RunDetail): RunSummary {
  const { events: _events, baseDir: _baseDir, loaded: _loaded, model: _model, ...summary } = r
  return summary
}

function daily(runs: RunDetail[], days: number) {
  const out: { day: string; runs: number }[] = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const counts = new Map<string, number>()
  for (const r of runs) {
    const key = dayKey(new Date(r.startedAt))
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const key = dayKey(d)
    out.push({ day: key, runs: counts.get(key) ?? 0 })
  }
  return out
}

function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const store = new Store()
