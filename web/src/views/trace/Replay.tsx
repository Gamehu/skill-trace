import { useEffect, type ReactNode } from 'react'
import type { RunDetail } from '../../../../server/types.ts'
import { SkillMarkdown } from '../../components/Code.tsx'
import { duration } from '../../lib/format.ts'
import { FileChanges } from './Diff.tsx'
import { humanLabel, isHumanItem, jumpTo, type Item } from './items.ts'
import { AskCard, HumanBubble, PlanCard, Say, WorkGroup, YouChip } from './moments.tsx'

interface ReplayProps {
  run: RunDetail
  items: Item[]
  now: number
  live: boolean
  /** During playback, how many process items are revealed; null shows everything. */
  visible: number | null
}

/** Chapter heading on the spine: number, small caps label, serif title. */
function Chapter({ n, label, title, aside }: { n: string; label: string; title: ReactNode; aside?: ReactNode }) {
  return (
    <div className="relative mb-5 grid grid-cols-[20px_minmax(0,1fr)] gap-x-4 sm:grid-cols-[64px_20px_minmax(0,1fr)]">
      <span className="label hidden self-center text-right text-signal sm:block">{n}</span>
      <span className="relative z-10 mt-1.5 grid size-5 place-items-center rounded-full border border-signal bg-bg shadow-[0_0_14px_-2px_var(--signal)]">
        <span className="size-2 rounded-full bg-signal" />
      </span>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div>
          <div className="label">{label}</div>
          <h2 className="display text-[30px] text-fg">{title}</h2>
        </div>
        {aside}
      </div>
    </div>
  )
}

/** One entry on the spine: time offset, node, content. */
function Entry({ id, offset, human, children }: { id: string; offset: string; human?: boolean; children: ReactNode }) {
  return (
    <div id={`item-${id}`} className="rise relative grid scroll-mt-40 grid-cols-[20px_minmax(0,1fr)] gap-x-4 rounded-2xl sm:grid-cols-[64px_20px_minmax(0,1fr)]">
      <span className="tnum hidden pt-3.5 text-right font-mono text-[10.5px] text-faint sm:block">{offset}</span>
      <span className="relative z-10 flex justify-center pt-4">
        <span
          className={`size-2.5 rounded-full ${human ? 'bg-signal shadow-[0_0_12px_var(--signal)]' : 'border border-line-strong bg-bg'}`}
        />
      </span>
      <div className="min-w-0 pb-4">{children}</div>
    </div>
  )
}

function Spine({ children }: { children: ReactNode }) {
  return (
    <div className="relative">
      <span className="absolute bottom-0 left-[9.5px] top-2 w-px bg-gradient-to-b from-signal/60 via-line-strong to-signal/60 sm:left-[93.5px]" />
      {children}
    </div>
  )
}

const STATUS_LINE: Record<RunDetail['status'], (d: string) => ReactNode> = {
  done: (d) => <span className="text-ok">✓ Finished in {d}</span>,
  running: () => <span className="text-signal">● Still working…</span>,
  waiting: () => <span className="text-signal">● Waiting for your reply</span>,
  interrupted: (d) => <span className="text-warn">■ Stopped after {d}</span>,
}

export function Replay({ run, items, now, live, visible }: ReplayProps) {
  const shown = visible === null ? items : items.slice(0, visible)
  const playing = visible !== null
  const off = (t: number) => `+${duration(t - run.startedAt)}`
  const end = live ? Math.max(now, run.endedAt) : run.endedAt
  const showOutput = !playing || visible >= items.length

  // Keep the newest revealed item in view while playing.
  useEffect(() => {
    if (visible === null || visible === 0) return
    const it = items[visible - 1]
    if (it) document.getElementById(`item-${it.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [visible, items])

  return (
    <div className="space-y-14">
      {/* 01 · Input */}
      <section>
        <Chapter n="01" label="Input" title="What you asked" />
        <Spine>
          <Entry id="input" offset="+0" human>
            <div className="glass relative overflow-hidden p-5 pl-6">
              <span className="absolute inset-y-4 left-0 w-[3px] rounded-full bg-signal shadow-[0_0_12px_var(--signal)]" />
              <div className="mb-2 flex items-center gap-2.5">
                <YouChip />
                <span className="label">{run.trigger === 'slash' ? `Typed /${run.skill}` : 'Your request'}</span>
              </div>
              {run.input ? (
                <p className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-[16px] leading-relaxed text-fg">{run.input}</p>
              ) : run.trigger === 'slash' ? (
                <p className="font-mono text-[15px] text-fg">/{run.skill}</p>
              ) : (
                <p className="text-muted">No request text was recorded.</p>
              )}
              {run.args && run.trigger === 'model' && (
                <p className="mt-2 font-mono text-[12px] text-muted">
                  args <span className="text-fg-2">{run.args}</span>
                </p>
              )}
            </div>
          </Entry>
          <Entry id="loaded" offset={off(run.startedAt)}>
            <details className="group rounded-2xl border border-line bg-panel">
              <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 hover:text-fg">
                <span className="inline-block text-faint transition-transform group-open:rotate-90">›</span>
                <span className="text-fg-2">
                  Claude loaded <span className="font-mono text-fg">{run.skill.split(':').pop()}</span>
                  {run.trigger === 'model' && <span className="text-muted"> on its own</span>}
                </span>
                {run.loaded && <span className="label ml-auto text-[9.5px]">View instructions</span>}
              </summary>
              {run.loaded && (
                <div className="max-h-[32rem] overflow-auto border-t border-line px-5 py-4">
                  <SkillMarkdown source={run.loaded} />
                </div>
              )}
            </details>
          </Entry>
        </Spine>
      </section>

      {/* 02 · Process */}
      <section>
        <Chapter
          n="02"
          label="Process"
          title="How it went"
          aside={
            <span className="label text-[10px]">
              {run.toolCalls} tool calls · <span className="text-signal">{run.humanTurns} by you</span>
            </span>
          }
        />
        <Spine>
          {shown.length === 0 && (
            <Entry id="empty" offset="">
              <p className="py-3 text-muted">{live ? 'Waiting for the first step…' : 'The skill answered without taking any steps.'}</p>
            </Entry>
          )}
          {shown.map((it) => (
            <Entry key={it.id} id={it.id} offset={off(it.at)} human={isHumanItem(it)}>
              {it.kind === 'work' && <WorkGroup steps={it.steps} now={now} live={live} defaultOpen={it.steps.length <= 2 || it.steps.some((s) => s.isError)} />}
              {it.kind === 'say' && <Say text={it.text} asks={it.asks} />}
              {it.kind === 'ask' && <AskCard ev={it.ev} live={live || run.status === 'waiting'} />}
              {it.kind === 'plan' && <PlanCard ev={it.ev} live={live || run.status === 'waiting'} />}
              {it.kind === 'human' && <HumanBubble ev={it.ev} />}
            </Entry>
          ))}
        </Spine>
      </section>

      {/* 03 · Output */}
      {showOutput && (
        <section className="rise">
          <Chapter
            n="03"
            label="Output"
            title={run.status === 'waiting' ? 'Waiting on you' : 'What it delivered'}
            aside={<span className="font-mono text-[12px]">{STATUS_LINE[run.status](duration(end - run.startedAt))}</span>}
          />
          <Spine>
            <Entry id="result" offset={off(run.endedAt)} human={run.status === 'waiting'}>
              <div className="glass relative overflow-hidden p-6 sm:p-8">
                <span className="pointer-events-none absolute -right-24 -top-24 size-64 rounded-full bg-signal opacity-[0.07] blur-3xl" />
                <div className="label mb-4 flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-signal shadow-[0_0_8px_var(--signal)]" />
                  {run.status === 'waiting' ? 'Claude’s question' : 'Final reply'}
                </div>
                {run.outcome.text ? (
                  <div className="[&_.prose-skill]:text-[14.5px] [&_.prose-skill]:text-fg">
                    <SkillMarkdown source={run.outcome.text} />
                  </div>
                ) : (
                  <p className="display text-[24px] italic text-fg-2">{live ? 'Not finished yet.' : 'No closing reply was recorded.'}</p>
                )}
              </div>
            </Entry>
            {run.outcome.files.length > 0 && (
              <Entry id="files" offset="">
                <div className="label mb-2 flex items-center justify-between">
                  <span>Files it produced</span>
                  <span className="tnum font-mono normal-case tracking-normal">
                    <span className="text-ok">+{run.outcome.files.reduce((n, f) => n + f.additions, 0)}</span>{' '}
                    <span className="text-err">−{run.outcome.files.reduce((n, f) => n + f.deletions, 0)}</span>
                  </span>
                </div>
                <FileChanges files={run.outcome.files} />
              </Entry>
            )}
          </Spine>
        </section>
      )}
    </div>
  )
}

/** Sticky side rail summarizing the run: request, the person's decisions, and the output. */
export function Glance({ run, items }: { run: RunDetail; items: Item[] }) {
  const moments = items.filter(isHumanItem)
  return (
    <div className="space-y-4">
      <div className="glass p-5">
        <div className="label mb-2">Input</div>
        <button onClick={() => jumpTo('input')} className="line-clamp-3 text-left text-fg-2 hover:text-fg">
          {run.input ?? run.prompt ?? `/${run.skill}`}
        </button>
      </div>
      <div className="glass p-5">
        <div className="label mb-3 flex justify-between">
          <span>Your decisions</span>
          <span className="tnum text-signal">{moments.length}</span>
        </div>
        {moments.length === 0 ? (
          <p className="text-muted">The skill ran without asking you anything.</p>
        ) : (
          <ol className="space-y-1">
            {moments.map((m, i) => (
              <li key={m.id}>
                <button onClick={() => jumpTo(m.id)} className="group -mx-2 flex w-[calc(100%+1rem)] items-start gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-hover">
                  <span className="tnum mt-[3px] font-mono text-[10px] text-signal">{String(i + 1).padStart(2, '0')}</span>
                  <span className="min-w-0 flex-1 text-[12.5px] text-fg-2 group-hover:text-fg">{humanLabel(m)}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="glass p-5">
        <div className="label mb-2">Output</div>
        <button onClick={() => jumpTo('result')} className="line-clamp-4 text-left text-fg-2 hover:text-fg">
          {run.result ?? 'No closing reply.'}
        </button>
        {run.outcome.files.length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-line pt-3">
            {run.outcome.files.map((f) => (
              <li key={f.path}>
                <button onClick={() => jumpTo('files')} className="flex w-full items-center gap-2 text-left hover:text-fg">
                  <span className={`font-mono text-[9.5px] uppercase ${f.op === 'create' ? 'text-ok' : 'text-muted'}`}>{f.op === 'create' ? 'new' : 'edit'}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-fg-2">{f.path}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
