import { useState } from 'react'
import { Link } from 'wouter'
import type { Overview, RunSummary } from '../../../server/types.ts'
import { Shape } from '../components/Shape.tsx'
import { Empty, KindDot, Metric, SectionTitle } from '../components/ui.tsx'
import { useApi, useNow } from '../lib/api.ts'
import { compact, duration } from '../lib/format.ts'
import { KINDS, kindColor } from '../lib/kinds.ts'
import { trackSpotlight, useCountUp } from '../lib/motion.ts'
import { RunTable } from './Runs.tsx'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function Hero({ totals }: { totals: Overview['totals'] }) {
  const runs = useCountUp(totals.runs)
  const tools = useCountUp(totals.toolCalls)
  return (
    <section className="rise px-6 pb-10 pt-12 sm:px-10">
      <div className="label mb-5 flex items-center gap-2">
        <span className="size-1.5 rounded-full bg-signal shadow-[0_0_8px_var(--signal)]" />
        Skill flight recorder · local
      </div>
      <h1 className="display max-w-5xl text-[56px] text-fg sm:text-[84px]">
        <span className="tnum italic text-signal [text-shadow:0_0_40px_var(--signal-soft)]">{Math.round(runs)}</span> runs,{' '}
        <span className="tnum italic">{Math.round(tools).toLocaleString()}</span> tool calls,
        <br className="max-sm:hidden" /> <span className="text-fg-2">one black box.</span>
      </h1>
      <p className="mt-6 max-w-2xl text-[14.5px] leading-relaxed text-fg-2">
        Every skill Claude Code has loaded on this machine, and everything it did afterwards.{' '}
        <span className="text-fg">{totals.skillsUsed}</span> of {totals.skillsInstalled} installed skills have run so far.
      </p>
    </section>
  )
}

function LiveMonitor({ running }: { running: RunSummary[] }) {
  const now = useNow(running.length > 0)
  return (
    <div className="glass spotlight rise relative overflow-hidden p-6" style={{ ['--i' as string]: 4 }} onPointerMove={trackSpotlight}>
      <SectionTitle aside={running.length > 0 && <span className="font-mono text-signal">{running.length} active</span>}>
        <span className={`size-1.5 rounded-full ${running.length ? 'bg-signal shadow-[0_0_8px_var(--signal)]' : 'bg-faint'}`} />
        Now running
      </SectionTitle>
      {running.length === 0 ? (
        <div className="py-4">
          <svg viewBox="0 0 400 60" className="h-16 w-full" preserveAspectRatio="none" aria-hidden>
            <path d="M0 30 H400" stroke="var(--line-strong)" strokeWidth="1" />
            <path
              d="M0 30 H150 L160 22 L170 38 L180 30 H400"
              stroke="var(--signal)"
              strokeWidth="1.5"
              fill="none"
              strokeDasharray="4 3"
              className="scope-line"
              style={{ filter: 'drop-shadow(0 0 4px var(--signal))' }}
            />
          </svg>
          <p className="display mt-2 text-[26px] italic text-fg-2">Idle.</p>
          <p className="text-muted">Waiting for the next skill call. It will appear here the moment it starts.</p>
        </div>
      ) : (
        <ul className="space-y-4">
          {running.map((r) => (
            <li key={r.id}>
              <Link href={`/runs/${r.id}`} className="block rounded-xl border border-signal/25 bg-signal-soft p-4 transition-colors hover:border-signal/50">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="display truncate text-[26px] text-fg">{r.skill}</span>
                  <span className="tnum font-mono text-[20px] text-signal">{duration(now - r.startedAt)}</span>
                </div>
                <div className="mt-1 truncate text-fg-2">{r.prompt ?? r.project}</div>
                <div className="mt-3">
                  <Shape run={r} now={now} width={520} height={18} fluid />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ToolMix({ mix }: { mix: Overview['toolMix'] }) {
  const total = Object.values(mix).reduce((a, b) => a + b, 0)
  const kinds = KINDS.filter((k) => mix[k.kind] > 0).sort((a, b) => mix[b.kind] - mix[a.kind])
  return (
    <div className="glass rise p-6" style={{ ['--i' as string]: 5 }}>
      <SectionTitle aside={<span className="tnum font-mono">{total.toLocaleString()}</span>}>Tool mix</SectionTitle>
      <div className="flex h-3 gap-[2px] overflow-hidden rounded-full" role="img" aria-label="Share of tool calls by kind">
        {kinds.map((k) => (
          <span
            key={k.kind}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${(mix[k.kind] / total) * 100}%`, background: kindColor(k.kind), boxShadow: `0 0 12px ${kindColor(k.kind)}` }}
            title={`${k.label}: ${mix[k.kind]}`}
          />
        ))}
      </div>
      <ul className="mt-5 space-y-2.5">
        {kinds.map((k) => (
          <li key={k.kind} className="flex items-center gap-3">
            <KindDot kind={k.kind} />
            <span className="flex-1 text-fg-2">{k.label}</span>
            <span className="tnum font-mono text-[12px] text-fg">{mix[k.kind]}</span>
            <span className="tnum w-12 text-right font-mono text-[12px] text-muted">{((mix[k.kind] / total) * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Heatmap({ grid }: { grid: number[][] }) {
  const [hover, setHover] = useState<{ d: number; h: number } | null>(null)
  const max = Math.max(1, ...grid.flat())
  const readout = hover
    ? `${WEEKDAYS[hover.d]} ${String(hover.h).padStart(2, '0')}:00 · ${grid[hover.d][hover.h]} run${grid[hover.d][hover.h] === 1 ? '' : 's'}`
    : 'When skills run'
  return (
    <div className="glass rise p-6" style={{ ['--i' as string]: 6 }}>
      <SectionTitle aside={<span className="tnum font-mono">{readout}</span>}>Rhythm · weekday × hour</SectionTitle>
      <div className="overflow-x-auto" onMouseLeave={() => setHover(null)}>
        <div className="grid min-w-[560px] grid-cols-[34px_repeat(24,minmax(0,1fr))] gap-[3px]">
          {grid.map((row, d) => (
            <div key={WEEKDAYS[d]} className="contents">
              <span className="label self-center text-[9.5px]">{WEEKDAYS[d]}</span>
              {row.map((v, h) => {
                const t = v / max
                return (
                  <span
                    key={`${WEEKDAYS[d]}-${h}`}
                    onMouseEnter={() => setHover({ d, h })}
                    className="h-[22px] rounded-[4px] transition-transform hover:scale-125"
                    style={{
                      background: v ? `color-mix(in srgb, var(--signal) ${Math.round(18 + t * 82)}%, transparent)` : 'var(--raised)',
                      boxShadow: v && t > 0.5 ? `0 0 ${Math.round(t * 14)}px var(--signal)` : undefined,
                      outline: hover?.d === d && hover.h === h ? '1px solid var(--fg)' : undefined,
                    }}
                  />
                )
              })}
            </div>
          ))}
          <span />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={`h${h}`} className="label text-center text-[9px]">
              {h % 6 === 0 ? String(h).padStart(2, '0') : ''}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function TopSkills({ skills }: { skills: Overview['topSkills'] }) {
  const max = Math.max(1, ...skills.map((s) => s.runs))
  return (
    <div className="glass rise p-6" style={{ ['--i' as string]: 7 }}>
      <SectionTitle aside={<Link href="/skills" className="hover:text-fg">All skills →</Link>}>Most used</SectionTitle>
      <ol className="space-y-1">
        {skills.map((s, i) => (
          <li key={s.id}>
            <Link href={`/skills/${s.id}`} className="group -mx-2 grid grid-cols-[22px_1fr_auto] items-center gap-x-3 rounded-lg px-2 py-2 hover:bg-hover">
              <span className="font-mono text-[10.5px] text-faint group-hover:text-signal">{String(i + 1).padStart(2, '0')}</span>
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="truncate font-mono text-[12.5px] text-fg">{s.name}</span>
                </span>
                <span className="mt-1.5 block h-[3px] rounded-full bg-raised">
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${(s.runs / max) * 100}%`, background: 'linear-gradient(90deg, transparent, var(--signal))', boxShadow: '0 0 10px var(--signal)' }}
                  />
                </span>
              </span>
              <span className="tnum text-right font-mono text-[12px] text-fg-2">
                {s.runs}
                <span className="ml-2 text-faint">{duration(s.avgDurationMs)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function OverviewView() {
  const { data, error } = useApi<Overview>('/api/overview')
  if (error) return <Empty title="Could not reach the recorder.">{error}</Empty>
  if (!data) return null
  const { totals, daily } = data
  const errorRate = totals.runs ? Math.round((totals.runsWithErrors / totals.runs) * 100) : 0

  return (
    <>
      <Hero totals={totals} />
      <div className="space-y-4 px-6 sm:px-10">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric index={0} label="Runs · 30d" value={daily.reduce((n, d) => n + d.runs, 0)} hint={`${totals.runs} all time`} spark={daily.map((d) => d.runs)} />
          <Metric index={1} label="Tool calls · 30d" value={compact(daily.reduce((n, d) => n + d.toolCalls, 0))} hint={`${(totals.toolCalls / Math.max(1, totals.runs)).toFixed(1)} per run`} spark={daily.map((d) => d.toolCalls)} />
          <Metric index={2} label="Output tokens" value={compact(totals.outputTokens)} hint={`${compact(totals.inputTokens)} read`} spark={daily.map((d) => d.outputTokens)} />
          <Metric index={3} label="Avg run" value={duration(totals.avgDurationMs)} hint={<span className={errorRate ? 'text-err' : ''}>{errorRate}% hit a tool error</span>} />
        </div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <LiveMonitor running={data.running} />
          <ToolMix mix={data.toolMix} />
        </div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Heatmap grid={data.heatmap} />
          <TopSkills skills={data.topSkills} />
        </div>
        {data.recent.length > 0 && (
          <section className="glass rise overflow-hidden pt-6" style={{ ['--i' as string]: 8 }}>
            <div className="px-6">
              <SectionTitle aside={<Link href="/runs" className="hover:text-fg">All runs →</Link>}>Latest runs</SectionTitle>
            </div>
            <RunTable runs={data.recent} />
          </section>
        )}
      </div>
    </>
  )
}
