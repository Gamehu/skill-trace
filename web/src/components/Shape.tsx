import type { RunSummary } from '../../../server/types.ts'
import { kindColor } from '../lib/kinds.ts'

/** A micro-timeline of a run: one tick per tool call, positioned by time. */
export function Shape({ run, width = 132, height = 14, now }: { run: RunSummary; width?: number; height?: number; now: number }) {
  const total = Math.max(1, (run.status === 'running' ? now : run.endedAt) - run.startedAt)
  return (
    <svg width={width} height={height} className="block" aria-hidden>
      <line x1={0} x2={width} y1={height / 2} y2={height / 2} stroke="var(--line)" strokeWidth={1} />
      {run.shape.map(([offset, dur, kind], i) => {
        const x = (offset / total) * width
        const w = Math.max(2, (dur / total) * width)
        return <rect key={i} x={Math.min(x, width - 2)} y={3} width={Math.min(w, width - x)} height={height - 6} rx={1} fill={kindColor(kind)} />
      })}
    </svg>
  )
}
