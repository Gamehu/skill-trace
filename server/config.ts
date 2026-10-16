import os from 'node:os'
import path from 'node:path'

export const CLAUDE_HOME = path.resolve(
  process.env.SKILL_TRACE_CLAUDE_HOME ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'),
)

export const PROJECTS_DIR = path.join(CLAUDE_HOME, 'projects')
export const USER_SKILLS_DIR = path.join(CLAUDE_HOME, 'skills')
export const PLUGINS_DIR = path.join(CLAUDE_HOME, 'plugins')

export const PORT = Number(process.env.PORT ?? 4317)

// A run with no new transcript lines for this long and no closing reply is shown as interrupted.
export const RUNNING_GRACE_MS = 2 * 60_000
