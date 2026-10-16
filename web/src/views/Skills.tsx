import { useMemo, useState } from 'react'
import { Link } from 'wouter'
import type { SkillSource, SkillSummary } from '../../../server/types.ts'
import { Empty, PageHeader, SearchInput, Segmented, SourceTag, Sparkline } from '../components/ui.tsx'
import { useApi, useNow } from '../lib/api.ts'
import { ago, duration } from '../lib/format.ts'
import { trackSpotlight } from '../lib/motion.ts'

type Filter = 'all' | SkillSource

const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['user', 'User'],
  ['project', 'Project'],
  ['plugin', 'Plugin'],
  ['builtin', 'Built-in'],
]

function SkillCard({ skill, index, now }: { skill: SkillSummary; index: number; now: number }) {
  const { stats } = skill
  return (
    <Link
      href={`/skills/${skill.id}`}
      onPointerMove={trackSpotlight}
      className="glass spotlight rise flex min-w-0 flex-col p-5 transition-transform duration-300 hover:-translate-y-0.5"
      style={{ ['--i' as string]: Math.min(index, 12) }}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="display block truncate text-[28px] text-fg">{skill.name}</span>
          <span className="mt-1.5 flex items-center gap-2">
            <SourceTag source={skill.source} />
            <span className="label text-[10px]">{ago(stats.lastRunAt, now)}</span>
          </span>
        </span>
        <span className="text-right">
          <span className="tnum block font-mono text-[30px] leading-none tracking-[-0.04em] text-fg">{stats.runs}</span>
          <span className="label text-[9.5px]">runs</span>
        </span>
      </div>
      <p className="mt-4 line-clamp-2 min-h-[2.9em] text-[12.5px] leading-[1.45] text-muted">{skill.description || 'No description.'}</p>
      <div className="mt-4 flex items-end justify-between gap-4 border-t border-line pt-4">
        <span className="space-y-0.5">
          <span className="label block text-[9.5px]">Avg</span>
          <span className="tnum block font-mono text-[13px] text-fg-2">{duration(stats.avgDurationMs)}</span>
        </span>
        {stats.errors > 0 && (
          <span className="space-y-0.5">
            <span className="label block text-[9.5px]">Errors</span>
            <span className="tnum block font-mono text-[13px] text-err">{stats.errors}</span>
          </span>
        )}
        <Sparkline values={skill.spark} width={110} height={28} />
      </div>
    </Link>
  )
}

function DormantSkill({ skill }: { skill: SkillSummary }) {
  return (
    <Link href={`/skills/${skill.id}`} className="group flex min-w-0 items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-hover">
      <span className="size-1.5 shrink-0 rounded-full bg-faint transition-colors group-hover:bg-signal" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-[12.5px] text-fg-2 group-hover:text-fg">{skill.name}</span>
        <span className="block truncate text-[11.5px] text-faint">{skill.description || 'No description.'}</span>
      </span>
      <SourceTag source={skill.source} />
    </Link>
  )
}

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

  if (error) return <Empty title="Could not load skills.">{error}</Empty>
  if (!data) return null

  const needle = q.toLowerCase()
  const rows = data.filter(
    (s) => (filter === 'all' || s.source === filter) && (!q || `${s.name} ${s.description}`.toLowerCase().includes(needle)),
  )
  const active = rows.filter((s) => s.stats.runs > 0)
  const dormant = rows.filter((s) => s.stats.runs === 0)

  return (
    <>
      <PageHeader
        eyebrow="Catalog"
        title={
          <>
            Skills<span className="italic text-signal">.</span>
          </>
        }
        meta={
          <span>
            <span className="text-fg">{counts.all}</span> found on this machine ·{' '}
            <span className="text-fg">{data.filter((s) => s.stats.runs > 0).length}</span> have run
          </span>
        }
        actions={<SearchInput value={q} onChange={setQ} placeholder="Filter skills" />}
      />
      <div className="rise px-6 pb-8 sm:px-10" style={{ ['--i' as string]: 1 }}>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={FILTERS.filter(([v]) => v === 'all' || counts[v] > 0).map(([value, label]) => ({ value, label, count: counts[value] }))}
        />
      </div>

      {rows.length === 0 && (
        <Empty title={data.length ? 'Nothing matches.' : 'No skills yet.'}>
          {!data.length && 'Skills are read from ~/.claude/skills, installed plugins, and each project’s .claude/skills.'}
        </Empty>
      )}

      {active.length > 0 && (
        <section className="px-6 sm:px-10">
          <h2 className="label mb-4">In rotation · {active.length}</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {active.map((s, i) => (
              <SkillCard key={s.id} skill={s} index={i} now={now} />
            ))}
          </div>
        </section>
      )}

      {dormant.length > 0 && (
        <section className="mt-12 px-6 sm:px-10">
          <h2 className="label mb-3">Installed, never run · {dormant.length}</h2>
          <div className="glass grid grid-cols-1 gap-x-2 p-2 md:grid-cols-2 2xl:grid-cols-3">
            {dormant.map((s) => (
              <DormantSkill key={s.id} skill={s} />
            ))}
          </div>
        </section>
      )}
    </>
  )
}
