import { useState, type ReactNode } from 'react'
import { CodeBlock, SkillMarkdown } from '../../components/Code.tsx'
import { KindDot } from '../../components/ui.tsx'
import { duration } from '../../lib/format.ts'
import { kindColor } from '../../lib/kinds.ts'
import { isDeclined, readAnswer, shortTool, type AskRow, type HumanRow, type PlanRow, type ToolRow } from './items.ts'

/** "You" marker used on every moment the person took part in. */
export function YouChip() {
  return (
    <span className="inline-flex h-5 items-center gap-1.5 rounded-full bg-signal px-2 font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-bg shadow-[0_0_14px_-2px_var(--signal)]">
      You
    </span>
  )
}

function Waiting({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 font-mono text-[11.5px] text-signal">
      <span className="relative flex size-2">
        <span className="absolute inset-0 motion-safe:animate-ping rounded-full bg-signal" />
        <span className="relative size-2 rounded-full bg-signal" />
      </span>
      {children}
    </span>
  )
}

/** Card frame for a person's moment: warm rail on the left, "You" header. */
function MomentCard({ title, aside, children }: { title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-signal/30 bg-[linear-gradient(135deg,var(--signal-soft),transparent_60%)] p-5 pl-6">
      <span className="absolute inset-y-4 left-0 w-[3px] rounded-full bg-signal shadow-[0_0_12px_var(--signal)]" />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <YouChip />
          <span className="label text-fg-2">{title}</span>
        </div>
        {aside}
      </div>
      {children}
    </div>
  )
}

export function AskCard({ ev, live, agentName }: { ev: AskRow; live: boolean; agentName: string }) {
  const waited = ev.answeredAt !== null ? duration(ev.answeredAt - ev.at) : null
  return (
    <MomentCard
      title={`${agentName} asked you`}
      aside={
        ev.answeredAt === null ? (
          live ? <Waiting>Waiting for your answer</Waiting> : <span className="label">Never answered</span>
        ) : (
          <span className="tnum font-mono text-[11px] text-muted">answered in {waited}</span>
        )
      }
    >
      <div className="space-y-5">
        {ev.questions.map((q) => {
          const { picked, custom } = readAnswer(ev.answers?.[q.question], q.options.map((o) => o.label))
          return (
            <div key={q.question}>
              {q.header && <div className="label mb-1 text-[9.5px]">{q.header}</div>}
              <p className="display text-[23px] leading-snug text-fg">{q.question}</p>
              <ul className="mt-3 grid gap-1.5">
                {q.options.map((o) => {
                  const on = picked.has(o.label)
                  return (
                    <li
                      key={o.label}
                      className={`flex items-start gap-3 rounded-xl border px-3.5 py-2.5 transition-colors ${
                        on ? 'border-signal bg-signal-soft shadow-[0_0_24px_-10px_var(--signal)]' : 'border-line opacity-60'
                      }`}
                    >
                      <span
                        className={`mt-[3px] grid size-3.5 shrink-0 place-items-center border ${q.multiSelect ? 'rounded-[4px]' : 'rounded-full'} ${
                          on ? 'border-signal bg-signal' : 'border-line-strong'
                        }`}
                      >
                        {on && <span className={`size-1.5 bg-bg ${q.multiSelect ? 'rounded-[1px]' : 'rounded-full'}`} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={on ? 'font-medium text-fg' : 'text-fg-2'}>{o.label}</span>
                        {o.description && <span className="mt-0.5 block text-[12px] text-muted">{o.description}</span>}
                      </span>
                      {on && <span className="label shrink-0 pt-0.5 text-[9.5px] text-signal">Your choice</span>}
                    </li>
                  )
                })}
              </ul>
              {custom && (
                <div className="mt-2 flex items-start gap-3 rounded-xl border border-signal bg-signal-soft px-3.5 py-2.5">
                  <span className="mt-0.5 text-signal" aria-hidden>
                    ✎
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="label block text-[9.5px] text-signal">You wrote your own answer</span>
                    <span className="mt-0.5 block text-[14px] text-fg">{custom}</span>
                  </span>
                </div>
              )}
            </div>
          )
        })}
        {ev.declined && <p className="text-muted">You dismissed the question without answering.</p>}
      </div>
    </MomentCard>
  )
}

export function PlanCard({ ev, live }: { ev: PlanRow; live: boolean }) {
  const [open, setOpen] = useState(false)
  const verdict =
    ev.approved === null ? (
      live ? <Waiting>Waiting for your approval</Waiting> : <span className="label">No decision recorded</span>
    ) : ev.approved ? (
      <span className="font-mono text-[11.5px] text-ok">✓ You approved</span>
    ) : (
      <span className="font-mono text-[11.5px] text-signal">↩ You sent it back</span>
    )
  return (
    <MomentCard title="Plan for your approval" aside={verdict}>
      <div className={`relative overflow-hidden rounded-xl border border-line bg-panel-solid px-4 py-3 ${open ? '' : 'max-h-40'}`}>
        <SkillMarkdown source={ev.plan} />
        {!open && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[var(--panel-solid)] to-transparent" />}
      </div>
      <button onClick={() => setOpen(!open)} className="label mt-2 hover:text-fg">
        {open ? 'Collapse plan' : 'Read the full plan'}
      </button>
      {ev.feedback && (
        <blockquote className="mt-3 border-l-2 border-signal pl-3 text-[14px] text-fg">
          <span className="label mb-0.5 block text-[9.5px] text-signal">Your feedback</span>
          {ev.feedback}
        </blockquote>
      )}
    </MomentCard>
  )
}

const HUMAN_TITLE: Record<HumanRow['kind'], string> = {
  reply: 'You replied',
  steer: 'You added while it worked',
  interrupt: 'You interrupted',
  reject: 'You declined',
}

export function HumanBubble({ ev }: { ev: HumanRow }) {
  if (ev.kind === 'interrupt')
    return (
      <div className="flex items-center gap-3 py-1">
        <YouChip />
        <span className="label text-signal">Interrupted with Esc</span>
        <span className="h-px flex-1 bg-[repeating-linear-gradient(90deg,var(--signal)_0_6px,transparent_6px_12px)] opacity-60" />
      </div>
    )
  return (
    <div className="flex items-start gap-3">
      <div className="pt-1">
        <YouChip />
      </div>
      <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md border border-signal/35 bg-signal-soft px-4 py-3">
        <div className="label mb-1 text-[9.5px] text-signal">
          {HUMAN_TITLE[ev.kind]}
          {ev.kind === 'reject' && ev.tool && <span className="text-fg-2"> · {shortTool(ev.tool)}</span>}
        </div>
        {ev.text ? (
          <p className="whitespace-pre-wrap break-words text-[14.5px] leading-relaxed text-fg">{ev.text}</p>
        ) : (
          <p className="text-muted">{ev.kind === 'reject' ? 'Declined at the permission prompt, no reason given.' : '—'}</p>
        )}
      </div>
    </div>
  )
}

/** Agent narration; a question the person answered gets a quiet frame. */
export function Say({ text, asks, agentName }: { text: string; asks: boolean; agentName: string }) {
  return (
    <div className={asks ? 'rounded-2xl border border-line-strong bg-panel px-4 py-3' : ''}>
      <div className="label mb-1 flex items-center gap-2 text-[9.5px]">
        <span className="size-1.5 rounded-full bg-fg-2" />
        {asks ? `${agentName} asked` : agentName}
      </div>
      <div className={asks ? 'text-[14.5px] [&_.prose-skill]:text-fg' : '[&_.prose-skill]:text-[13px]'}>
        <SkillMarkdown source={text} />
      </div>
    </div>
  )
}

export function StepDetail({ step, stacked = false }: { step: ToolRow; stacked?: boolean }) {
  return (
    <div className={`grid gap-3 py-3 ${stacked ? '' : 'lg:grid-cols-2'}`}>
      <div className="min-w-0">
        <div className="label mb-1.5 text-[9.5px]">Input</div>
        <div className="max-h-72 overflow-auto rounded-xl border border-line bg-panel-solid p-3">
          <CodeBlock code={step.input} lang="json" wrap />
        </div>
      </div>
      <div className="min-w-0">
        <div className="label mb-1.5 text-[9.5px]">Output</div>
        <div className="max-h-72 overflow-auto rounded-xl border border-line bg-panel-solid p-3">
          {step.output === null ? (
            <p className="text-muted">No result yet.</p>
          ) : (
            <pre className={`whitespace-pre-wrap break-words font-mono text-[12px] leading-[1.6] ${step.isError && !isDeclined(step) ? 'text-err' : 'text-fg-2'}`}>
              {step.output || '(empty)'}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}

/** A run of consecutive tool calls, folded into one line until opened. */
export function WorkGroup({ steps, now, live, defaultOpen }: { steps: ToolRow[]; now: number; live: boolean; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const [detail, setDetail] = useState<string | null>(null)
  const first = steps[0].start
  const last = steps[steps.length - 1]
  const end = last.end ?? (live ? now : last.start)
  const errors = steps.filter((s) => s.isError && !isDeclined(s)).length
  const counts = new Map<string, number>()
  for (const s of steps) counts.set(shortTool(s.name), (counts.get(shortTool(s.name)) ?? 0) + 1)
  const running = live && steps.some((s) => s.end === null)

  return (
    <div className="rounded-2xl border border-line bg-panel">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-hover" aria-expanded={open}>
        <span className={`inline-block text-faint transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
        <span className="flex shrink-0 -space-x-0.5">
          {steps.slice(0, 8).map((s) => (
            <KindDot key={s.id} kind={s.kind} className="ring-2 ring-[var(--bg)]" />
          ))}
        </span>
        <span className="text-fg">
          {running ? 'Working' : 'Worked'} <span className="tnum font-mono text-fg-2">{duration(end - first)}</span>
        </span>
        <span className="min-w-0 flex-1 truncate text-muted">
          {[...counts].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(' · ')}
        </span>
        {errors > 0 && <span className="label shrink-0 text-[9.5px] text-err">✕ {errors} failed</span>}
        <span className="label shrink-0 text-[9.5px]">
          {steps.length} step{steps.length > 1 ? 's' : ''}
        </span>
      </button>
      {open && (
        <ul className="border-t border-line px-2 py-1">
          {steps.map((s) => {
            const declined = isDeclined(s)
            const isOpen = detail === s.id
            return (
              <li key={s.id} className="border-b border-line/60 last:border-0">
                <button
                  onClick={() => setDetail(isOpen ? null : s.id)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-hover ${isOpen ? 'bg-raised' : ''}`}
                >
                  <KindDot kind={s.kind} />
                  <span className="shrink-0 font-mono text-[12px] text-fg">{shortTool(s.name)}</span>
                  <span className="min-w-0 flex-1 truncate text-muted">{s.summary}</span>
                  {declined ? (
                    <span className="label shrink-0 text-[9.5px] text-signal">declined by you</span>
                  ) : s.isError ? (
                    <span className="label shrink-0 text-[9.5px] text-err">✕ error</span>
                  ) : null}
                  <span
                    className={`tnum w-16 shrink-0 text-right font-mono text-[11.5px] ${s.end === null && live ? 'text-signal' : 'text-fg-2'}`}
                    style={s.end === null && live ? undefined : { color: s.isError && !declined ? 'var(--err)' : undefined }}
                  >
                    {s.end === null ? (live ? duration(now - s.start) : '—') : duration(s.end - s.start)}
                  </span>
                  <span className="h-1 w-10 shrink-0 overflow-hidden rounded-full bg-raised" aria-hidden>
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${Math.min(100, Math.max(6, (((s.end ?? now) - s.start) / Math.max(1, end - first)) * 100))}%`,
                        background: kindColor(s.kind),
                      }}
                    />
                  </span>
                </button>
                {isOpen && (
                  <div className="px-2">
                    <StepDetail step={s} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
