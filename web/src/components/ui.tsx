import type { ReactNode } from 'react'
import type { RunStatus, SkillSource, ToolKind } from '../../../server/types.ts'
import { kindColor } from '../lib/kinds.ts'

export function PageHeader({ title, meta, actions }: { title: ReactNode; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-line px-6 pb-4 pt-6 sm:px-8">
      <div className="min-w-0">
        <h1 className="truncate text-[19px] font-semibold tracking-[-0.015em] text-fg">{title}</h1>
        {meta && <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">{meta}</div>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  )
}

const STATUS: Record<RunStatus, { label: string; cls: string }> = {
  running: { label: 'Running', cls: 'bg-ok' },
  done: { label: 'Done', cls: 'bg-muted' },
  interrupted: { label: 'Interrupted', cls: 'bg-warn' },
}

export function StatusDot({ status, errors = 0 }: { status: RunStatus; errors?: number }) {
  const failed = errors > 0 && status !== 'running'
  const label = failed ? `${STATUS[status].label} with ${errors} error${errors > 1 ? 's' : ''}` : STATUS[status].label
  return (
    <span className="relative inline-flex size-2 shrink-0" title={label} aria-label={label}>
      {status === 'running' && <span className="absolute inset-0 animate-ping rounded-full bg-ok opacity-60" />}
      <span className={`relative size-2 rounded-full ${failed ? 'bg-err' : STATUS[status].cls}`} />
    </span>
  )
}

export function StatusLabel({ status, errors }: { status: RunStatus; errors: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-fg-2">
      <StatusDot status={status} errors={errors} />
      {STATUS[status].label}
      {errors > 0 && <span className="text-err">· {errors} error{errors > 1 ? 's' : ''}</span>}
    </span>
  )
}

const SOURCE_LABEL: Record<SkillSource, string> = {
  user: 'user',
  project: 'project',
  plugin: 'plugin',
  builtin: 'built-in',
}

export function SourceTag({ source }: { source: SkillSource }) {
  return (
    <span className="inline-flex h-[18px] items-center rounded border border-line px-1.5 font-mono text-[10.5px] text-muted">
      {SOURCE_LABEL[source]}
    </span>
  )
}

export function KindDot({ kind, className = '' }: { kind: ToolKind; className?: string }) {
  return <span className={`inline-block size-2 shrink-0 rounded-[2px] ${className}`} style={{ background: kindColor(kind) }} />
}

/** A row of figures separated by hairlines — no cards. */
export function Stats({ items }: { items: { label: string; value: ReactNode; hint?: string }[] }) {
  return (
    <dl className="grid grid-cols-2 border-b border-line sm:flex">
      {items.map((it) => (
        <div
          key={it.label}
          className="min-w-0 border-line px-6 py-4 max-sm:odd:border-r max-sm:[&:nth-child(n+3)]:border-t sm:flex-1 sm:border-r sm:px-8 sm:last:border-r-0"
          title={it.hint}
        >
          <dt className="text-[11.5px] text-muted">{it.label}</dt>
          <dd className="tnum mt-0.5 truncate text-[17px] font-medium tracking-[-0.01em] text-fg">{it.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4">
      <h2 className="text-[12px] font-medium text-fg-2">{children}</h2>
      {aside && <div className="text-[12px] text-muted">{aside}</div>}
    </div>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mx-auto max-w-md px-6 py-20 text-center">
      <p className="text-fg-2">{title}</p>
      {children && <div className="mt-2 text-muted">{children}</div>}
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; count?: number }[]
}) {
  return (
    <div className="inline-flex rounded-md border border-line bg-panel p-0.5" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`h-6 rounded-[5px] px-2.5 text-[12px] transition-colors ${
            value === o.value ? 'bg-raised text-fg shadow-[0_0_0_1px_var(--line-strong)]' : 'text-muted hover:text-fg-2'
          }`}
        >
          {o.label}
          {o.count !== undefined && <span className="tnum ml-1.5 text-faint">{o.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      spellCheck={false}
      className="h-7 w-56 rounded-md border border-line bg-panel px-2.5 text-[12.5px] text-fg outline-none placeholder:text-faint focus:border-line-strong max-sm:w-full"
    />
  )
}
