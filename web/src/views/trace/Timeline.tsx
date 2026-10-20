import { scaleLinear } from 'd3-scale'
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import type { TraceEvent } from '../../../../server/types.ts'
import { SkillMarkdown } from '../../components/Code.tsx'
import { KindDot, SectionTitle } from '../../components/ui.tsx'
import { duration } from '../../lib/format.ts'
import { KINDS, kindColor } from '../../lib/kinds.ts'
import { axisSpan, axisTicks, tickLabel } from '../../lib/timescale.ts'
import { isDeclined, shortTool, type ToolRow } from './items.ts'
import { AskCard, HumanBubble, PlanCard, StepDetail } from './moments.tsx'

export type Row = Exclude<TraceEvent, { type: 'thinking' }>

const HUMAN_VERB = { reply: 'replied', steer: 'added', interrupt: 'interrupted', reject: 'declined' } as const

const rowStart = (r: Row) => (r.type === 'tool' ? r.start : r.at)

function rowLabel(r: Row): { title: string; detail: string } {
  switch (r.type) {
    case 'tool':
      return { title: shortTool(r.name), detail: r.summary }
    case 'text':
      return { title: '', detail: r.text.split('\n')[0] }
    case 'ask':
      return { title: 'You · asked', detail: r.questions.map((q) => q.header ?? q.question).join(' · ') }
    case 'plan':
      return { title: 'You · plan', detail: r.approved === null ? 'awaiting approval' : r.approved ? 'approved' : 'sent back' }
    case 'human':
      return { title: `You · ${HUMAN_VERB[r.kind]}`, detail: r.text || (r.kind === 'reject' ? (r.tool ?? '') : '') }
  }
}

export function Legend({ rows }: { rows: Row[] }) {
  const present = new Set(rows.flatMap((r) => (r.type === 'tool' ? [r.kind] : [])))
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {KINDS.filter((k) => present.has(k.kind)).map((k) => (
        <span key={k.kind} className="inline-flex items-center gap-1.5">
          <KindDot kind={k.kind} />
          {k.label}
        </span>
      ))}
      {rows.some((r) => r.type === 'ask' || r.type === 'plan' || r.type === 'human') && (
        <span className="inline-flex items-center gap-1.5 text-signal">
          <span className="size-2 rotate-45 bg-signal" />
          You
        </span>
      )}
      {rows.some((r) => r.type === 'text') && (
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full border border-fg-2" />
          Claude
        </span>
      )}
    </span>
  )
}

interface WaterfallProps {
  rows: Row[]
  start: number
  end: number
  now: number
  live: boolean
  selected: string | null
  onSelect: (id: string | null) => void
}

export function Waterfall({ rows, start, end, now, live, selected, onSelect }: WaterfallProps) {
  // A live run gets a stable axis that extends past "now", so bars do not shift on every tick.
  const total = axisSpan(end - start, live)
  const x = useMemo(() => scaleLinear().domain([0, total]).range([0, 100]), [total])
  // Drop ticks that would crowd the right edge.
  const ticks = axisTicks(total).filter((t) => x(t) <= 90)
  const [tip, setTip] = useState<{ x: number; y: number; row: ToolRow } | null>(null)
  const [cursor, setCursor] = useState<number | null>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)

  // Rows that arrive while watching a live run get a brief highlight.
  const seen = useRef<Set<string> | null>(null)
  const fresh = new Set<string>()
  if (seen.current) for (const r of rows) if (!seen.current.has(r.id)) fresh.add(r.id)
  useEffect(() => {
    seen.current = new Set(rows.map((r) => r.id))
  }, [rows])

  const onMove = (e: MouseEvent) => {
    const box = track.current?.getBoundingClientRect()
    if (!box) return
    const f = (e.clientX - box.left) / box.width
    setCursor(f >= 0 && f <= 1 ? f : null)
  }
  const onBar = (e: MouseEvent, row: ToolRow) => {
    const box = wrap.current?.getBoundingClientRect()
    if (box) setTip({ x: e.clientX - box.left, y: e.clientY - box.top, row })
  }

  return (
    <div
      ref={wrap}
      className="relative overflow-x-auto pb-2"
      onMouseMove={onMove}
      onMouseLeave={() => {
        setTip(null)
        setCursor(null)
      }}
    >
      <div className="relative min-w-[680px] [--label:260px] 2xl:[--label:320px]">
        <div className="grid grid-cols-[var(--label)_minmax(0,1fr)_76px] border-y border-line">
          <div className="label py-2 pl-6">Step</div>
          <div className="relative">
            {ticks.map((t) => (
              <span key={t} className="label tnum absolute top-2 -translate-x-1/2 first:translate-x-0" style={{ left: `${x(t)}%` }}>
                {tickLabel(t)}
              </span>
            ))}
            {cursor !== null && (
              <span className="tnum absolute top-1 z-10 -translate-x-1/2 rounded-md bg-fg px-1.5 py-0.5 font-mono text-[10.5px] text-bg" style={{ left: `${cursor * 100}%` }}>
                +{duration(cursor * total)}
              </span>
            )}
          </div>
          <div className="label py-2 pr-6 text-right">Took</div>
        </div>

        <div className="relative">
          <div ref={track} className="pointer-events-none absolute inset-y-0 left-[var(--label)] right-[76px]">
            {ticks.map((t) => (
              <span key={t} className="absolute inset-y-0 border-l border-dashed border-line" style={{ left: `${x(t)}%` }} />
            ))}
            {cursor !== null && <span className="absolute inset-y-0 z-10 w-px bg-fg/50" style={{ left: `${cursor * 100}%` }} />}
            {live && (
              <span className="absolute inset-y-0 z-10 w-px bg-signal" style={{ left: `${x(end - start)}%` }}>
                <span className="absolute -left-[3px] -top-1 size-[7px] rounded-full bg-signal" />
              </span>
            )}
          </div>

          {rows.map((r) => {
            const isSel = selected === r.id
            const human = r.type === 'ask' || r.type === 'plan' || r.type === 'human'
            const { title, detail } = rowLabel(r)
            const base = `relative grid h-9 w-full cursor-pointer grid-cols-[var(--label)_minmax(0,1fr)_76px] items-center text-left transition-colors ${
              isSel ? 'bg-signal-soft' : human ? 'bg-[color-mix(in_srgb,var(--signal)_5%,transparent)] hover:bg-hover' : 'hover:bg-hover'
            } ${fresh.has(r.id) ? 'row-new' : ''}`
            const selBar = isSel && <span className="absolute inset-y-1 left-0 w-[2px] rounded-full bg-signal" />
            const left = `${x(rowStart(r) - start)}%`

            if (r.type === 'text' || r.type === 'human') {
              return (
                <button key={r.id} className={base} onClick={() => onSelect(isSel ? null : r.id)}>
                  {selBar}
                  <span className="flex min-w-0 items-center gap-2.5 pl-6 pr-3">
                    {r.type === 'text' ? (
                      <span className="size-2 shrink-0 rounded-full border border-fg-2" />
                    ) : (
                      <span className="size-2 shrink-0 rotate-45 bg-signal shadow-[0_0_8px_var(--signal)]" />
                    )}
                    {title && <span className="shrink-0 font-mono text-[12px] text-signal">{title}</span>}
                    <span className={`truncate ${r.type === 'text' ? 'italic text-muted' : 'text-fg-2'}`}>{detail}</span>
                  </span>
                  <span className="relative h-full">
                    <span
                      className={`absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 ${
                        r.type === 'text' ? 'border border-fg-2 bg-bg' : 'bg-signal shadow-[0_0_10px_var(--signal)]'
                      }`}
                      style={{ left }}
                    />
                  </span>
                  <span />
                </button>
              )
            }

            if (r.type === 'ask' || r.type === 'plan') {
              const waitedEnd = r.answeredAt ?? (live ? now : end)
              const w = Math.max(x(waitedEnd - r.at) - x(0), 0)
              return (
                <button key={r.id} className={base} onClick={() => onSelect(isSel ? null : r.id)}>
                  {selBar}
                  <span className="flex min-w-0 items-center gap-2.5 pl-6 pr-3">
                    <span className="size-2 shrink-0 rotate-45 bg-signal shadow-[0_0_8px_var(--signal)]" />
                    <span className="shrink-0 font-mono text-[12px] text-signal">{title}</span>
                    <span className="truncate text-fg-2">{detail}</span>
                  </span>
                  <span className="relative h-full" title="Time Claude waited for you">
                    <span
                      className={`absolute top-1/2 h-3.5 -translate-y-1/2 rounded-[4px] border border-signal/70 ${r.answeredAt === null && live ? 'bar-live' : ''}`}
                      style={{
                        left,
                        width: `max(6px, ${w}%)`,
                        background: 'repeating-linear-gradient(135deg, var(--signal-soft) 0 4px, transparent 4px 8px)',
                      }}
                    />
                  </span>
                  <span className="tnum pr-6 text-right font-mono text-[12px] text-signal">{r.answeredAt === null ? (live ? 'waiting' : '—') : duration(r.answeredAt - r.at)}</span>
                </button>
              )
            }

            const open = r.end === null
            const d = (open ? (live ? now : end) : r.end!) - r.start
            const declined = isDeclined(r)
            const color = declined ? 'var(--signal)' : r.isError ? 'var(--err)' : kindColor(r.kind)
            return (
              <button key={r.id} className={base} onClick={() => onSelect(isSel ? null : r.id)}>
                {selBar}
                <span className="flex min-w-0 items-center gap-2.5 pl-6 pr-3">
                  <KindDot kind={r.kind} />
                  <span className="shrink-0 font-mono text-[12px] text-fg">{title}</span>
                  <span className="truncate text-muted">{detail}</span>
                  {declined ? (
                    <span className="label shrink-0 text-[9.5px] text-signal">declined</span>
                  ) : (
                    r.isError && <span className="label shrink-0 text-[9.5px] text-err">✕ error</span>
                  )}
                </span>
                <span className="relative h-full" onMouseMove={(e) => onBar(e, r)} onMouseLeave={() => setTip(null)}>
                  <span
                    className={`absolute top-1/2 h-3.5 -translate-y-1/2 rounded-[4px] ${open && live ? 'bar-live' : ''}`}
                    style={{
                      left,
                      width: `max(4px, ${Math.max(x(d) - x(0), 0)}%)`,
                      background: `linear-gradient(90deg, ${color}, color-mix(in srgb, ${color} 70%, white))`,
                      boxShadow: `0 0 14px -2px ${color}`,
                      opacity: open && !live ? 0.35 : 1,
                    }}
                  />
                </span>
                <span className={`tnum pr-6 text-right font-mono text-[12px] ${r.isError && !declined ? 'text-err' : 'text-fg-2'}`}>{open && !live ? '—' : duration(d)}</span>
              </button>
            )
          })}
        </div>
      </div>

      {tip && (
        <div
          className="pointer-events-none absolute z-20 rounded-xl border border-line-strong bg-panel-solid/95 px-3 py-2 text-[12px] shadow-2xl backdrop-blur"
          style={{ left: Math.min(tip.x + 14, (wrap.current?.clientWidth ?? 0) - 230), top: tip.y + 16 }}
        >
          <div className="flex items-center gap-2 font-mono text-fg">
            <KindDot kind={tip.row.kind} />
            {shortTool(tip.row.name)}
          </div>
          <div className="tnum mt-1 text-muted">
            at +{duration(tip.row.start - start)} · took <span className="text-fg">{tip.row.end === null ? 'still running' : duration(tip.row.end - tip.row.start)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

export function Inspector({ row, runStart, now, live }: { row: Row | null; runStart: number; now: number; live: boolean }) {
  if (!row)
    return (
      <div className="p-6">
        <SectionTitle>Inspector</SectionTitle>
        <p className="display text-[24px] italic text-fg-2">Pick a step.</p>
        <p className="mt-1 text-muted">Its full input and output, or what you decided, show up here.</p>
      </div>
    )

  const at = row.type === 'tool' ? row.start : row.at
  const head = <SectionTitle aside={<span className="tnum font-mono">+{duration(at - runStart)}</span>}>{row.type === 'tool' ? 'Step' : row.type === 'text' ? 'Claude' : 'You'}</SectionTitle>

  if (row.type === 'text')
    return (
      <div className="p-6">
        {head}
        <SkillMarkdown source={row.text} />
      </div>
    )
  if (row.type === 'ask' || row.type === 'plan' || row.type === 'human')
    return (
      <div className="p-6">
        {head}
        {row.type === 'ask' ? <AskCard ev={row} live={live} /> : row.type === 'plan' ? <PlanCard ev={row} live={live} /> : <HumanBubble ev={row} />}
      </div>
    )

  const took = (row.end ?? now) - row.start
  const declined = isDeclined(row)
  return (
    <div className="p-6">
      {head}
      <div className="label mb-2 flex items-center gap-2">
        <KindDot kind={row.kind} />
        {KINDS.find((k) => k.kind === row.kind)?.label}
      </div>
      <div className="break-all font-mono text-[15px] text-fg">{shortTool(row.name)}</div>
      {row.summary && <p className="mt-1.5 break-words text-fg-2">{row.summary}</p>}
      <dl className="tnum my-4 grid grid-cols-2 gap-3 rounded-xl border border-line p-3">
        <div>
          <dt className="label text-[9.5px]">Took</dt>
          <dd className="font-mono text-[13px] text-fg">{row.end === null ? 'running' : duration(took)}</dd>
        </div>
        <div>
          <dt className="label text-[9.5px]">Result</dt>
          <dd className={`font-mono text-[13px] ${declined ? 'text-signal' : row.isError ? 'text-err' : 'text-ok'}`}>
            {row.end === null ? '—' : declined ? 'declined by you' : row.isError ? '✕ error' : '✓ ok'}
          </dd>
        </div>
      </dl>
      <StepDetail step={row} stacked />
    </div>
  )
}
