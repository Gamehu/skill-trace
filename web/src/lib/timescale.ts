/** Round durations a live axis can extend to, in ms. */
const SPANS = [5e3, 10e3, 15e3, 20e3, 30e3, 45e3, 60e3, 90e3, 120e3, 180e3, 300e3, 600e3, 900e3, 1200e3, 1800e3, 2700e3, 3600e3, 5400e3, 7200e3, 10800e3, 14400e3, 21600e3, 43200e3, 86400e3]

/**
 * The length of a run's time axis. A finished run spans exactly its duration. A live run spans the
 * next round duration past "now", so bars keep their positions as time passes instead of being
 * squeezed a little on every tick; the axis only rescales when it is about to fill up.
 */
export function axisSpan(elapsed: number, live: boolean): number {
  const e = Math.max(1, elapsed)
  if (!live) return e
  return SPANS.find((s) => s >= e * 1.1) ?? Math.ceil((e * 1.1) / 3600e3) * 3600e3
}

/** Candidate tick spacings in ms; the first giving at most `max` ticks wins. */
const TICK_STEPS = [100, 200, 500, 1e3, 2e3, 5e3, 10e3, 15e3, 30e3, 60e3, 120e3, 300e3, 600e3, 900e3, 1800e3, 3600e3, 7200e3, 21600e3]

export function axisTicks(span: number, max = 6): number[] {
  const step = TICK_STEPS.find((s) => span / s <= max) ?? TICK_STEPS[TICK_STEPS.length - 1]
  return Array.from({ length: Math.floor(span / step) + 1 }, (_, i) => i * step)
}

export function tickLabel(t: number) {
  if (t === 0) return '0'
  if (t % 3600e3 === 0) return `${t / 3600e3}h`
  if (t % 60e3 === 0) return `${t / 60e3}m`
  if (t >= 60e3) return `${Math.floor(t / 60e3)}m${(t % 60e3) / 1e3}s`
  return `${t / 1e3}s`
}
