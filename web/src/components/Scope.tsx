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
 * Tabs scoping Overview, Skills and Runs to one coding agent, drawn as the page's own tab bar so they
 * read as "which data" rather than as another filter. The choice lives in the URL, so it carries across
 * these pages. Counts show what each tab holds; agents switched off say so.
 */
export function ScopeTabs({ count }: { count: 'skills' | 'runs' }) {
  const [scope, setScope] = useScope()
  const { data: agents } = useApi<AgentInfo[]>('/api/agents')
  if (!agents) return <div className="h-10 border-b border-line" />
  const total = agents.reduce((n, a) => n + a[count], 0)
  const tabs = [{ id: null, label: 'All tools', n: total, note: '' }, ...AGENTS.map((a) => {
    const info = agents.find((x) => x.id === a.id)
    return { id: a.id, label: a.label, n: info?.[count] ?? 0, note: info?.enabled ? '' : 'off' }
  })]
  return (
    <div className="flex items-end justify-between gap-6 border-b border-line">
      <div className="-mb-px flex min-w-0 gap-5 overflow-x-auto max-sm:[mask-image:linear-gradient(to_right,black_85%,transparent)] sm:gap-6" role="tablist" aria-label="Show data from">
        {tabs.map((t) => {
          const on = scope === t.id
          return (
            <button
              key={t.id ?? 'all'}
              role="tab"
              aria-selected={on}
              onClick={() => setScope(t.id)}
              title={t.note ? `${t.label} is switched off in Settings` : undefined}
              className={`flex h-10 shrink-0 items-center gap-2 border-b-2 text-[13.5px] transition-colors ${
                on ? 'border-fg text-fg' : 'border-transparent text-muted hover:text-fg'
              }`}
            >
              {t.label}
              <span className={`tnum font-mono text-[11px] ${on ? 'text-fg-2' : 'text-faint'}`}>{t.note || t.n}</span>
            </button>
          )
        })}
      </div>
      <Link
        href="/settings"
        title="Wrong folders? Change which folders skill-trace reads"
        className="mb-2.5 flex shrink-0 items-center gap-1.5 text-[12px] text-muted transition-colors hover:text-fg"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
          <path d="M1.5 4.5a1 1 0 0 1 1-1h3.6l1.5 1.6h5.9a1 1 0 0 1 1 1v6.4a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
        <span className="max-sm:hidden">Sources</span>
      </Link>
    </div>
  )
}
