import type { RunSummary, ToolKind } from '../../../server/types.ts'
import { KINDS, kindColor } from '../lib/kinds.ts'

interface ShapeProps {
  run: RunSummary
  now: number
  width?: number
  height?: number
  /** Stretch to the container width; `width` then only sets the drawing resolution. */
  fluid?: boolean
}

/** A micro-timeline of a run: one glowing tick per tool call, positioned by time. */
export function Shape({ run, now, width = 140, height = 16, fluid = false }: ShapeProps) {
  const total = Math.max(1, (run.status === 'running' ? now : run.endedAt) - run.startedAt)
  // One path per tool kind keeps the DOM small even for runs with hundreds of calls.
  const paths = new Map<ToolKind, string>()
  for (const [offset, dur, kind] of run.shape) {
    const x = Math.min((offset / total) * width, width - 2)
    const w = Math.min(Math.max(2, (dur / total) * width), width - x)
    paths.set(kind, `${paths.get(kind) ?? ''}M${x.toFixed(1)} 4h${w.toFixed(1)}v${height - 8}h${(-w).toFixed(1)}z`)
  }
  return (
    <svg
      width={fluid ? '100%' : width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="block overflow-visible"
      aria-hidden
    >
      <line x1={0} x2={width} y1={height / 2} y2={height / 2} stroke="var(--line-strong)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      {KINDS.filter((k) => paths.has(k.kind)).map((k) => (
        <path key={k.kind} d={paths.get(k.kind)} fill={kindColor(k.kind)} style={{ filter: `drop-shadow(0 0 3px ${kindColor(k.kind)})` }} />
      ))}
      {run.status === 'running' && <rect x={width - 1.5} y={0} width={1.5} height={height} fill="var(--signal)" className="bar-live" />}
    </svg>
  )
}
