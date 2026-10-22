import fs from 'node:fs/promises'
import path from 'node:path'
import { AGENT_IDS, detectDefaults, getSettings, resolvePath, settingsFile } from './settings.ts'
import { listSkillFiles, parseSkillMarkdown, readSkill, scanSkills, type SkillEntry } from './skills.ts'
import { loadCodexSessions, loadOpenCodeDb, loadOpenCodeSessions, OPENCODE_DB, parseCodexFile } from './agent-sessions.ts'
import { listSessionFiles, loadAllSessions, parseSessionFile, type ParsedSession } from './transcripts.ts'
import type {
  AgentId,
  AgentScope,
  AgentStatus,
  DayBucket,
  Overview,
  PathStatus,
  RunDetail,
  RunSummary,
  SettingsPayload,
  SkillDetail,
  SkillStats,
  SkillSummary,
  ToolKind,
} from './types.ts'

/** An agent's session folders in effect (none when the agent is turned off). */
function sessionDirs(id: AgentId) {
  const a = getSettings().agents[id]
  return a.enabled ? a.sessions.map((p) => resolvePath(p)) : []
}

/** A session log, named by the file the store keys it under, and the agent that wrote it. */
export interface SessionSource {
  agent: AgentId
  file: string
}

/** In-memory index over parsed transcripts and the skill catalog. Rebuilt incrementally on file changes. */
class Store {
  private sessions = new Map<string, ParsedSession>() // by file
  private skills: SkillEntry[] = []
  private runs: RunDetail[] = []
  private runById = new Map<string, RunDetail>()
  private queue: Promise<unknown> = Promise.resolve()

  async init() {
    await this.reload()
  }

  /** Runs index updates one at a time, so a slow reload cannot finish after a newer update and overwrite it. */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task)
    this.queue = next.catch(() => {})
    return next
  }

  /** Re-reads every session and skill, e.g. after the folders in settings changed. */
  reload(): Promise<void> {
    return this.serial(async () => {
      const loaded = await Promise.all([
        loadAllSessions(sessionDirs('claude-code')),
        loadCodexSessions(sessionDirs('codex')),
        loadOpenCodeSessions(sessionDirs('opencode')),
      ])
      this.sessions = new Map(loaded.flat().map((s) => [s.file, s]))
      await this.reindex()
    })
  }

  /**
   * The session log a changed file belongs to: a top-level Claude Code log, a Codex rollout, or an
   * OpenCode database under a folder in effect.
   *
   * @param file - Absolute path of the changed file.
   * @returns The log to re-read, or null when the file is none of these.
   */
  sessionSource(file: string): SessionSource | null {
    if (file.endsWith('.jsonl')) {
      if (sessionDirs('claude-code').includes(path.dirname(path.dirname(file)))) return { agent: 'claude-code', file }
      if (sessionDirs('codex').some((dir) => file.startsWith(dir + path.sep))) return { agent: 'codex', file }
      return null
    }
    // OpenCode writes through SQLite's write-ahead log, so a change to either file is a change to the database.
    const name = path.basename(file)
    const dir = path.dirname(file)
    if ((name === OPENCODE_DB || name === `${OPENCODE_DB}-wal`) && sessionDirs('opencode').includes(dir)) {
      return { agent: 'opencode', file: path.join(dir, OPENCODE_DB) }
    }
    return null
  }

  /** Folders to watch for session changes and for skill changes. */
  watchRoots(): { sessions: string[]; skills: string[] } {
    const settings = getSettings()
    const skills = AGENT_IDS.filter((id) => settings.agents[id].enabled).flatMap((id) => [...settings.agents[id].skills, ...settings.agents[id].plugins])
    return {
      sessions: AGENT_IDS.flatMap(sessionDirs),
      skills: [...skills, ...settings.extraSkillDirs].map((p) => resolvePath(p)).concat(this.projectSkillRoots()),
    }
  }

  /**
   * Re-reads one session log. An OpenCode database holds many sessions; all of them are replaced.
   *
   * @param source - The log, from {@link Store.sessionSource}.
   * @returns The ids of sessions whose skill runs changed; empty when none did.
   */
  refreshSession(source: SessionSource): Promise<string[]> {
    return this.serial(async () => {
      const inLog = (s: ParsedSession) => (source.agent === 'opencode' ? s.file.startsWith(`${source.file}#`) : s.file === source.file)
      const before = [...this.sessions.values()].filter(inLog)
      const after = await readSessionLog(source)
      // An OpenCode database that cannot be read right now keeps its last sessions.
      if (!after) return []
      for (const s of before) this.sessions.delete(s.file)
      for (const s of after) this.sessions.set(s.file, s)

      const runsBefore = new Map(before.map((s) => [s.id, JSON.stringify(s.runs.map(fingerprint))]))
      const runsAfter = new Map(after.map((s) => [s.id, JSON.stringify(s.runs.map(fingerprint))]))
      const changed = [...new Set([...runsBefore.keys(), ...runsAfter.keys()])].filter((id) => (runsBefore.get(id) ?? '[]') !== (runsAfter.get(id) ?? '[]'))
      const newProject = after.some((s) => s.cwd && !before.find((b) => b.id === s.id)?.cwd)
      if (changed.length || newProject) await this.reindex()
      return changed
    })
  }

  /** Re-scans the skills and matches every run to one, e.g. after a skill folder changed. */
  rebuild(): Promise<void> {
    return this.serial(() => this.reindex())
  }

  private async reindex() {
    const cwds = [...this.sessions.values()].map((s) => s.cwd).filter((c): c is string => !!c)
    const scanned = await scanSkills(getSettings(), cwds)
    const runs = [...this.sessions.values()].flatMap((s) => s.runs).sort((a, b) => b.startedAt - a.startedAt)

    const ids = new Map<string, number>()
    const skills: SkillEntry[] = scanned.map((s) => ({ ...s, id: uniqueId(ids, s.dirName), key: s.dir }))

    // A run that matches no scanned skill came from somewhere we don't scan: bundled with Claude Code, or
    // since uninstalled. Read it from the directory it loaded from, else from the text captured in the
    // transcript. Runs are newest first, so the entry reflects the latest version and older runs match it by name.
    for (const run of runs) {
      const match = matchSkill(run, skills)
      if (match) {
        run.skillId = match.id
        continue
      }
      const name = shortName(run.skill)
      // The same unscanned skill run by another agent joins the entry made for the first one.
      const known = skills.find((s) => s.key === `builtin:${name}`)
      if (known) {
        if (!known.agents.includes(run.agent)) known.agents.push(run.agent)
        run.skillId = known.id
        continue
      }
      const onDisk = run.baseDir ? await readSkill(run.baseDir, 'builtin') : null
      const captured = parseSkillMarkdown(run.loaded ?? '')
      // Bundled skills move with every Claude Code version, so they are keyed by name, not folder.
      const fromRun = { key: `builtin:${name}`, agents: [run.agent] }
      const entry: SkillEntry = onDisk
        ? { ...onDisk, ...fromRun, id: uniqueId(ids, onDisk.dirName) }
        : {
            ...fromRun,
            id: uniqueId(ids, name),
            name,
            dirName: name,
            description:
              typeof captured.frontmatter.description === 'string'
                ? captured.frontmatter.description
                : firstParagraph(captured.body),
            source: 'builtin',
            dir: run.baseDir ?? '',
            frontmatter: captured.frontmatter,
            body: captured.body,
          }
      skills.push(entry)
      run.skillId = entry.id
    }

    this.skills = skills
    this.runs = runs
    this.runById = new Map(runs.map((r) => [r.id, r]))
  }

  /** Whether the skill selection in settings includes this skill. */
  isTracked(s: SkillEntry) {
    const { mode, keys } = getSettings().skillFilter
    return mode === 'all-except' ? !keys.includes(s.key) : keys.includes(s.key)
  }

  /** Tracked skills, narrowed to one agent's when scoped. */
  private visibleSkills(scope: AgentScope) {
    return this.skills.filter((s) => this.isTracked(s) && (!scope || s.agents.includes(scope)))
  }

  /** Runs of tracked skills, narrowed to one agent's when scoped. */
  private visibleRuns(scope: AgentScope) {
    const tracked = new Set(this.skills.filter((s) => this.isTracked(s)).map((s) => s.id))
    return this.runs.filter((r) => r.skillId !== null && tracked.has(r.skillId) && (!scope || r.agent === scope))
  }

  overview(scope: AgentScope = null): Overview {
    const runs = this.visibleRuns(scope)
    const finished = runs.filter((r) => r.status !== 'running')
    const heatmap = Array.from({ length: 7 }, () => Array<number>(24).fill(0))
    const toolMix: Record<ToolKind, number> = { read: 0, write: 0, exec: 0, web: 0, mcp: 0, agent: 0, other: 0 }
    for (const r of runs) {
      const d = new Date(r.startedAt)
      heatmap[(d.getDay() + 6) % 7][d.getHours()]++
      for (const [, , kind] of r.shape) toolMix[kind]++
    }
    const summaries = this.listSkills(scope)
    return {
      totals: {
        runs: runs.length,
        skillsUsed: summaries.filter((s) => s.stats.runs > 0).length,
        skillsInstalled: summaries.filter((s) => s.source !== 'builtin').length,
        toolCalls: runs.reduce((n, r) => n + r.toolCalls, 0),
        outputTokens: runs.reduce((n, r) => n + r.tokens.output, 0),
        inputTokens: runs.reduce((n, r) => n + r.tokens.input + r.tokens.cacheRead + r.tokens.cacheWrite, 0),
        runsWithErrors: runs.filter((r) => r.errors > 0).length,
        avgDurationMs: finished.length
          ? Math.round(finished.reduce((n, r) => n + r.endedAt - r.startedAt, 0) / finished.length)
          : null,
      },
      daily: dayBuckets(runs, 30),
      heatmap,
      topSkills: summaries
        .filter((s) => s.stats.runs > 0)
        .sort((a, b) => b.stats.runs - a.stats.runs || (b.stats.lastRunAt ?? 0) - (a.stats.lastRunAt ?? 0))
        .slice(0, 8)
        .map((s) => ({ id: s.id, name: s.name, source: s.source, ...s.stats })),
      toolMix,
      running: runs.filter((r) => r.status === 'running' || r.status === 'waiting').map(stripRun),
      recent: runs.slice(0, 6).map(stripRun),
    }
  }

  listSkills(scope: AgentScope = null): SkillSummary[] {
    // Within a scope a skill's numbers count only that agent's runs (a shared skill runs under several).
    return this.visibleSkills(scope)
      .map((s) => toSummary(s, this.runs.filter((r) => r.skillId === s.id && (!scope || r.agent === scope))))
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
      daily: dayBuckets(runs, 30).map(({ day, runs: n }) => ({ day, runs: n })),
      runs: runs.slice(0, 100).map(stripRun),
    }
  }

  /** Per agent: whether it is on, and how many tracked skills and runs it has, for the scope switcher. */
  agentSummary() {
    const settings = getSettings()
    return AGENT_IDS.map((id) => ({
      id,
      enabled: settings.agents[id].enabled,
      skills: this.visibleSkills(id).length,
      runs: this.visibleRuns(id).length,
    }))
  }

  /** Skills hidden by the selection in settings, for the "N not tracked" hint. */
  untrackedCount(scope: AgentScope = null) {
    return this.skills.filter((s) => !this.isTracked(s) && (!scope || s.agents.includes(scope))).length
  }

  listRuns(filter: { skill?: string; limit?: number; scope?: AgentScope }): RunSummary[] {
    // A skill opened directly shows its runs even when it is not tracked.
    const runs = filter.skill ? this.runs.filter((r) => r.skillId === filter.skill) : this.visibleRuns(filter.scope ?? null)
    return runs.slice(0, filter.limit ?? 500).map(stripRun)
  }

  getRun(id: string): RunDetail | null {
    return this.runById.get(id) ?? null
  }

  /** Returns each project-level skills directory (`.claude/skills`, `.codex/skills`, …) that holds at least one skill. */
  projectSkillRoots(): string[] {
    return [...new Set(this.skills.filter((s) => s.source === 'project').map((s) => path.dirname(s.dir)))]
  }

  /** Everything the settings page shows: folders in effect and whether they exist, and every skill found. */
  async settingsPayload(): Promise<SettingsPayload> {
    const settings = getSettings()
    const pathStatus = async (paths: string[]): Promise<PathStatus[]> =>
      Promise.all(paths.map(async (p) => ({ path: p, exists: !!(await fs.stat(resolvePath(p)).catch(() => null))?.isDirectory() })))
    const status = {} as Record<AgentId, AgentStatus>
    for (const id of AGENT_IDS) {
      const a = settings.agents[id]
      const dirs = a.sessions.map((p) => resolvePath(p))
      status[id] = {
        skills: await pathStatus(a.skills),
        sessions: await pathStatus(a.sessions),
        plugins: await pathStatus(a.plugins),
        skillCount: this.skills.filter((s) => s.agents.includes(id) && s.source !== 'builtin').length,
        sessionFiles:
          id === 'claude-code' ? (await listSessionFiles(dirs)).length
            : id === 'codex' ? await countFiles(dirs, /\.jsonl$/, 20_000)
              : await countFiles(dirs, /^opencode\.db$/, 1),
      }
    }
    return {
      file: settingsFile(),
      settings,
      defaults: detectDefaults(),
      status,
      extraStatus: await pathStatus(settings.extraSkillDirs),
      skills: this.skills
        .map((s) => ({
          key: s.key,
          name: s.name,
          description: s.description,
          source: s.source,
          agents: s.agents,
          runs: this.runs.filter((r) => r.skillId === s.id).length,
          tracked: this.isTracked(s),
        }))
        .sort((a, b) => b.runs - a.runs || a.name.localeCompare(b.name)),
    }
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

/** Reads one session log in its agent's format; null when an OpenCode database cannot be read. */
async function readSessionLog({ agent, file }: SessionSource): Promise<ParsedSession[] | null> {
  if (agent === 'opencode') return loadOpenCodeDb(file)
  const session = agent === 'codex' ? await parseCodexFile(file) : await parseSessionFile(file)
  return session ? [session] : []
}

function fingerprint(r: RunDetail) {
  // OpenCode updates text and tool parts in place: the event count and timestamps can stay the same.
  return [r.id, r.status, r.endedAt, r.baseDir, r.prompt, r.loaded, r.tokens, r.outcome, r.events]
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
    const byDir = skills.find((s) => s.dir === run.baseDir && s.agents.includes(run.agent))
    if (byDir) return byDir
  }
  const name = shortName(run.skill)
  const candidates = skills.filter((s) => (s.dirName === name || s.name === name) && s.agents.includes(run.agent))
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

/** Counts files matching `pattern` under `roots`, giving up at `cap` (it is only shown as a hint). */
async function countFiles(roots: string[], pattern: RegExp, cap: number): Promise<number> {
  let n = 0
  async function walk(dir: string, depth: number) {
    if (n >= cap || depth > 6) return
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (n >= cap) return
      if (e.isDirectory()) await walk(path.join(dir, e.name), depth + 1)
      else if (e.isFile() && pattern.test(e.name)) n++
    }
  }
  for (const r of roots) await walk(r, 0)
  return n
}

function toSummary(s: SkillEntry, runs: RunDetail[]): SkillSummary {
  return {
    id: s.id,
    key: s.key,
    agents: s.agents,
    name: s.name,
    description: s.description,
    source: s.source,
    dir: s.dir || null,
    stats: stats(runs),
    spark: dayBuckets(runs, 14).map((d) => d.runs),
  }
}

function stripRun(r: RunDetail): RunSummary {
  const { events: _events, baseDir: _baseDir, loaded: _loaded, model: _model, input: _input, outcome: _outcome, ...summary } = r
  return summary
}

/** Buckets runs into the last `days` local calendar days, oldest first. */
function dayBuckets(runs: RunDetail[], days: number): DayBucket[] {
  const buckets = new Map<string, DayBucket>()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const day = dayKey(d)
    buckets.set(day, { day, runs: 0, toolCalls: 0, outputTokens: 0 })
  }
  for (const r of runs) {
    const b = buckets.get(dayKey(new Date(r.startedAt)))
    if (!b) continue
    b.runs++
    b.toolCalls += r.toolCalls
    b.outputTokens += r.tokens.output
  }
  return [...buckets.values()]
}

function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const store = new Store()
