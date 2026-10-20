import type { RunSummary, ToolKind } from '../../../server/types.ts'
import { duration } from '../lib/format.ts'
import { KINDS, kindColor } from '../lib/kinds.ts'
import { axisSpan } from '../lib/timescale.ts'

interface ShapeProps {
  run: RunSummary
  now: number
  width?: number
  height?: number
  /** Stretch to the container width; `width` then only sets the drawing resolution. */
  fluid?: boolean
}

/** "6 tool calls over 1m 27s: Shell 3, Read 2, Write 1" — what the thumbnail shows, in words. */
export function shapeSummary(run: RunSummary, now: number) {
  const live = run.status === 'running' || run.status === 'waiting'
  const counts = new Map<ToolKind, number>()
  for (const [, , kind] of run.shape) counts.set(kind, (counts.get(kind) ?? 0) + 1)
  const mix = KINDS.filter((k) => counts.has(k.kind))
    .map((k) => `${k.label} ${counts.get(k.kind)}`)
    .join(', ')
  const took = duration((live ? now : run.endedAt) - run.startedAt)
  return `${run.shape.length} tool call${run.shape.length === 1 ? '' : 's'} over ${took}${mix ? `: ${mix}` : ''}`
}

/** A run in miniature: one bar per tool call, placed by when it happened, colored by tool kind. */
export function Shape({ run, now, width = 140, height = 16, fluid = false }: ShapeProps) {
  const live = run.status === 'running' || run.status === 'waiting'
  const elapsed = (live ? Math.max(now, run.endedAt) : run.endedAt) - run.startedAt
  const total = axisSpan(elapsed, live)
  // One path per tool kind keeps the DOM small even for runs with hundreds of calls.
  const paths = new Map<ToolKind, string>()
  for (const [offset, dur, kind] of run.shape) {
    const x = Math.min((offset / total) * width, width - 2)
    const w = Math.min(Math.max(2, (dur / total) * width), width - x)
    paths.set(kind, `${paths.get(kind) ?? ''}M${x.toFixed(1)} 4h${w.toFixed(1)}v${height - 8}h${(-w).toFixed(1)}z`)
  }
  const nowX = (elapsed / total) * width
  const label = shapeSummary(run, now)
  return (
    <svg width={fluid ? '100%' : width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="block" role="img" aria-label={label}>
      <title>{label}</title>
      <line x1={0} x2={nowX} y1={height / 2} y2={height / 2} stroke="var(--line-strong)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      {KINDS.filter((k) => paths.has(k.kind)).map((k) => (
        <path key={k.kind} d={paths.get(k.kind)} fill={kindColor(k.kind)} />
      ))}
      {live && <rect x={nowX} y={1} width={1.5} height={height - 2} fill="var(--signal)" />}
    </svg>
  )
}
