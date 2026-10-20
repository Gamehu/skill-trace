import { useLocation, useSearch } from 'wouter'
import type { AgentId, AgentScope } from '../../../server/types.ts'

export const AGENTS: { id: AgentId; label: string }[] = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'opencode', label: 'OpenCode' },
]

export const agentLabel = (id: AgentId) => AGENTS.find((a) => a.id === id)?.label ?? id

export interface AgentInfo {
  id: AgentId
  enabled: boolean
  skills: number
  runs: number
  /** Whether this agent's sessions can be replayed yet. */
  replay: boolean
}

/**
 * The agent the Overview, Skills and Runs pages are scoped to, kept in the URL (`?agent=codex`) so it
 * survives navigation, reloads and shared links.
 */
export function useScope(): [AgentScope, (next: AgentScope) => void] {
  const search = useSearch()
  const [location, navigate] = useLocation()
  const value = new URLSearchParams(search).get('agent')
  const scope = AGENTS.some((a) => a.id === value) ? (value as AgentId) : null
  const setScope = (next: AgentScope) => {
    const params = new URLSearchParams(search)
    if (next) params.set('agent', next)
    else params.delete('agent')
    const q = params.toString()
    navigate(q ? `${location}?${q}` : location, { replace: true })
  }
  return [scope, setScope]
}

/** Appends the scope to an API path. */
export function scoped(path: string, scope: AgentScope) {
  return scope ? `${path}${path.includes('?') ? '&' : '?'}agent=${scope}` : path
}

/** Keeps the current scope on links between the scoped pages. */
export function withScope(href: string, scope: AgentScope) {
  return scoped(href, scope)
}
