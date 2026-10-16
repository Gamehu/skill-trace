import { useEffect, useRef, useState, type PointerEvent } from 'react'

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/**
 * Animates a number from its previous value to `target` with an ease-out curve.
 *
 * @param target - The value to settle on.
 * @param ms - Duration of the animation.
 * @returns The current animated value.
 */
export function useCountUp(target: number, ms = 900): number {
  const [value, setValue] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    if (reducedMotion()) {
      setValue(target)
      return
    }
    const start = performance.now()
    const origin = from.current
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms)
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(origin + (target - origin) * eased)
      if (t < 1) raf = requestAnimationFrame(tick)
      else from.current = target
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return value
}

/**
 * Pointer handler that feeds the `.spotlight` CSS effect its cursor position.
 *
 * @param e - Pointer move event on the spotlight element.
 */
export function trackSpotlight(e: PointerEvent<HTMLElement>): void {
  const el = e.currentTarget
  const box = el.getBoundingClientRect()
  el.style.setProperty('--mx', `${e.clientX - box.left}px`)
  el.style.setProperty('--my', `${e.clientY - box.top}px`)
}
