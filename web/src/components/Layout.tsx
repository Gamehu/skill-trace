import { useContext, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'wouter'
import { LiveContext, useNow } from '../lib/api.ts'
import { useScope, withScope } from '../lib/agents.ts'
import { ago } from '../lib/format.ts'

/** Three trace bars. */
function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
      {[
        { y: 4, w: 13, x: 1, o: 1 },
        { y: 9.5, w: 15, x: 6, o: 0.6 },
        { y: 15, w: 8, x: 3, o: 0.35 },
      ].map((b) => (
        <rect key={b.y} x={b.x} y={b.y} width={b.w} height="3" rx="1.5" fill="var(--signal)" opacity={b.o} />
      ))}
    </svg>
  )
}

const NAV = [
  { href: '/overview', label: 'Overview', n: '01', scoped: true },
  { href: '/skills', label: 'Skills', n: '02', scoped: true },
  { href: '/runs', label: 'Runs', n: '03', scoped: true },
  { href: '/settings', label: 'Settings', n: '04', scoped: false },
]

function NavLink({ href, label, n, scoped }: (typeof NAV)[number]) {
  const [loc] = useLocation()
  const [scope] = useScope()
  const active = loc === href || loc.startsWith(href + '/')
  return (
    <Link
      href={scoped ? withScope(href, scope) : href}
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

/** Connection state in words: whether the page is live and when data last changed. */
function LiveStatus({ connected, updatedAt }: { connected: boolean; updatedAt: number | null }) {
  const now = useNow(updatedAt !== null, 5000)
  return (
    <div>
      <span className="flex items-center gap-2 text-[12.5px] text-fg">
        <span className={`size-1.5 rounded-full ${connected ? 'bg-ok' : 'bg-faint'}`} />
        {connected ? 'Live' : 'Offline'}
      </span>
      <p className="mt-1 text-[11.5px] leading-snug text-muted">
        {!connected
          ? 'Lost the local server; retrying every few seconds.'
          : updatedAt
            ? `New activity ${ago(updatedAt, now)}. Pages update on their own.`
            : 'Pages update on their own as your coding agents work.'}
      </p>
    </div>
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
    <button onClick={toggle} className="text-[11.5px] text-muted underline decoration-line-strong underline-offset-4 transition-colors hover:text-fg">
      Switch to {theme === 'dark' ? 'light' : 'dark'} mode
    </button>
  )
}

export function Layout({ children }: { children: ReactNode }) {
  const { connected, updatedAt } = useContext(LiveContext)
  return (
    <div className="flex min-h-dvh max-md:flex-col">
      <aside className="flex shrink-0 flex-col border-line max-md:border-b md:sticky md:top-0 md:h-dvh md:w-60 md:border-r">
        <Link href="/overview" className="flex items-center gap-2.5 px-6 pb-8 pt-7 max-md:pb-3 max-md:pt-4">
          <Logo />
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
          <div className="glass space-y-3 p-4">
            <LiveStatus connected={connected} updatedAt={updatedAt} />
            <ThemeToggle />
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 pb-16">{children}</main>
    </div>
  )
}
