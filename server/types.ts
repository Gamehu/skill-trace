// Shared between the API server and the web UI (type-only imports on the web side).

export type SkillSource = 'user' | 'project' | 'plugin' | 'builtin'

/** The coding agents whose skills and sessions can be read. */
export type AgentId = 'claude-code' | 'codex' | 'opencode'

export interface AgentSettings {
  enabled: boolean
  /** Folders holding user-level skills (each skill is a sub-folder with a SKILL.md). */
  skills: string[]
  /** Folders holding session logs. */
  sessions: string[]
  /** Claude Code: the plugins folder holding installed_plugins.json. */
  plugins: string[]
}

/**
 * all-except: track every skill except `keys` (new skills are tracked automatically).
 * only: track just `keys` (new skills stay out until picked).
 */
export interface SkillFilter {
  mode: 'all-except' | 'only'
  keys: string[]
}

export interface Settings {
  agents: Record<AgentId, AgentSettings>
  /** More skill folders to read, beyond each agent's own. */
  extraSkillDirs: string[]
  skillFilter: SkillFilter
}

export interface PathStatus {
  path: string
  exists: boolean
}

export interface AgentStatus {
  skills: PathStatus[]
  sessions: PathStatus[]
  plugins: PathStatus[]
  skillCount: number
  sessionFiles: number
  /** Whether this agent's sessions can be replayed yet (skills are listed either way). */
  replay: boolean
}

export interface SettingsPayload {
  /** Where the settings are saved. */
  file: string
  settings: Settings
  defaults: Settings
  status: Record<AgentId, AgentStatus>
  extraStatus: PathStatus[]
  /** Every skill found with the current folders, tracked or not. */
  skills: { key: string; name: string; description: string; source: SkillSource; agents: AgentId[]; runs: number; tracked: boolean }[]
}

export interface SkillSummary {
  id: string
  /** Stable identity used by the skill selection in settings. */
  key: string
  /** Agents that load this skill, by where it lives (empty for extra folders). */
  agents: AgentId[]
  name: string
  description: string
  source: SkillSource
  dir: string | null
  stats: SkillStats
  /** Runs per day over the last 14 days, oldest first. */
  spark: number[]
}

export interface SkillStats {
  runs: number
  errors: number
  lastRunAt: number | null
  avgDurationMs: number | null
}

export interface SkillDetail extends SkillSummary {
  frontmatter: Record<string, unknown>
  body: string | null
  files: { path: string; size: number }[]
  daily: { day: string; runs: number }[]
  runs: RunSummary[]
}

/** `waiting`: the skill asked you something and the session is still open. */
export type RunStatus = 'running' | 'waiting' | 'done' | 'interrupted'
export type RunTrigger = 'model' | 'slash'

export interface RunSummary {
  id: string
  agent: AgentId
  skill: string
  skillId: string | null
  args: string | null
  trigger: RunTrigger
  status: RunStatus
  sessionId: string
  project: string
  cwd: string | null
  prompt: string | null
  startedAt: number
  endedAt: number
  toolCalls: number
  errors: number
  tokens: TokenUsage
  // Compact shape of the run for list sparklines: [offsetMs, durationMs, kind]
  shape: [number, number, ToolKind][]
  /** First lines of the skill's final reply, plain text. */
  result: string | null
  /** Questions answered, plans reviewed, replies, interruptions and refusals by the person. */
  humanTurns: number
  filesChanged: number
}

export interface TokenUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export type ToolKind = 'read' | 'write' | 'exec' | 'web' | 'mcp' | 'agent' | 'other'

export type TraceEvent =
  | {
      type: 'tool'
      id: string
      name: string
      kind: ToolKind
      summary: string
      input: string
      output: string | null
      isError: boolean
      start: number
      end: number | null
    }
  | { type: 'text'; id: string; text: string; at: number }
  | { type: 'thinking'; id: string; at: number }
  /** AskUserQuestion: options Claude offered and what the person picked (free text when they typed their own). */
  | { type: 'ask'; id: string; at: number; answeredAt: number | null; questions: AskQuestion[]; answers: Record<string, string> | null; declined: boolean }
  /** ExitPlanMode: a plan put to the person for approval. */
  | { type: 'plan'; id: string; at: number; answeredAt: number | null; plan: string; approved: boolean | null; feedback: string | null }
  /** Something the person did inside the run. */
  | { type: 'human'; id: string; at: number; kind: HumanKind; text: string; tool?: string }

/**
 * reply: answered after Claude stopped to ask; steer: typed while Claude was working;
 * interrupt: pressed Esc; reject: declined a tool call when asked for permission.
 */
export type HumanKind = 'reply' | 'steer' | 'interrupt' | 'reject'

export interface AskQuestion {
  question: string
  header: string | null
  multiSelect: boolean
  options: { label: string; description: string | null }[]
}

export interface FileChange {
  path: string
  /** create: the run wrote a new file; edit: it changed an existing one. */
  op: 'create' | 'edit'
  additions: number
  deletions: number
  edits: { old: string; new: string }[]
}

export interface RunDetail extends RunSummary {
  /** The full text of the request that led to the skill. */
  input: string | null
  outcome: {
    /** The skill's final reply (markdown). */
    text: string | null
    files: FileChange[]
  }
  baseDir: string | null
  // The skill text as injected into the conversation when it loaded.
  loaded: string | null
  model: string | null
  events: TraceEvent[]
}

export interface DayBucket {
  day: string
  runs: number
  toolCalls: number
  outputTokens: number
}

export interface Overview {
  totals: {
    runs: number
    skillsUsed: number
    skillsInstalled: number
    toolCalls: number
    outputTokens: number
    inputTokens: number
    runsWithErrors: number
    avgDurationMs: number | null
  }
  /** Last 30 days, oldest first. */
  daily: DayBucket[]
  /** Runs started per [weekday 0=Mon][hour 0-23], local time. */
  heatmap: number[][]
  topSkills: (Pick<SkillSummary, 'id' | 'name' | 'source'> & SkillStats)[]
  toolMix: Record<ToolKind, number>
  running: RunSummary[]
  recent: RunSummary[]
}

/** Overview, Skills and Runs can be scoped to one agent; `null` means all. */
export type AgentScope = AgentId | null

export type ServerEvent = { type: 'update'; sessions: string[] } | { type: 'hello' }
