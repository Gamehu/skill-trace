import { useMemo, useState } from 'react'
import { Link } from 'wouter'
import type { SkillSource, SkillSummary } from '../../../server/types.ts'
import { Empty, PageHeader, SearchInput, Segmented, SourceTag } from '../components/ui.tsx'
import { useApi, useNow } from '../lib/api.ts'
import { ago, duration } from '../lib/format.ts'

type Filter = 'all' | SkillSource

export function SkillsView() {
  const { data, error } = useApi<SkillSummary[]>('/api/skills')
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const now = useNow(true, 30_000)

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, user: 0, project: 0, plugin: 0, builtin: 0 }
    for (const s of data ?? []) {
      c.all++
      c[s.source]++
    }
    return c
  }, [data])

  const rows = (data ?? []).filter(
    (s) =>
      (filter === 'all' || s.source === filter) &&
      (!q || `${s.name} ${s.description}`.toLowerCase().includes(q.toLowerCase())),
  )

  return (
    <>
      <PageHeader
        title="Skills"
        meta={data && <span>{data.length} found on this machine</span>}
        actions={<SearchInput value={q} onChange={setQ} placeholder="Filter skills" />}
      />
      <div className="border-b border-line px-6 py-3 sm:px-8">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={(
            [
              ['all', 'All'],
              ['user', 'User'],
              ['project', 'Project'],
              ['plugin', 'Plugin'],
              ['builtin', 'Built-in'],
            ] as const
          )
            .filter(([v]) => v === 'all' || counts[v] > 0)
            .map(([value, label]) => ({ value, label, count: counts[value] }))}
        />
      </div>

      {error && <Empty title="Could not load skills.">{error}</Empty>}
      {data && rows.length === 0 && (
        <Empty title={data.length ? 'No skills match.' : 'No skills found.'}>
          {!data.length && 'Skills are read from ~/.claude/skills, installed plugins, and each project’s .claude/skills.'}
        </Empty>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <thead>
              <tr className="border-b border-line text-[11.5px] text-muted">
                <th className="py-2 pl-6 pr-4 font-normal sm:pl-8">Skill</th>
                <th className="w-20 px-4 py-2 text-right font-normal">Runs</th>
                <th className="w-24 px-4 py-2 text-right font-normal">Avg time</th>
                <th className="w-28 py-2 pl-4 pr-6 text-right font-normal sm:pr-8">Last run</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="group border-b border-line hover:bg-hover">
                  <td className="max-w-0 py-3 pl-6 pr-4 sm:pl-8">
                    <Link href={`/skills/${s.id}`} className="block">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-mono text-[13px] font-medium text-fg">{s.name}</span>
                        <SourceTag source={s.source} />
                      </span>
                      <span className="mt-0.5 block truncate text-muted">{s.description || 'No description'}</span>
                    </Link>
                  </td>
                  <td className="tnum px-4 py-3 text-right text-fg-2">
                    {s.stats.runs || <span className="text-faint">0</span>}
                    {s.stats.errors > 0 && (
                      <span className="ml-1.5 text-err" title={`${s.stats.errors} runs had tool errors`}>
                        ·{s.stats.errors}
                      </span>
                    )}
                  </td>
                  <td className="tnum px-4 py-3 text-right text-fg-2">{duration(s.stats.avgDurationMs)}</td>
                  <td className="tnum py-3 pl-4 pr-6 text-right text-muted sm:pr-8">{ago(s.stats.lastRunAt, now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
