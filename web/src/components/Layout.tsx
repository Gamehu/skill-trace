import { useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'wouter'
import { LiveContext } from '../lib/api.ts'

/** Three trace bars; they oscillate while the live stream is connected. */
function Logo({ live }: { live: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
      {[
        { y: 4, w: 13, x: 1, o: 1 },
        { y: 9.5, w: 15, x: 6, o: 0.6 },
        { y: 15, w: 8, x: 3, o: 0.35 },
      ].map((b, i) => (
        <rect key={b.y} x={b.x} y={b.y} width={b.w} height="3" rx="1.5" fill="var(--signal)" opacity={b.o}>
          {live && <animate attributeName="width" values={`${b.w};${b.w * 0.55};${b.w}`} dur={`${1.6 + i * 0.5}s`} repeatCount="indefinite" />}
        </rect>
      ))}
    </svg>
  )
}

const NAV = [
  { href: '/overview', label: 'Overview', n: '01' },
  { href: '/skills', label: 'Skills', n: '02' },
  { href: '/runs', label: 'Runs', n: '03' },
]

function NavLink({ href, label, n }: (typeof NAV)[number]) {
  const [loc] = useLocation()
  const active = loc === href || loc.startsWith(href + '/')
  return (
    <Link
      href={href}
      className={`group relative flex h-9 items-center gap-3 rounded-lg px-3 transition-colors ${
        active ? 'bg-raised text-fg' : 'text-muted hover:bg-hover hover:text-fg'
      }`}
    >
      {active && <span className="absolute -left-3 top-2 h-5 w-[2px] rounded-full bg-signal shadow-[0_0_10px_var(--signal)] max-md:hidden" />}
      <span className={`font-mono text-[10.5px] ${active ? 'text-signal' : 'text-faint group-hover:text-muted'}`}>{n}</span>
      <span className="text-[13.5px]">{label}</span>
    </Link>
  )
}

/**
 * A small oscilloscope: idles as a gentle wave and spikes each time the server pushes a change.
 */
function LiveScope({ version, connected }: { version: number; connected: boolean }) {
  const [amp, setAmp] = useState(1)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    setAmp(6)
    const t = setTimeout(() => setAmp(1), 900)
    return () => clearTimeout(t)
  }, [version])

  const w = 120
  const path = Array.from({ length: 61 }, (_, i) => {
    const x = (i / 60) * w
    const y = 12 + Math.sin(i / 3.2) * (connected ? amp : 0) * Math.sin((i / 60) * Math.PI)
    return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  return (
    <svg width={w} height="24" className="block" aria-hidden>
      <path
        d={path}
        fill="none"
        stroke={connected ? 'var(--signal)' : 'var(--faint)'}
        strokeWidth="1.4"
        strokeDasharray="3 2"
        className="scope-line"
        style={{ transition: 'd 0.5s ease', filter: connected ? 'drop-shadow(0 0 4px var(--signal))' : undefined }}
      />
    </svg>
  )
}

function ThemeToggle() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? 'dark')
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem('theme', next)
    } catch {
      // Storage can be unavailable (private mode); the toggle still applies to this page view.
    }
    setTheme(next)
  }
  return (
    <button onClick={toggle} className="label transition-colors hover:text-fg" title="Toggle theme">
      {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  )
}

export function Layout({ children }: { children: ReactNode }) {
  const { connected, version } = useContext(LiveContext)
  return (
    <div className="flex min-h-dvh max-md:flex-col">
      <aside className="flex shrink-0 flex-col border-line max-md:border-b md:sticky md:top-0 md:h-dvh md:w-60 md:border-r">
        <Link href="/overview" className="flex items-center gap-2.5 px-6 pb-8 pt-7 max-md:pb-3 max-md:pt-4">
          <Logo live={connected} />
          <span className="text-[17px] tracking-tight text-fg">
            skill<span className="display text-[21px] italic text-signal">trace</span>
          </span>
        </Link>
        <nav className="flex gap-1 px-3 md:flex-col max-md:overflow-x-auto max-md:pb-3">
          {NAV.map((item) => (
            <NavLink key={item.href} {...item} />
          ))}
        </nav>
        <div className="mt-auto px-6 pb-6 max-md:hidden">
          <div className="glass p-4">
            <div className="flex items-center justify-between">
              <span className="label flex items-center gap-2">
                <span className={`size-1.5 rounded-full ${connected ? 'bg-signal shadow-[0_0_8px_var(--signal)]' : 'bg-faint'}`} />
                {connected ? 'Live' : 'Offline'}
              </span>
              <ThemeToggle />
            </div>
            <div className="mt-3">
              <LiveScope version={version} connected={connected} />
            </div>
            <p className="mt-2 text-[11.5px] leading-snug text-muted">
              {connected ? 'Watching ~/.claude for skill activity.' : 'Reconnecting to the local server…'}
            </p>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 pb-16">{children}</main>
    </div>
  )
}
