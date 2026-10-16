import { scaleLinear } from 'd3-scale'
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { Link } from 'wouter'
import type { RunDetail, TraceEvent } from '../../../server/types.ts'
import { CodeBlock, SkillMarkdown } from '../components/Code.tsx'
import { Empty, KindDot, PageHeader, SectionTitle, Stats, StatusLabel } from '../components/ui.tsx'
import { useApi, useNow } from '../lib/api.ts'
import { compact, dateTime, duration, shortId } from '../lib/format.ts'
import { KINDS, kindColor } from '../lib/kinds.ts'

type Row = Exclude<TraceEvent, { type: 'thinking' }>
type ToolRow = Extract<TraceEvent, { type: 'tool' }>

export function TraceView({ id }: { id: string }) {
  const { data: run, error } = useApi<RunDetail>(`/api/runs/${id}`)
  const live = run?.status === 'running'
  const now = useNow(live, 500)
  const [selected, setSelected] = useState<string | null>(null)

  if (error) return <Empty title="Run not found.">The transcript may have been deleted.</Empty>
  if (!run) return null

  const end = live ? Math.max(now, run.endedAt) : run.endedAt
  const rows = run.events.filter((e): e is Row => e.type !== 'thinking')
  const thinking = run.events.length - rows.length
  const sel = rows.find((r) => r.id === selected) ?? null

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2.5">
            <Link href="/runs" className="font-normal text-muted hover:text-fg-2">
              Runs
            </Link>
            <span className="font-normal text-faint">/</span>
            {run.skillId ? (
              <Link href={`/skills/${run.skillId}`} className="font-mono hover:underline hover:decoration-line-strong hover:underline-offset-4">
                {run.skill}
              </Link>
            ) : (
              <span className="font-mono">{run.skill}</span>
            )}
          </span>
        }
        meta={
          <>
            <StatusLabel status={run.status} errors={run.errors} />
            <span>{run.project}</span>
            <span>{run.trigger === 'slash' ? 'Invoked by /command' : 'Invoked by Claude'}</span>
            {run.model && <span className="font-mono text-[11.5px]">{run.model}</span>}
            <span className="tnum">{dateTime(run.startedAt)}</span>
            <span className="font-mono text-[11.5px]" title={run.sessionId}>
              session {shortId(run.sessionId)}
            </span>
          </>
        }
      />

      {(run.prompt || run.args) && (
        <div className="border-b border-line px-6 py-4 sm:px-8">
          {run.prompt && <p className="max-w-4xl whitespace-pre-wrap text-fg-2">{run.prompt}</p>}
          {run.args && run.trigger === 'model' && (
            <p className="mt-1 font-mono text-[12px] text-muted">
              args <span className="text-fg-2">{run.args}</span>
            </p>
          )}
        </div>
      )}

      <Stats
        items={[
          { label: 'Duration', value: duration(end - run.startedAt) },
          { label: 'Tool calls', value: run.toolCalls },
          { label: 'Errors', value: <span className={run.errors ? 'text-err' : ''}>{run.errors}</span> },
          { label: 'Output tokens', value: compact(run.tokens.output) },
          {
            label: 'Input tokens',
            value: compact(run.tokens.input + run.tokens.cacheRead + run.tokens.cacheWrite),
            hint: `${run.tokens.input.toLocaleString()} new · ${run.tokens.cacheRead.toLocaleString()} cache read · ${run.tokens.cacheWrite.toLocaleString()} cache write`,
          },
        ]}
      />

      <div className="grid xl:grid-cols-[minmax(0,1fr)_400px]">
        <section className="min-w-0 py-5 xl:border-r xl:border-line">
          <div className="px-6 sm:px-8">
            <SectionTitle aside={thinking > 0 && `${thinking} thinking block${thinking > 1 ? 's' : ''} not shown`}>
              <Legend rows={rows} />
            </SectionTitle>
          </div>
          {rows.length === 0 ? (
            <p className="px-6 text-muted sm:px-8">{live ? 'Waiting for the first step…' : 'This run made no tool calls.'}</p>
          ) : (
            <Waterfall rows={rows} start={run.startedAt} end={end} now={now} live={live} selected={selected} onSelect={setSelected} />
          )}
        </section>
        <aside className="min-w-0 border-line max-xl:border-t xl:sticky xl:top-0 xl:max-h-dvh xl:overflow-y-auto">
          <Inspector row={sel} runStart={run.startedAt} now={now} />
        </aside>
      </div>

      {run.loaded && (
        <details className="group border-t border-line">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-6 py-4 text-[12px] font-medium text-fg-2 hover:text-fg sm:px-8">
            <span className="inline-block text-faint transition-transform group-open:rotate-90">›</span>
            Skill instructions as loaded into the conversation
          </summary>
          <div className="max-w-3xl px-6 pb-8 sm:px-8">
            <SkillMarkdown source={run.loaded} />
          </div>
        </details>
      )}
    </>
  )
}

function Legend({ rows }: { rows: Row[] }) {
  const present = new Set(rows.flatMap((r) => (r.type === 'tool' ? [r.kind] : [])))
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <span>Timeline</span>
      {KINDS.filter((k) => present.has(k.kind)).map((k) => (
        <span key={k.kind} className="inline-flex items-center gap-1.5 font-normal text-muted">
          <KindDot kind={k.kind} />
          {k.label}
        </span>
      ))}
      {rows.some((r) => r.type === 'text') && (
        <span className="inline-flex items-center gap-1.5 font-normal text-muted">
          <span className="size-2 rounded-full border border-fg-2" />
          Reply
        </span>
      )}
    </span>
  )
}

function Waterfall({
  rows,
  start,
  end,
  now,
  live,
  selected,
  onSelect,
}: {
  rows: Row[]
  start: number
  end: number
  now: number
  live: boolean
  selected: string | null
  onSelect: (id: string | null) => void
}) {
  const total = Math.max(1, end - start)
  const x = useMemo(() => scaleLinear().domain([0, total]).range([0, 100]), [total])
  // Ticks on round durations, dropping any that would crowd the right edge.
  const step = TICK_STEPS.find((s) => total / s <= 6) ?? TICK_STEPS[TICK_STEPS.length - 1]
  const ticks = Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step).filter((t) => x(t) <= 90)
  const [tip, setTip] = useState<{ x: number; y: number; row: ToolRow } | null>(null)
  const wrap = useRef<HTMLDivElement>(null)

  // Rows that arrive while watching a live run get a brief highlight.
  const seen = useRef<Set<string> | null>(null)
  const fresh = new Set<string>()
  if (seen.current) for (const r of rows) if (!seen.current.has(r.id)) fresh.add(r.id)
  useEffect(() => {
    seen.current = new Set(rows.map((r) => r.id))
  }, [rows])

  const move = (e: MouseEvent, row: ToolRow) => {
    const box = wrap.current?.getBoundingClientRect()
    if (box) setTip({ x: e.clientX - box.left, y: e.clientY - box.top, row })
  }

  return (
    <div ref={wrap} className="relative overflow-x-auto" onMouseLeave={() => setTip(null)}>
      <div className="min-w-[640px] [--label:260px] 2xl:[--label:320px]">
        {/* axis */}
        <div className="grid grid-cols-[var(--label)_minmax(0,1fr)_72px] border-b border-line text-[11px] text-faint">
          <div className="py-1.5 pl-6 sm:pl-8">Step</div>
          <div className="relative h-full">
            {ticks.map((t) => (
              <span key={t} className="tnum absolute top-1.5 -translate-x-1/2 first:translate-x-0" style={{ left: `${x(t)}%` }}>
                {tickLabel(t)}
              </span>
            ))}
          </div>
          <div className="py-1.5 pr-6 text-right sm:pr-8">Time</div>
        </div>

        <div className="relative">
          {/* gridlines */}
          <div className="pointer-events-none absolute inset-y-0 left-[var(--label)] right-[72px]">
            {ticks.map((t) => (
              <span key={t} className="absolute inset-y-0 w-px bg-line opacity-60" style={{ left: `${x(t)}%` }} />
            ))}
          </div>

          {rows.map((r) => {
            const isSel = selected === r.id
            const base = `relative grid h-8 w-full cursor-pointer grid-cols-[var(--label)_minmax(0,1fr)_72px] items-center text-left ${
              isSel ? 'bg-raised' : 'hover:bg-hover'
            } ${fresh.has(r.id) ? 'row-new' : ''}`
            if (r.type === 'text') {
              return (
                <button key={r.id} className={base} onClick={() => onSelect(isSel ? null : r.id)}>
                  <span className="flex min-w-0 items-center gap-2 pl-6 pr-3 sm:pl-8">
                    <span className="size-2 shrink-0 rounded-full border border-fg-2" />
                    <span className="truncate text-muted">{r.text.split('\n')[0]}</span>
                  </span>
                  <span className="relative h-full">
                    <span
                      className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-fg-2 bg-bg"
                      style={{ left: `${x(r.at - start)}%` }}
                    />
                  </span>
                  <span />
                </button>
              )
            }
            const open = r.end === null
            const d = (open ? (live ? now : end) : r.end!) - r.start
            const left = x(r.start - start)
            const width = Math.max(x(d) - x(0), 0)
            return (
              <button key={r.id} className={base} onClick={() => onSelect(isSel ? null : r.id)}>
                <span className="flex min-w-0 items-center gap-2 pl-6 pr-3 sm:pl-8">
                  <KindDot kind={r.kind} />
                  <span className="shrink-0 font-mono text-[12px] text-fg">{shortTool(r.name)}</span>
                  <span className="truncate text-muted">{r.summary}</span>
                  {r.isError && <span className="shrink-0 text-[11px] text-err">error</span>}
                </span>
                <span className="relative h-full" onMouseMove={(e) => move(e, r)} onMouseLeave={() => setTip(null)}>
                  <span
                    className={`absolute top-1/2 h-3 -translate-y-1/2 rounded-[3px] ${open && live ? 'bar-live' : ''}`}
                    style={{
                      left: `${left}%`,
                      width: `max(3px, ${width}%)`,
                      background: r.isError ? 'var(--err)' : kindColor(r.kind),
                      opacity: open && !live ? 0.4 : 1,
                    }}
                  />
                </span>
                <span className={`tnum pr-6 text-right text-[12px] sm:pr-8 ${r.isError ? 'text-err' : 'text-fg-2'}`}>
                  {open && !live ? '—' : duration(d)}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {tip && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-line-strong bg-raised px-2.5 py-1.5 text-[12px] shadow-lg shadow-black/20"
          style={{ left: Math.min(tip.x + 12, (wrap.current?.clientWidth ?? 0) - 220), top: tip.y + 14 }}
        >
          <div className="flex items-center gap-1.5 font-mono text-fg">
            <KindDot kind={tip.row.kind} />
            {tip.row.name}
          </div>
          <div className="tnum mt-0.5 text-muted">
            at +{duration(tip.row.start - start)} · took{' '}
            <span className="text-fg-2">{tip.row.end === null ? 'still running' : duration(tip.row.end - tip.row.start)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function tickLabel(t: number) {
  if (t === 0) return '0'
  if (t % 3600e3 === 0) return `${t / 3600e3}h`
  if (t % 60e3 === 0) return `${t / 60e3}m`
  if (t >= 60e3) return `${Math.floor(t / 60e3)}m ${(t % 60e3) / 1e3}s`
  return `${t / 1e3}s`
}

const TICK_STEPS = [
  100, 200, 500, 1e3, 2e3, 5e3, 10e3, 15e3, 30e3, 60e3, 120e3, 300e3, 600e3, 900e3, 1800e3, 3600e3, 7200e3, 21600e3,
]

// mcp__server__tool → server · tool
function shortTool(name: string) {
  if (!name.startsWith('mcp__')) return name
  const [, server, ...tool] = name.split('__')
  return `${server} · ${tool.join('__')}`
}

function Inspector({ row, runStart, now }: { row: Row | null; runStart: number; now: number }) {
  if (!row)
    return (
      <div className="px-6 py-5 text-muted sm:px-8 xl:px-6">
        <SectionTitle>Inspector</SectionTitle>
        Select a step to see its input and output.
      </div>
    )

  if (row.type === 'text')
    return (
      <div className="px-6 py-5 sm:px-8 xl:px-6">
        <SectionTitle aside={<span className="tnum">+{duration(row.at - runStart)}</span>}>Reply</SectionTitle>
        <SkillMarkdown source={row.text} />
      </div>
    )

  const took = (row.end ?? now) - row.start
  return (
    <div className="px-6 py-5 sm:px-8 xl:px-6">
      <div className="mb-1 flex items-center gap-2">
        <KindDot kind={row.kind} />
        <span className="break-all font-mono text-[13px] font-medium text-fg">{row.name}</span>
      </div>
      {row.summary && <p className="mb-4 break-words text-fg-2">{row.summary}</p>}
      <dl className="tnum mb-5 grid grid-cols-3 gap-3 border-y border-line py-3 text-[12px]">
        <div>
          <dt className="text-muted">Started</dt>
          <dd className="text-fg-2">+{duration(row.start - runStart)}</dd>
        </div>
        <div>
          <dt className="text-muted">Took</dt>
          <dd className="text-fg-2">{row.end === null ? 'running' : duration(took)}</dd>
        </div>
        <div>
          <dt className="text-muted">Result</dt>
          <dd className={row.isError ? 'text-err' : 'text-fg-2'}>{row.end === null ? '—' : row.isError ? '✕ Error' : '✓ OK'}</dd>
        </div>
      </dl>
      <SectionTitle>Input</SectionTitle>
      <div className="mb-5 max-h-80 overflow-auto rounded-md border border-line bg-panel p-3">
        <CodeBlock code={row.input} lang="json" wrap />
      </div>
      <SectionTitle>Output</SectionTitle>
      <div className="max-h-[28rem] overflow-auto rounded-md border border-line bg-panel p-3">
        {row.output === null ? (
          <p className="text-muted">No result yet.</p>
        ) : (
          <pre className={`whitespace-pre-wrap break-words font-mono text-[12px] leading-[1.6] ${row.isError ? 'text-err' : 'text-fg-2'}`}>
            {row.output || '(empty)'}
          </pre>
        )}
      </div>
    </div>
  )
}
