import { useMemo, useState } from 'react'
import { Link, useLocation } from 'wouter'
import type { RunStatus, RunSummary } from '../../../server/types.ts'
import { Shape } from '../components/Shape.tsx'
import { AgentTag, ScopeTabs } from '../components/Scope.tsx'
import { Empty, PageHeader, SearchInput, Segmented, StatusDot } from '../components/ui.tsx'
import { agentLabel, scoped, useScope } from '../lib/agents.ts'
import { useApi, useNow } from '../lib/api.ts'
import { ago, duration } from '../lib/format.ts'

interface RunTableProps {
  runs: RunSummary[]
  /** Hide the skill column when every row belongs to the same skill. */
  showSkill?: boolean
}

export function RunTable({ runs, showSkill = true }: RunTableProps) {
  const now = useNow(runs.some((r) => r.status === 'running' || r.status === 'waiting'))
  const [, navigate] = useLocation()
  const th = 'label py-3 font-normal'
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-left">
        <thead>
          <tr className="border-b border-line">
            <th className={`${th} w-10 pl-6`}>
              <span className="sr-only">Status</span>
            </th>
            {showSkill && <th className={`${th} w-52 px-3`}>Skill</th>}
            <th className={`${th} px-3`}>Request → result</th>
            <th className={`${th} w-20 whitespace-nowrap px-3 text-center`} title="How many times you stepped in: answered a question, reviewed a plan, replied, declined or interrupted">
              By you
            </th>
            <th className={`${th} w-40 whitespace-nowrap px-3`} title="Each bar is a tool call, placed by when it ran and colored by kind. Hover a row's strip for the breakdown.">
              Steps over time
            </th>
            <th className={`${th} w-16 px-3 text-right`}>Steps</th>
            <th className={`${th} w-24 px-3 text-right`}>Duration</th>
            <th className={`${th} w-28 pl-3 pr-6 text-right`}>Started</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const end = r.status === 'running' ? now : r.endedAt
            return (
              <tr
                key={r.id}
                // The whole row opens the run, unless the click was the end of a text selection.
                onClick={() => !window.getSelection()?.toString() && navigate(`/runs/${r.id}`)}
                className={`group cursor-pointer border-b border-line last:border-0 hover:bg-hover ${r.status === 'running' || r.status === 'waiting' ? 'bg-signal-soft' : ''}`}
              >
                <td className="py-3.5 pl-6">
                  <StatusDot status={r.status} errors={r.errors} />
                </td>
                {showSkill && (
                  <td className="max-w-0 px-3 py-3.5">
                    <span className="block truncate font-mono text-[12.5px] text-fg group-hover:text-signal">{r.skill}</span>
                    <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
                      <AgentTag agent={r.agent} />
                      <span className="truncate font-mono text-[11px] text-faint">
                        {r.project}
                        {r.trigger === 'slash' && ' · /command'}
                      </span>
                    </span>
                  </td>
                )}
                <td className="max-w-0 px-3 py-3.5">
                  <Link href={`/runs/${r.id}`} onClick={(e) => e.stopPropagation()} className="block truncate text-fg hover:underline hover:decoration-line-strong hover:underline-offset-4">
                    {r.prompt ?? <span className="text-faint">—</span>}
                  </Link>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[12px]">
                    <span className={r.status === 'waiting' ? 'text-signal' : 'text-faint'}>↳</span>
                    <span className={`truncate ${r.status === 'waiting' ? 'text-signal' : 'text-muted'}`}>
                      {r.status === 'running' ? 'Working…' : r.status === 'waiting' ? `Waiting for you${r.result ? ` · ${r.result}` : ''}` : (r.result ?? 'No closing reply')}
                    </span>
                    {r.filesChanged > 0 && r.status !== 'running' && (
                      <span className="shrink-0 rounded-full border border-line px-1.5 font-mono text-[10px] text-fg-2">
                        {r.filesChanged} file{r.filesChanged > 1 ? 's' : ''}
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-3 py-3.5 text-center">
                  {r.humanTurns > 0 ? (
                    <span
                      title={`You stepped in ${r.humanTurns} time${r.humanTurns > 1 ? 's' : ''}`}
                      className="tnum inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-signal-soft px-1.5 font-mono text-[11px] text-signal">
                      {r.humanTurns}
                    </span>
                  ) : (
                    <span className="text-faint">·</span>
                  )}
                </td>
                <td className="px-3 py-3.5">
                  <Shape run={r} now={now} />
                </td>
                <td className="tnum px-3 py-3.5 text-right font-mono text-[12px] text-fg-2">
                  {r.toolCalls}
                  {r.errors > 0 && <span className="ml-1 text-err">·{r.errors}</span>}
                </td>
                <td className={`tnum px-3 py-3.5 text-right font-mono text-[12px] ${r.status === 'running' || r.status === 'waiting' ? 'text-signal' : 'text-fg'}`}>
                  {duration(end - r.startedAt)}
                </td>
                <td className="tnum py-3.5 pl-3 pr-6 text-right text-[12px] text-muted">{ago(r.startedAt, now)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function RunsView() {
  const [scope] = useScope()
  const { data, error } = useApi<RunSummary[]>(scoped('/api/runs', scope))
  const [status, setStatus] = useState<'all' | RunStatus>('all')
  const [q, setQ] = useState('')

  const counts = useMemo(() => {
    const c = { all: 0, running: 0, waiting: 0, done: 0, interrupted: 0 }
    for (const r of data ?? []) {
      c.all++
      c[r.status]++
    }
    return c
  }, [data])

  if (error) return <Empty title="Could not load runs.">{error}</Empty>
  if (!data) return null

  const needle = q.toLowerCase()
  const rows = data.filter(
    (r) => (status === 'all' || r.status === status) && (!q || `${r.skill} ${r.prompt ?? ''} ${r.result ?? ''} ${r.project}`.toLowerCase().includes(needle)),
  )

  return (
    <>
      <PageHeader
        eyebrow={`Runs · ${scope ? agentLabel(scope) : 'all tools'}`}
        title={
          <>
            Runs<span className="italic text-signal">.</span>
          </>
        }
        meta={<span>Every run of a tracked skill found in the session logs, newest first.</span>}
        actions={<SearchInput value={q} onChange={setQ} placeholder="Skill, request, result or project" />}
      />
      <div className="rise space-y-3 px-6 pb-6 sm:px-10" style={{ ['--i' as string]: 1 }}>
        <ScopeTabs count="runs" />
        <div className="flex flex-wrap items-center gap-3">
          <span className="label text-[10px]">Status</span>
          <Segmented
            value={status}
            onChange={setStatus}
            options={[
              { value: 'all', label: 'All', count: counts.all },
              { value: 'running', label: 'Running', count: counts.running },
              { value: 'waiting', label: 'Waiting for you', count: counts.waiting },
              { value: 'done', label: 'Done', count: counts.done },
              { value: 'interrupted', label: 'Interrupted', count: counts.interrupted },
            ]}
          />
        </div>
      </div>
      {rows.length === 0 ? (
        <Empty title={data.length ? 'Nothing matches.' : 'No runs yet.'}>
          {!data.length && 'Use a tracked skill and it will show up here while it runs.'}
        </Empty>
      ) : (
        <div className="px-6 sm:px-10">
          <section className="glass rise overflow-hidden" style={{ ['--i' as string]: 2 }}>
            <RunTable runs={rows} />
          </section>
        </div>
      )}
    </>
  )
}
