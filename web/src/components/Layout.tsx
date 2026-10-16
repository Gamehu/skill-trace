import { useContext, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'wouter'
import { LiveContext } from '../lib/api.ts'

function Logo() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="text-fg">
      <rect x="1" y="3" width="9" height="2.5" rx="1" fill="currentColor" />
      <rect x="5" y="7" width="10" height="2.5" rx="1" fill="currentColor" opacity="0.55" />
      <rect x="3" y="11" width="6" height="2.5" rx="1" fill="currentColor" opacity="0.3" />
    </svg>
  )
}

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const [loc] = useLocation()
  const active = loc === href || loc.startsWith(href + '/')
  return (
    <Link
      href={href}
      className={`flex h-7 items-center rounded-md px-2 text-[13px] transition-colors ${
        active ? 'bg-raised text-fg' : 'text-muted hover:bg-hover hover:text-fg-2'
      }`}
    >
      {children}
    </Link>
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
      // storage unavailable; the toggle still works for this page view
    }
    setTheme(next)
  }
  return (
    <button onClick={toggle} className="text-[12px] text-muted hover:text-fg-2" title="Toggle theme">
      {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  )
}

export function Layout({ children }: { children: ReactNode }) {
  const { connected } = useContext(LiveContext)
  return (
    <div className="flex min-h-dvh max-md:flex-col">
      <aside className="flex shrink-0 flex-col border-line bg-panel max-md:border-b md:sticky md:top-0 md:h-dvh md:w-52 md:border-r">
        <div className="flex items-center gap-2 px-4 pb-4 pt-5 max-md:pb-2 max-md:pt-3">
          <Logo />
          <span className="font-mono text-[13px] font-medium tracking-tight text-fg">skill-trace</span>
        </div>
        <nav className="flex gap-0.5 px-2 md:flex-col max-md:pb-2">
          <NavLink href="/skills">Skills</NavLink>
          <NavLink href="/runs">Runs</NavLink>
        </nav>
        <div className="mt-auto flex items-center justify-between border-line px-4 py-3 max-md:hidden md:border-t">
          <span className="inline-flex items-center gap-1.5 text-[12px] text-muted" title={connected ? 'Watching transcripts' : 'Disconnected'}>
            <span className={`size-1.5 rounded-full ${connected ? 'bg-ok' : 'bg-faint'}`} />
            {connected ? 'Live' : 'Offline'}
          </span>
          <ThemeToggle />
        </div>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  )
}
