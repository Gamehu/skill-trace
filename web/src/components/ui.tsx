import { useId, type ReactNode } from 'react'
import type { RunStatus, SkillSource, ToolKind } from '../../../server/types.ts'
import { kindColor } from '../lib/kinds.ts'

interface PageHeaderProps {
  /** Small mono caption above the title, e.g. a breadcrumb. */
  eyebrow?: ReactNode
  title: ReactNode
  meta?: ReactNode
  actions?: ReactNode
}

export function PageHeader({ eyebrow, title, meta, actions }: PageHeaderProps) {
  return (
    <header className="rise flex flex-wrap items-end justify-between gap-x-8 gap-y-4 px-6 pb-6 pt-9 sm:px-10">
      <div className="min-w-0">
        {eyebrow && <div className="label mb-3 flex items-center gap-2">{eyebrow}</div>}
        <h1 className="display truncate text-[44px] text-fg sm:text-[52px]">{title}</h1>
        {meta && <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-fg-2">{meta}</div>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  )
}

const STATUS: Record<RunStatus, string> = {
  running: 'Running',
  waiting: 'Waiting for you',
  done: 'Done',
  interrupted: 'Interrupted',
}

interface StatusProps {
  status: RunStatus
  errors?: number
}

export function StatusDot({ status, errors = 0 }: StatusProps) {
  const failed = errors > 0 && status !== 'running'
  const label = failed ? `${STATUS[status]} with ${errors} error${errors > 1 ? 's' : ''}` : STATUS[status]
  const active = status === 'running' || status === 'waiting'
  const color = active ? 'bg-signal' : failed ? 'bg-err' : status === 'interrupted' ? 'bg-warn' : 'bg-faint'
  return (
    <span className="relative inline-flex size-2 shrink-0" title={label} aria-label={label}>
      {active && <span className={`absolute inset-0 rounded-full bg-signal ${status === 'waiting' ? 'animate-pulse' : 'animate-ping'}`} />}
      <span
        className={`relative size-2 ${status === 'waiting' ? 'rotate-45 rounded-[2px]' : 'rounded-full'} ${color}`}
        style={active ? { boxShadow: '0 0 10px var(--signal)' } : undefined}
      />
    </span>
  )
}

export function StatusPill({ status, errors = 0 }: StatusProps) {
  const tone =
    status === 'running' || status === 'waiting'
      ? 'border-signal/40 bg-signal-soft text-signal'
      : errors > 0
        ? 'border-err/30 text-err'
        : 'border-line-strong text-fg-2'
  return (
    <span className={`inline-flex h-6 items-center gap-2 rounded-full border px-2.5 font-mono text-[11px] uppercase tracking-[0.1em] ${tone}`}>
      <StatusDot status={status} errors={errors} />
      {STATUS[status]}
      {errors > 0 && status !== 'running' && status !== 'waiting' && <span>· {errors} err</span>}
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
    <span className="inline-flex h-[18px] shrink-0 items-center rounded-full border border-line-strong px-2 font-mono text-[10px] uppercase tracking-[0.08em] text-muted">
      {SOURCE_LABEL[source]}
    </span>
  )
}

export function KindDot({ kind, className = '' }: { kind: ToolKind; className?: string }) {
  return (
    <span
      className={`inline-block size-2 shrink-0 rounded-[2px] ${className}`}
      style={{ background: kindColor(kind), boxShadow: `0 0 8px ${kindColor(kind)}` }}
    />
  )
}

interface SparklineProps {
  values: number[]
  width?: number
  height?: number
  /** Stroke color; defaults to the signal color. */
  color?: string
}

/** Smooth area sparkline with a glowing stroke and an end marker. */
export function Sparkline({ values, width = 120, height = 32, color = 'var(--signal)' }: SparklineProps) {
  const gradId = useId()
  if (values.length < 2) return null
  const max = Math.max(1, ...values)
  const step = width / (values.length - 1)
  const pts = values.map((v, i) => [i * step, height - 3 - (v / max) * (height - 6)] as const)
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const [lx, ly] = pts[pts.length - 1]
  return (
    <svg width={width} height={height} className="block overflow-visible" aria-hidden>
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${width},${height} L0,${height} Z`} fill={`url(#${gradId})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
      <circle cx={lx} cy={ly} r="2.5" fill={color} />
    </svg>
  )
}

interface MetricProps {
  label: string
  value: ReactNode
  /** Secondary line under the value. */
  hint?: ReactNode
  spark?: number[]
  /** Stagger index for the entrance animation. */
  index?: number
}

export function Metric({ label, value, hint, spark, index = 0 }: MetricProps) {
  return (
    <div className="glass rise flex min-w-0 flex-col justify-between gap-4 p-5" style={{ ['--i' as string]: index }}>
      <div className="label">{label}</div>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="tnum truncate font-mono text-[28px] font-medium leading-none tracking-[-0.03em] text-fg">{value}</div>
          {hint && <div className="mt-2 truncate text-[12px] text-muted">{hint}</div>}
        </div>
        {spark && <Sparkline values={spark} width={84} height={30} />}
      </div>
    </div>
  )
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-4">
      <h2 className="label flex items-center gap-2 text-fg-2">{children}</h2>
      {aside && <div className="text-[12px] text-muted">{aside}</div>}
    </div>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mx-auto max-w-md px-6 py-24 text-center">
      <p className="display text-[30px] text-fg-2 italic">{title}</p>
      {children && <div className="mt-3 text-muted">{children}</div>}
    </div>
  )
}

interface SegmentedProps<T extends string> {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; count?: number }[]
}

export function Segmented<T extends string>({ value, onChange, options }: SegmentedProps<T>) {
  return (
    <div className="inline-flex flex-wrap rounded-full border border-line bg-panel p-1 backdrop-blur" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`h-7 rounded-full px-3.5 text-[12.5px] transition-all ${
            value === o.value ? 'bg-fg text-bg shadow-[0_0_20px_-4px_var(--signal)]' : 'text-muted hover:text-fg'
          }`}
        >
          {o.label}
          {o.count !== undefined && <span className={`tnum ml-1.5 font-mono text-[11px] ${value === o.value ? 'opacity-60' : 'text-faint'}`}>{o.count}</span>}
        </button>
      ))}
    </div>
  )
}

interface SearchInputProps {
  value: string
  onChange: (v: string) => void
  placeholder: string
}

export function SearchInput({ value, onChange, placeholder }: SearchInputProps) {
  return (
    <label className="relative flex items-center max-sm:w-full">
      <svg className="pointer-events-none absolute left-3 text-faint" width="13" height="13" viewBox="0 0 16 16" aria-hidden>
        <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className="h-9 w-64 rounded-full border border-line bg-panel pl-9 pr-4 text-[13px] text-fg outline-none backdrop-blur transition-colors placeholder:text-faint focus:border-signal/60 focus:shadow-[0_0_0_4px_var(--signal-soft)] max-sm:w-full"
      />
    </label>
  )
}
