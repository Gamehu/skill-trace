// Shared between the API server and the web UI (type-only imports on the web side).

export type SkillSource = 'user' | 'project' | 'plugin' | 'builtin'

export interface SkillSummary {
  id: string
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

export type RunStatus = 'running' | 'done' | 'interrupted'
export type RunTrigger = 'model' | 'slash'

export interface RunSummary {
  id: string
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

export interface RunDetail extends RunSummary {
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

export type ServerEvent = { type: 'update'; sessions: string[] } | { type: 'hello' }
