import { useMemo, useState } from 'react'
import { Link } from 'wouter'
import type { RunStatus, RunSummary } from '../../../server/types.ts'
import { Shape } from '../components/Shape.tsx'
import { Empty, PageHeader, SearchInput, Segmented, StatusDot } from '../components/ui.tsx'
import { useApi, useNow } from '../lib/api.ts'
import { ago, duration } from '../lib/format.ts'

interface RunTableProps {
  runs: RunSummary[]
  /** Hide the skill column when every row belongs to the same skill. */
  showSkill?: boolean
}

export function RunTable({ runs, showSkill = true }: RunTableProps) {
  const now = useNow(runs.some((r) => r.status === 'running' || r.status === 'waiting'))
  const th = 'label py-3 font-normal'
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-left">
        <thead>
          <tr className="border-b border-line">
            <th className={`${th} w-10 pl-6`} />
            {showSkill && <th className={`${th} w-52 px-3`}>Skill</th>}
            <th className={`${th} px-3`}>Request → result</th>
            <th className={`${th} w-14 px-3 text-center`} title="Questions answered, plans reviewed, replies and refusals">You</th>
            <th className={`${th} w-40 px-3`}>Trace</th>
            <th className={`${th} w-16 px-3 text-right`}>Tools</th>
            <th className={`${th} w-24 px-3 text-right`}>Time</th>
            <th className={`${th} w-28 pl-3 pr-6 text-right`}>Started</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const end = r.status === 'running' ? now : r.endedAt
            return (
              <tr
                key={r.id}
                className={`group relative border-b border-line last:border-0 hover:bg-hover ${r.status === 'running' || r.status === 'waiting' ? 'bg-signal-soft' : ''}`}
              >
                <td className="py-3.5 pl-6">
                  <Link href={`/runs/${r.id}`} className="absolute inset-0" aria-label={`Open run of ${r.skill}`} />
                  <StatusDot status={r.status} errors={r.errors} />
                </td>
                {showSkill && (
                  <td className="max-w-0 px-3 py-3.5">
                    <span className="block truncate font-mono text-[12.5px] text-fg group-hover:text-signal">{r.skill}</span>
                    <span className="block truncate font-mono text-[11px] text-faint">
                      {r.project}
                      {r.trigger === 'slash' && ' · /command'}
                    </span>
                  </td>
                )}
                <td className="max-w-0 px-3 py-3.5">
                  <span className="block truncate text-fg">{r.prompt ?? <span className="text-faint">—</span>}</span>
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
                    <span className="tnum inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-signal-soft px-1.5 font-mono text-[11px] text-signal">
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
  const { data, error } = useApi<RunSummary[]>('/api/runs')
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
        eyebrow="Flight log"
        title={
          <>
            Runs<span className="italic text-signal">.</span>
          </>
        }
        meta={<span>Every skill invocation found in your Claude Code transcripts, newest first.</span>}
        actions={<SearchInput value={q} onChange={setQ} placeholder="Skill, request, result or project" />}
      />
      <div className="rise px-6 pb-6 sm:px-10" style={{ ['--i' as string]: 1 }}>
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
      {rows.length === 0 ? (
        <Empty title={data.length ? 'Nothing matches.' : 'No runs yet.'}>
          {!data.length && 'Use a skill in Claude Code and it will show up here while it runs.'}
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
