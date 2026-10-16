import { useMemo, useState } from 'react'
import { Link } from 'wouter'
import type { RunStatus, RunSummary } from '../../../server/types.ts'
import { Shape } from '../components/Shape.tsx'
import { Empty, PageHeader, SearchInput, Segmented, StatusDot } from '../components/ui.tsx'
import { useApi, useNow } from '../lib/api.ts'
import { ago, compact, duration } from '../lib/format.ts'

export function RunTable({ runs, showSkill = true }: { runs: RunSummary[]; showSkill?: boolean }) {
  const now = useNow(runs.some((r) => r.status === 'running'))
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-left">
        <thead>
          <tr className="border-b border-line text-[11.5px] text-muted">
            <th className="w-8 py-2 pl-6 font-normal sm:pl-8" />
            {showSkill && <th className="w-48 px-3 py-2 font-normal">Skill</th>}
            <th className="px-3 py-2 font-normal">Prompt</th>
            <th className="w-36 px-3 py-2 font-normal">Shape</th>
            <th className="w-16 px-3 py-2 text-right font-normal">Tools</th>
            <th className="w-20 px-3 py-2 text-right font-normal">Tokens</th>
            <th className="w-20 px-3 py-2 text-right font-normal">Time</th>
            <th className="w-28 py-2 pl-3 pr-6 text-right font-normal sm:pr-8">Started</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const end = r.status === 'running' ? now : r.endedAt
            return (
              <tr key={r.id} className="relative border-b border-line hover:bg-hover">
                <td className="py-2.5 pl-6 sm:pl-8">
                  <Link href={`/runs/${r.id}`} className="absolute inset-0" aria-label={`Open run of ${r.skill}`} />
                  <StatusDot status={r.status} errors={r.errors} />
                </td>
                {showSkill && (
                  <td className="max-w-0 px-3 py-2.5">
                    <span className="block truncate font-mono text-[12.5px] text-fg">{r.skill}</span>
                  </td>
                )}
                <td className="max-w-0 px-3 py-2.5">
                  <span className="block truncate text-fg-2">{r.prompt ?? <span className="text-faint">—</span>}</span>
                  <span className="block truncate text-[11.5px] text-faint">{r.project}</span>
                </td>
                <td className="px-3 py-2.5">
                  <Shape run={r} now={now} />
                </td>
                <td className="tnum px-3 py-2.5 text-right text-fg-2">
                  {r.toolCalls}
                  {r.errors > 0 && <span className="ml-1 text-err">·{r.errors}</span>}
                </td>
                <td className="tnum px-3 py-2.5 text-right text-muted" title="Output tokens">
                  {compact(r.tokens.output)}
                </td>
                <td className="tnum px-3 py-2.5 text-right text-fg-2">{duration(end - r.startedAt)}</td>
                <td className="tnum py-2.5 pl-3 pr-6 text-right text-muted sm:pr-8">{ago(r.startedAt, now)}</td>
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
    const c = { all: 0, running: 0, done: 0, interrupted: 0 }
    for (const r of data ?? []) {
      c.all++
      c[r.status]++
    }
    return c
  }, [data])

  const rows = (data ?? []).filter(
    (r) =>
      (status === 'all' || r.status === status) &&
      (!q || `${r.skill} ${r.prompt ?? ''} ${r.project}`.toLowerCase().includes(q.toLowerCase())),
  )

  return (
    <>
      <PageHeader
        title="Runs"
        meta={data && <span>Every skill invocation found in Claude Code transcripts</span>}
        actions={<SearchInput value={q} onChange={setQ} placeholder="Filter by skill, prompt, project" />}
      />
      <div className="border-b border-line px-6 py-3 sm:px-8">
        <Segmented
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'All', count: counts.all },
            { value: 'running', label: 'Running', count: counts.running },
            { value: 'done', label: 'Done', count: counts.done },
            { value: 'interrupted', label: 'Interrupted', count: counts.interrupted },
          ]}
        />
      </div>
      {error && <Empty title="Could not load runs.">{error}</Empty>}
      {data && rows.length === 0 && (
        <Empty title={data.length ? 'No runs match.' : 'No skill runs yet.'}>
          {!data.length && 'Use a skill in Claude Code and it will show up here as it runs.'}
        </Empty>
      )}
      {rows.length > 0 && <RunTable runs={rows} />}
    </>
  )
}
