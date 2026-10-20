import { useRef, useState, type MouseEvent } from 'react'
import type { RunDetail } from '../../../../server/types.ts'
import { duration } from '../../lib/format.ts'
import { KINDS, kindColor } from '../../lib/kinds.ts'
import { axisSpan, axisTicks, tickLabel } from '../../lib/timescale.ts'
import { humanLabel, isDeclined, isHumanItem, shortTool, type Item, type ToolRow } from './items.ts'

interface SignalStripProps {
  run: RunDetail
  items: Item[]
  now: number
  live: boolean
  /** Time revealed so far during playback. */
  playhead: number | null
  /** Jump to a step or to a moment of the person's. */
  onPick: (id: string) => void
}

type Tip = { x: number; title: string; detail: string; tone: string }

function stepTone(s: ToolRow) {
  return isDeclined(s) ? 'var(--signal)' : s.isError ? 'var(--err)' : kindColor(s.kind)
}

/**
 * The whole run on one axis: each tool call is a bar (color = kind, red = failed), each moment the
 * person took part in is a diamond above it. Hovering explains a mark; clicking jumps to it.
 */
export function SignalStrip({ run, items, now, live, playhead, onPick }: SignalStripProps) {
  const elapsed = (live ? Math.max(now, run.endedAt) : run.endedAt) - run.startedAt
  const span = axisSpan(elapsed, live)
  const at = (t: number) => Math.min(100, Math.max(0, ((t - run.startedAt) / span) * 100))
  const ticks = axisTicks(span, 5)
  const steps = run.events.filter((e): e is ToolRow => e.type === 'tool')
  const moments = items.filter(isHumanItem)
  const kinds = KINDS.filter((k) => steps.some((s) => s.kind === k.kind))
  const failed = steps.some((s) => s.isError && !isDeclined(s))
  const waitingSince = run.status === 'waiting' ? run.endedAt : null

  const [tip, setTip] = useState<Tip | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const show = (e: MouseEvent, t: Omit<Tip, 'x'>) => {
    const r = box.current?.getBoundingClientRect()
    // Keep the tooltip (up to ~340px wide, centered on x) inside the strip.
    if (r) setTip({ ...t, x: Math.min(Math.max(e.clientX - r.left, 175), r.width - 175) })
  }

  return (
    <div>
      <div ref={box} className="relative h-12" onMouseLeave={() => setTip(null)} role="group" aria-label="Every step of the run on a time axis">
        {/* Track: solid up to now, dashed for the time still ahead on a live axis. */}
        <span className="absolute left-0 top-[31px] h-px bg-line-strong" style={{ width: `${at(run.startedAt + elapsed)}%` }} />
        {live && <span className="absolute right-0 top-[31px] h-px border-t border-dashed border-line" style={{ left: `${at(run.startedAt + elapsed)}%` }} />}

        {waitingSince !== null && (
          <span
            className="absolute top-[26px] h-[11px] rounded-[3px] border border-signal/60"
            style={{
              left: `${at(waitingSince)}%`,
              width: `${Math.max(0.5, at(run.startedAt + elapsed) - at(waitingSince))}%`,
              background: 'repeating-linear-gradient(135deg, var(--signal-soft) 0 4px, transparent 4px 8px)',
            }}
            onMouseMove={(e) => show(e, { title: 'Waiting for you', detail: `since ${duration(now - waitingSince)} ago`, tone: 'var(--signal)' })}
          />
        )}

        {steps.map((s) => {
          const end = s.end ?? run.startedAt + elapsed
          const tone = stepTone(s)
          const status = isDeclined(s) ? 'declined by you' : s.isError ? 'failed' : s.end === null ? 'running' : 'ok'
          return (
            <button
              key={s.id}
              onClick={() => onPick(s.id)}
              aria-label={`${s.name}, ${status}`}
              className="absolute top-[22px] h-[19px] -translate-x-px rounded-[3px] px-px outline-none focus-visible:ring-2 focus-visible:ring-fg"
              style={{ left: `${at(s.start)}%`, width: `max(5px, ${at(end) - at(s.start)}%)` }}
              onMouseMove={(e) =>
                show(e, {
                  title: `${shortTool(s.name)} · ${status}`,
                  detail: `${s.summary ? `${s.summary.slice(0, 60)} · ` : ''}${s.end === null ? 'still running' : duration(s.end - s.start)}`,
                  tone,
                })
              }
            >
              <span className={`block h-[11px] w-full rounded-[3px] transition-opacity hover:opacity-80 ${s.end === null && live ? 'bar-live' : ''}`} style={{ marginTop: 4, background: tone }} />
            </button>
          )
        })}

        {moments.map((m) => (
          <button
            key={m.id}
            onClick={() => onPick(m.id)}
            aria-label={humanLabel(m)}
            className="absolute top-0 -translate-x-1/2 px-1.5 pb-1 outline-none focus-visible:ring-2 focus-visible:ring-fg"
            style={{ left: `${at(m.at)}%` }}
            onMouseMove={(e) => show(e, { title: 'You', detail: humanLabel(m), tone: 'var(--signal)' })}
          >
            <span className="block size-2.5 rotate-45 bg-signal" />
            <span className="mx-auto block h-[12px] w-px bg-signal/60" />
          </button>
        ))}

        {live && (
          <span className="pointer-events-none absolute inset-y-1 w-px bg-signal" style={{ left: `${at(run.startedAt + elapsed)}%` }}>
            <span className="absolute -top-0.5 left-1 font-mono text-[9.5px] uppercase tracking-[0.1em] text-signal">now</span>
          </span>
        )}
        {playhead !== null && <span className="pointer-events-none absolute inset-y-0 w-[2px] bg-fg transition-[left] duration-500" style={{ left: `${at(playhead)}%` }} />}

        {tip && (
          <div className="pointer-events-none absolute top-full z-20 mt-1 -translate-x-1/2 whitespace-nowrap rounded-lg border border-line-strong bg-panel-solid px-2.5 py-1.5 text-[12px] shadow-xl" style={{ left: tip.x }}>
            <div className="flex items-center gap-1.5 font-mono text-fg">
              <span className="size-2 rounded-[2px]" style={{ background: tip.tone }} />
              {tip.title}
            </div>
            <div className="max-w-[340px] truncate text-muted">{tip.detail}</div>
          </div>
        )}
      </div>

      {/* Axis and key */}
      <div className="relative mt-0.5 h-4 font-mono text-[10px] text-faint">
        {ticks.map((t) => (
          <span key={t} className="tnum absolute -translate-x-1/2 first:translate-x-0" style={{ left: `${(t / span) * 100}%` }}>
            {tickLabel(t)}
          </span>
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted">
        {kinds.map((k) => (
          <span key={k.kind} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-3 rounded-[2px]" style={{ background: kindColor(k.kind) }} />
            {k.label}
          </span>
        ))}
        {failed && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-3 rounded-[2px] bg-err" />
            Failed
          </span>
        )}
        {moments.length > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rotate-45 bg-signal" />
            You took part
          </span>
        )}
        {waitingSince !== null && (
          <span className="inline-flex items-center gap-1.5 text-signal">
            <span className="h-2 w-3 rounded-[2px] border border-signal/60 bg-[repeating-linear-gradient(135deg,var(--signal-soft)_0_3px,transparent_3px_6px)]" />
            Waiting for you
          </span>
        )}
        <span className="ml-auto text-faint">Hover for details · click to jump there</span>
      </div>
    </div>
  )
}
