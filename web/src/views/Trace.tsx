import { useEffect, useMemo, useState } from 'react'
import { Link } from 'wouter'
import type { RunDetail } from '../../../server/types.ts'
import { Empty, PageHeader, Segmented, StatusPill } from '../components/ui.tsx'
import { useApi, useNow } from '../lib/api.ts'
import { compact, dateTime, duration, shortId } from '../lib/format.ts'
import { kindColor } from '../lib/kinds.ts'
import { buildItems, humanLabel, isDeclined, isHumanItem, jumpTo, type Item } from './trace/items.ts'
import { Glance, Replay } from './trace/Replay.tsx'
import { Inspector, Legend, Waterfall, type Row } from './trace/Timeline.tsx'

type Tab = 'replay' | 'timeline'

const initialTab = (): Tab => (location.hash === '#timeline' ? 'timeline' : 'replay')

/**
 * The whole run on one strip: tool calls as colored bars, the person's moments as diamonds above.
 * Diamonds are buttons that jump to that moment.
 */
function SignalStrip({ run, items, end, playhead, live, onPick }: { run: RunDetail; items: Item[]; end: number; playhead: number | null; live: boolean; onPick: (id: string) => void }) {
  const total = Math.max(1, end - run.startedAt)
  const pct = (t: number) => `${Math.min(100, Math.max(0, ((t - run.startedAt) / total) * 100))}%`
  return (
    <div className="relative h-11" role="group" aria-label="Run overview">
      <span className="absolute inset-x-0 top-[29px] h-px bg-line-strong" />
      {run.events.map((e) => {
        if (e.type !== 'tool') return null
        const color = isDeclined(e) ? 'var(--signal)' : e.isError ? 'var(--err)' : kindColor(e.kind)
        return (
          <span
            key={e.id}
            className="absolute top-[24px] h-[11px] rounded-[3px]"
            style={{ left: pct(e.start), width: `max(2px, ${(((e.end ?? end) - e.start) / total) * 100}%)`, background: color, boxShadow: `0 0 8px -1px ${color}` }}
          />
        )
      })}
      {items.filter(isHumanItem).map((it) => (
        <button
          key={it.id}
          onClick={() => onPick(it.id)}
          title={humanLabel(it)}
          aria-label={humanLabel(it)}
          className="group absolute top-0 -translate-x-1/2 p-1"
          style={{ left: pct(it.at) }}
        >
          <span className="block size-2.5 rotate-45 bg-signal shadow-[0_0_10px_var(--signal)] transition-transform group-hover:scale-150" />
          <span className="absolute left-1/2 top-[14px] h-[10px] w-px -translate-x-1/2 bg-signal/60" />
        </button>
      ))}
      {playhead !== null && (
        <span className="absolute inset-y-0 w-[2px] bg-fg shadow-[0_0_12px_var(--fg)] transition-[left] duration-500" style={{ left: pct(playhead) }} />
      )}
      {live && <span className="bar-live absolute inset-y-1 right-0 w-[2px] bg-signal shadow-[0_0_12px_var(--signal)]" />}
    </div>
  )
}

function Fact({ value, label, tone }: { value: string | number; label: string; tone?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span className={`tnum font-mono text-[14px] ${tone ?? 'text-fg'}`}>{value}</span>
      <span className="text-[11.5px] text-muted">{label}</span>
    </span>
  )
}

export function TraceView({ id }: { id: string }) {
  const { data: run, error } = useApi<RunDetail>(`/api/runs/${id}`)
  const live = run?.status === 'running' || run?.status === 'waiting'
  const now = useNow(live, 500)
  const [tab, setTab] = useState<Tab>(initialTab)
  const [selected, setSelected] = useState<string | null>(null)
  const [visible, setVisible] = useState<number | null>(null)
  const items = useMemo(() => (run ? buildItems(run) : []), [run])

  useEffect(() => {
    history.replaceState(null, '', tab === 'timeline' ? '#timeline' : location.pathname)
  }, [tab])

  // Playback: reveal one item at a time, lingering on the moments where the person took part.
  useEffect(() => {
    if (visible === null) return
    if (visible > items.length) {
      setVisible(null)
      return
    }
    const prev = items[visible - 1]
    const delay = visible === 0 ? 300 : visible === items.length ? 1500 : prev && isHumanItem(prev) ? 1800 : 800
    const t = setTimeout(() => setVisible(visible + 1), delay)
    return () => clearTimeout(t)
  }, [visible, items])

  if (error) return <Empty title="Run not found.">The transcript may have been deleted.</Empty>
  if (!run) return null

  const end = live ? Math.max(now, run.endedAt) : run.endedAt
  const rows = run.events.filter((e): e is Row => e.type !== 'thinking')
  const sel = rows.find((r) => r.id === selected) ?? null
  const playhead = visible !== null && visible > 0 ? (items[Math.min(visible, items.length) - 1]?.at ?? null) : null

  const pick = (itemId: string) => {
    if (tab === 'replay') {
      setVisible(null)
      requestAnimationFrame(() => jumpTo(itemId))
    } else setSelected(itemId)
  }
  const togglePlay = () => {
    if (visible !== null) return setVisible(null)
    setTab('replay')
    setVisible(0)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href="/runs" className="hover:text-fg">
              Runs
            </Link>
            <span className="text-faint">/</span>
            {run.skillId ? (
              <Link href={`/skills/${run.skillId}`} className="hover:text-fg">
                {run.skill}
              </Link>
            ) : (
              <span>{run.skill}</span>
            )}
            <span className="text-faint">/</span>
            <span>{shortId(run.id)}</span>
          </>
        }
        title={run.skill.split(':').pop()}
        meta={
          <>
            <StatusPill status={run.status} errors={run.errors} />
            <span>{run.project}</span>
            <span className="text-muted">{run.trigger === 'slash' ? 'via /command' : 'invoked by Claude'}</span>
            {run.model && <span className="font-mono text-[11.5px] text-muted">{run.model}</span>}
            <span className="tnum text-muted">{dateTime(run.startedAt)}</span>
            <span className="font-mono text-[11.5px] text-faint" title={run.sessionId}>
              session {shortId(run.sessionId)}
            </span>
          </>
        }
      />

      {/* Sticky control bar: view switch, key facts, playback, and the whole run at a glance. */}
      <div className="sticky top-0 z-30 px-6 pb-4 pt-2 sm:px-10">
        <div className="glass rounded-2xl !bg-[color-mix(in_srgb,var(--bg)_86%,transparent)] px-5 pb-2 pt-3 backdrop-blur-xl">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: 'replay', label: 'Replay' },
                { value: 'timeline', label: 'Timeline' },
              ]}
            />
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
              <Fact value={duration(end - run.startedAt)} label="total" tone={live ? 'text-signal' : undefined} />
              <Fact value={run.toolCalls} label="tool calls" />
              <Fact value={run.humanTurns} label="by you" tone="text-signal" />
              <Fact value={run.filesChanged} label={run.filesChanged === 1 ? 'file' : 'files'} />
              {run.errors > 0 && <Fact value={run.errors} label="failed" tone="text-err" />}
              <Fact value={compact(run.tokens.output)} label="tokens out" />
            </div>
            <button
              onClick={togglePlay}
              className={`ml-auto inline-flex h-8 items-center gap-2 rounded-full border px-3.5 text-[12.5px] transition-all ${
                visible !== null ? 'border-fg bg-fg text-bg' : 'border-signal/50 text-signal hover:bg-signal-soft hover:shadow-[0_0_20px_-6px_var(--signal)]'
              }`}
            >
              {visible !== null ? (
                <>
                  <span className="size-2 rounded-[2px] bg-bg" /> Stop
                </>
              ) : (
                <>
                  <svg width="9" height="10" viewBox="0 0 9 10" aria-hidden>
                    <path d="M0 0 L9 5 L0 10Z" fill="currentColor" />
                  </svg>
                  Play it back
                </>
              )}
            </button>
          </div>
          <div className="mt-2">
            <SignalStrip run={run} items={items} end={end} playhead={playhead} live={live} onPick={pick} />
          </div>
        </div>
      </div>

      <div className="px-6 sm:px-10">
        {tab === 'replay' ? (
          <div className="grid gap-8 pt-4 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0 max-w-4xl">
              <Replay run={run} items={items} now={now} live={live} visible={visible} />
            </div>
            <aside className="hidden xl:block">
              <div className="sticky top-44">
                <Glance run={run} items={items} />
              </div>
            </aside>
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
            <section className="glass min-w-0 overflow-hidden pt-5">
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3 px-6">
                <span className="label text-fg-2">{rows.length} steps</span>
                <span className="text-[12px] text-muted">
                  <Legend rows={rows} />
                </span>
              </div>
              {rows.length === 0 ? (
                <p className="px-6 pb-6 text-muted">{live ? 'Waiting for the first step…' : 'This run made no tool calls.'}</p>
              ) : (
                <Waterfall rows={rows} start={run.startedAt} end={end} now={now} live={live} selected={selected} onSelect={setSelected} />
              )}
            </section>
            <aside className="glass min-w-0 self-start xl:sticky xl:top-44 xl:max-h-[calc(100dvh-12rem)] xl:overflow-y-auto">
              <Inspector row={sel} runStart={run.startedAt} now={now} live={live} />
            </aside>
          </div>
        )}
      </div>
    </>
  )
}
