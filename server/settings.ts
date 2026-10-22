import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AgentId, AgentSettings, Settings, SkillFilter } from './types.ts'

export const AGENT_IDS: AgentId[] = ['claude-code', 'codex', 'opencode']

/**
 * Where each agent keeps its data when nothing is configured. Each agent's own environment variables
 * (CLAUDE_CONFIG_DIR, CODEX_HOME, XDG_*) are honored, the way the agent itself honors them.
 */
export function detectDefaults(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): Settings {
  const claude = env.SKILL_TRACE_CLAUDE_HOME ?? env.CLAUDE_CONFIG_DIR ?? path.join(home, '.claude')
  const codex = env.CODEX_HOME ?? path.join(home, '.codex')
  const xdgConfig = env.XDG_CONFIG_HOME ?? path.join(home, '.config')
  const xdgData = env.XDG_DATA_HOME ?? path.join(home, '.local', 'share')
  const sharedSkills = path.join(home, '.agents', 'skills')
  return {
    agents: {
      'claude-code': {
        enabled: true,
        skills: [path.join(claude, 'skills')],
        sessions: [path.join(claude, 'projects')],
        plugins: [path.join(claude, 'plugins')],
      },
      codex: {
        enabled: true,
        skills: [path.join(codex, 'skills'), sharedSkills, ...(process.platform === 'win32' ? [] : ['/etc/codex/skills'])],
        sessions: [path.join(codex, 'sessions')],
        plugins: [path.join(codex, 'plugins', 'cache')],
      },
      opencode: {
        enabled: true,
        skills: [path.join(xdgConfig, 'opencode', 'skills'), sharedSkills],
        sessions: [path.join(xdgData, 'opencode')],
        plugins: [],
      },
    },
    extraSkillDirs: [],
    skillFilter: { mode: 'all-except', keys: [] },
  }
}

export function settingsFile(env: NodeJS.ProcessEnv = process.env, home = os.homedir()) {
  return env.SKILL_TRACE_CONFIG ?? path.join(env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'skill-trace', 'config.json')
}

/** Expands a leading `~` and resolves to an absolute path. */
export function resolvePath(p: string, home = os.homedir()) {
  const t = p.trim()
  return path.resolve(t === '~' ? home : t.startsWith('~/') || t.startsWith('~\\') ? path.join(home, t.slice(2)) : t)
}

/** What gets written to disk: only the fields that differ from the detected defaults. */
interface Stored {
  agents?: Partial<Record<AgentId, Partial<AgentSettings>>>
  extraSkillDirs?: string[]
  skillFilter?: SkillFilter
}

const FIELDS = ['enabled', 'skills', 'sessions', 'plugins'] as const

/** Applies stored overrides on top of the defaults, ignoring anything malformed. */
export function merge(defaults: Settings, stored: unknown): Settings {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Stored
  const out = structuredClone(defaults)
  for (const id of AGENT_IDS) {
    const o = s.agents?.[id]
    if (!o || typeof o !== 'object') continue
    if (typeof o.enabled === 'boolean') out.agents[id].enabled = o.enabled
    for (const f of ['skills', 'sessions', 'plugins'] as const) if (isPathList(o[f])) out.agents[id][f] = o[f]
  }
  if (isPathList(s.extraSkillDirs)) out.extraSkillDirs = s.extraSkillDirs
  if (isFilter(s.skillFilter)) out.skillFilter = s.skillFilter
  return out
}

/** The minimal overrides that turn `defaults` into `settings`. */
export function diff(defaults: Settings, settings: Settings): Stored {
  const agents: Stored['agents'] = {}
  for (const id of AGENT_IDS) {
    const changed: Partial<AgentSettings> = {}
    for (const f of FIELDS) {
      if (JSON.stringify(settings.agents[id][f]) !== JSON.stringify(defaults.agents[id][f])) Object.assign(changed, { [f]: settings.agents[id][f] })
    }
    if (Object.keys(changed).length) agents[id] = changed
  }
  return {
    ...(Object.keys(agents).length ? { agents } : {}),
    ...(settings.extraSkillDirs.length ? { extraSkillDirs: settings.extraSkillDirs } : {}),
    ...(settings.skillFilter.mode !== 'all-except' || settings.skillFilter.keys.length ? { skillFilter: settings.skillFilter } : {}),
  }
}

function isPathList(v: unknown): v is string[] {
  return Array.isArray(v) && v.length <= 50 && v.every((p) => typeof p === 'string' && p.trim().length > 0 && p.length < 4096)
}

function isFilter(v: unknown): v is SkillFilter {
  if (!v || typeof v !== 'object') return false
  const f = v as SkillFilter
  return (f.mode === 'all-except' || f.mode === 'only') && Array.isArray(f.keys) && f.keys.length <= 10_000 && f.keys.every((k) => typeof k === 'string' && k.length < 4096)
}

/** Checks a settings object sent by the UI; returns an error message, or null when it is usable. */
export function validate(v: unknown): string | null {
  if (!v || typeof v !== 'object') return 'Expected a settings object.'
  const s = v as Settings
  for (const id of AGENT_IDS) {
    const a = s.agents?.[id]
    if (!a || typeof a.enabled !== 'boolean') return `Missing settings for ${id}.`
    for (const f of ['skills', 'sessions', 'plugins'] as const) {
      if (!Array.isArray(a[f]) || (a[f].length > 0 && !isPathList(a[f]))) return `Folders for ${id} must be a list of paths.`
      const relative = a[f].find((p) => !/^(~|\/|[A-Za-z]:[\\/])/.test(p.trim()))
      if (relative) return `“${relative}” is not an absolute path. Start it with / or ~.`
    }
  }
  if (!Array.isArray(s.extraSkillDirs) || (s.extraSkillDirs.length > 0 && !isPathList(s.extraSkillDirs))) return 'Extra skill folders must be a list of paths.'
  if (!isFilter(s.skillFilter)) return 'Invalid skill selection.'
  return null
}

let current: Settings | null = null

/** The settings in effect: detected defaults plus whatever the person saved. */
export async function loadSettings(): Promise<Settings> {
  const defaults = detectDefaults()
  let stored: unknown = {}
  try {
    stored = JSON.parse(await fs.readFile(settingsFile(), 'utf8'))
  } catch {
    // No settings saved yet, or unreadable: run on the defaults.
  }
  current = merge(defaults, stored)
  return current
}

export function getSettings(): Settings {
  if (!current) throw new Error('loadSettings() has not run')
  return current
}

/** Saves the person's choices (as a diff from the defaults) and makes them current. */
export async function saveSettings(next: Settings): Promise<Settings> {
  const file = settingsFile()
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(diff(detectDefaults(), next), null, 2) + '\n')
  return loadSettings()
}
