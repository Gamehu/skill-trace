import { Link } from 'wouter'
import type { AgentId } from '../../../server/types.ts'
import { useApi } from '../lib/api.ts'
import { AGENTS, agentLabel, useScope, type AgentInfo } from '../lib/agents.ts'

/** Which agent a skill or run belongs to. Neutral on purpose: color is reserved for data and for "you". */
export function AgentTag({ agent }: { agent: AgentId }) {
  return (
    <span className="inline-flex h-[18px] shrink-0 items-center rounded-full bg-raised px-2 text-[10.5px] text-fg-2" title={`Loaded by ${agentLabel(agent)}`}>
      {agentLabel(agent)}
    </span>
  )
}

export function AgentTags({ agents }: { agents: AgentId[] }) {
  if (!agents.length) return <span className="inline-flex h-[18px] shrink-0 items-center rounded-full bg-raised px-2 text-[10.5px] text-muted">Extra folder</span>
  return (
    <>
      {agents.map((a) => (
        <AgentTag key={a} agent={a} />
      ))}
    </>
  )
}

/**
 * Tabs scoping Overview, Skills and Runs to one coding agent. The choice lives in the URL, so it
 * carries across these pages. Counts show what each tab holds; agents switched off or not found say so.
 */
export function ScopeTabs({ count }: { count: 'skills' | 'runs' }) {
  const [scope, setScope] = useScope()
  const { data: agents } = useApi<AgentInfo[]>('/api/agents')
  if (!agents) return null
  const total = agents.reduce((n, a) => n + a[count], 0)
  const tabs = [{ id: null, label: 'All tools', n: total, note: '' }, ...AGENTS.map((a) => {
    const info = agents.find((x) => x.id === a.id)
    const note = !info?.enabled ? 'off' : count === 'runs' && !info.replay ? 'skills only' : ''
    return { id: a.id, label: a.label, n: info?.[count] ?? 0, note }
  })]
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="inline-flex flex-wrap rounded-full border border-line bg-panel p-1" role="tablist" aria-label="Show data from">
        {tabs.map((t) => {
          const on = scope === t.id
          return (
            <button
              key={t.id ?? 'all'}
              role="tab"
              aria-selected={on}
              onClick={() => setScope(t.id)}
              className={`h-7 rounded-full px-3.5 text-[12.5px] transition-colors ${on ? 'bg-fg text-bg' : 'text-muted hover:text-fg'}`}
            >
              {t.label}
              <span className={`tnum ml-1.5 font-mono text-[11px] ${on ? 'opacity-60' : 'text-faint'}`}>{t.note || t.n}</span>
            </button>
          )
        })}
      </div>
      <Link href="/settings" className="text-[12px] text-muted underline decoration-line-strong underline-offset-4 hover:text-fg">
        Wrong folders? Change sources
      </Link>
    </div>
  )
}

/** Shown on Runs and Overview when the selected agent's sessions cannot be replayed yet. */
export function ReplayNotYet({ agent }: { agent: AgentId }) {
  return (
    <div className="glass mx-auto max-w-xl p-6 text-center">
      <p className="display text-[26px] text-fg-2">Runs from {agentLabel(agent)} aren’t shown yet.</p>
      <p className="mt-2 text-muted">
        Its skills are listed under{' '}
        <Link href={`/skills?agent=${agent}`} className="text-fg underline decoration-line-strong underline-offset-4">
          Skills
        </Link>
        . Replaying its sessions needs support for its log format, which is still to come.
      </p>
    </div>
  )
}
