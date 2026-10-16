import { scaleLinear } from 'd3-scale'
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { Link } from 'wouter'
import type { RunDetail, TraceEvent } from '../../../server/types.ts'
import { CodeBlock, SkillMarkdown } from '../components/Code.tsx'
import { Shape } from '../components/Shape.tsx'
import { Empty, KindDot, Metric, PageHeader, SectionTitle, StatusPill } from '../components/ui.tsx'
import { useApi, useNow } from '../lib/api.ts'
import { compact, dateTime, duration, shortId } from '../lib/format.ts'
import { KINDS, kindColor } from '../lib/kinds.ts'

type Row = Exclude<TraceEvent, { type: 'thinking' }>
type ToolRow = Extract<TraceEvent, { type: 'tool' }>

/** Candidate tick spacings in ms; the first giving at most six ticks wins. */
const TICK_STEPS = [100, 200, 500, 1e3, 2e3, 5e3, 10e3, 15e3, 30e3, 60e3, 120e3, 300e3, 600e3, 900e3, 1800e3, 3600e3, 7200e3, 21600e3]

function tickLabel(t: number) {
  if (t === 0) return '0'
  if (t % 3600e3 === 0) return `${t / 3600e3}h`
  if (t % 60e3 === 0) return `${t / 60e3}m`
  if (t >= 60e3) return `${Math.floor(t / 60e3)}m ${(t % 60e3) / 1e3}s`
  return `${t / 1e3}s`
}

// mcp__server__tool → server · tool
function shortTool(name: string) {
  if (!name.startsWith('mcp__')) return name
  const [, server, ...tool] = name.split('__')
  return `${server} · ${tool.join('__')}`
}

export function TraceView({ id }: { id: string }) {
  const { data: run, error } = useApi<RunDetail>(`/api/runs/${id}`)
  const live = run?.status === 'running'
  const now = useNow(live, 250)
  const [selected, setSelected] = useState<string | null>(null)

  if (error) return <Empty title="Run not found.">The transcript may have been deleted.</Empty>
  if (!run) return null

  const end = live ? Math.max(now, run.endedAt) : run.endedAt
  const rows = run.events.filter((e): e is Row => e.type !== 'thinking')
  const thinking = run.events.length - rows.length
  const sel = rows.find((r) => r.id === selected) ?? null
  const tokensIn = run.tokens.input + run.tokens.cacheRead + run.tokens.cacheWrite

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href="/runs" className="hover:text-fg">
              Runs
            </Link>
            <span className="text-faint">/</span>
            {run.skillId ? (
              <Link href={`/skills/${run.skillId}`} className="hover:text-fg">
                {run.skill}
              </Link>
            ) : (
              <span>{run.skill}</span>
            )}
            <span className="text-faint">/</span>
            <span>{shortId(run.id)}</span>
          </>
        }
        title={run.skill.split(':').pop()}
        meta={
          <>
            <StatusPill status={run.status} errors={run.errors} />
            <span>{run.project}</span>
            <span className="text-muted">{run.trigger === 'slash' ? 'via /command' : 'invoked by Claude'}</span>
            {run.model && <span className="font-mono text-[11.5px] text-muted">{run.model}</span>}
            <span className="tnum text-muted">{dateTime(run.startedAt)}</span>
            <span className="font-mono text-[11.5px] text-faint" title={run.sessionId}>
              session {shortId(run.sessionId)}
            </span>
          </>
        }
      />

      <div className="space-y-4 px-6 sm:px-10">
        {(run.prompt || run.args) && (
          <div className="glass rise relative overflow-hidden p-5 pl-6" style={{ ['--i' as string]: 1 }}>
            <span className="absolute inset-y-4 left-0 w-[2px] rounded-full bg-signal shadow-[0_0_12px_var(--signal)]" />
            <div className="label mb-2">Prompt</div>
            {run.prompt && <p className="max-w-4xl whitespace-pre-wrap text-[15px] leading-relaxed text-fg">{run.prompt}</p>}
            {run.args && run.trigger === 'model' && (
              <p className="mt-2 font-mono text-[12px] text-muted">
                args <span className="text-fg-2">{run.args}</span>
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <Metric index={2} label="Duration" value={<span className={live ? 'text-signal' : ''}>{duration(end - run.startedAt)}</span>} />
          <Metric index={3} label="Tool calls" value={run.toolCalls} hint={thinking ? `${thinking} thinking blocks` : undefined} />
          <Metric index={4} label="Errors" value={<span className={run.errors ? 'text-err' : ''}>{run.errors}</span>} />
          <Metric index={5} label="Output tokens" value={compact(run.tokens.output)} />
          <Metric
            index={6}
            label="Input tokens"
            value={compact(tokensIn)}
            hint={`${compact(run.tokens.cacheRead)} from cache`}
          />
        </div>

        {rows.length > 0 && (
          <div className="glass rise p-5" style={{ ['--i' as string]: 7 }}>
            <SectionTitle aside={<Legend rows={rows} />}>Signal</SectionTitle>
            <Shape run={run} now={now} width={1200} height={40} fluid />
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <section className="glass rise min-w-0 overflow-hidden pt-5" style={{ ['--i' as string]: 8 }}>
            <div className="px-6">
              <SectionTitle aside={<span className="tnum font-mono">{rows.length} steps</span>}>Timeline</SectionTitle>
            </div>
            {rows.length === 0 ? (
              <p className="px-6 pb-6 text-muted">{live ? 'Waiting for the first step…' : 'This run made no tool calls.'}</p>
            ) : (
              <Waterfall rows={rows} start={run.startedAt} end={end} now={now} live={live} selected={selected} onSelect={setSelected} />
            )}
          </section>
          <aside className="glass rise min-w-0 self-start xl:sticky xl:top-4 xl:max-h-[calc(100dvh-2rem)] xl:overflow-y-auto" style={{ ['--i' as string]: 9 }}>
            <Inspector row={sel} runStart={run.startedAt} now={now} />
          </aside>
        </div>

        {run.loaded && (
          <details className="glass group">
            <summary className="flex cursor-pointer list-none items-center gap-3 px-6 py-5 hover:text-fg">
              <span className="inline-block text-signal transition-transform group-open:rotate-90">›</span>
              <span className="label text-fg-2">Instructions as loaded into the conversation</span>
            </summary>
            <div className="max-w-3xl px-6 pb-8">
              <SkillMarkdown source={run.loaded} />
            </div>
          </details>
        )}
      </div>
    </>
  )
}

function Legend({ rows }: { rows: Row[] }) {
  const present = new Set(rows.flatMap((r) => (r.type === 'tool' ? [r.kind] : [])))
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {KINDS.filter((k) => present.has(k.kind)).map((k) => (
        <span key={k.kind} className="inline-flex items-center gap-1.5">
          <KindDot kind={k.kind} />
          {k.label}
        </span>
      ))}
      {rows.some((r) => r.type === 'text') && (
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full border border-fg-2" />
          Reply
        </span>
      )}
    </span>
  )
}

interface WaterfallProps {
  rows: Row[]
  start: number
  end: number
  now: number
  live: boolean
  selected: string | null
  onSelect: (id: string | null) => void
}

function Waterfall({ rows, start, end, now, live, selected, onSelect }: WaterfallProps) {
  const total = Math.max(1, end - start)
  const x = useMemo(() => scaleLinear().domain([0, total]).range([0, 100]), [total])
  const step = TICK_STEPS.find((s) => total / s <= 6) ?? TICK_STEPS[TICK_STEPS.length - 1]
  // Drop ticks that would crowd the right edge.
  const ticks = Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step).filter((t) => x(t) <= 90)
  const [tip, setTip] = useState<{ x: number; y: number; row: ToolRow } | null>(null)
  const [cursor, setCursor] = useState<number | null>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)

  // Rows that arrive while watching a live run get a brief highlight.
  const seen = useRef<Set<string> | null>(null)
  const fresh = new Set<string>()
  if (seen.current) for (const r of rows) if (!seen.current.has(r.id)) fresh.add(r.id)
  useEffect(() => {
    seen.current = new Set(rows.map((r) => r.id))
  }, [rows])

  const onMove = (e: MouseEvent) => {
    const box = track.current?.getBoundingClientRect()
    if (!box) return
    const f = (e.clientX - box.left) / box.width
    setCursor(f >= 0 && f <= 1 ? f : null)
  }
  const onBar = (e: MouseEvent, row: ToolRow) => {
    const box = wrap.current?.getBoundingClientRect()
    if (box) setTip({ x: e.clientX - box.left, y: e.clientY - box.top, row })
  }

  return (
    <div
      ref={wrap}
      className="relative overflow-x-auto pb-2"
      onMouseMove={onMove}
      onMouseLeave={() => {
        setTip(null)
        setCursor(null)
      }}
    >
      <div className="relative min-w-[680px] [--label:250px] 2xl:[--label:300px]">
        {/* Axis */}
        <div className="grid grid-cols-[var(--label)_minmax(0,1fr)_76px] border-y border-line">
          <div className="label py-2 pl-6">Step</div>
          <div className="relative">
            {ticks.map((t) => (
              <span key={t} className="label tnum absolute top-2 -translate-x-1/2 first:translate-x-0" style={{ left: `${x(t)}%` }}>
                {tickLabel(t)}
              </span>
            ))}
            {cursor !== null && (
              <span className="tnum absolute top-1 z-10 -translate-x-1/2 rounded-md bg-fg px-1.5 py-0.5 font-mono text-[10.5px] text-bg" style={{ left: `${cursor * 100}%` }}>
                +{duration(cursor * total)}
              </span>
            )}
          </div>
          <div className="label py-2 pr-6 text-right">Took</div>
        </div>

        <div className="relative">
          {/* Gridlines, crosshair and live playhead share the track's coordinate space. */}
          <div ref={track} className="pointer-events-none absolute inset-y-0 left-[var(--label)] right-[76px]">
            {ticks.map((t) => (
              <span key={t} className="absolute inset-y-0 border-l border-dashed border-line" style={{ left: `${x(t)}%` }} />
            ))}
            {cursor !== null && <span className="absolute inset-y-0 z-10 w-px bg-fg/50" style={{ left: `${cursor * 100}%` }} />}
            {live && (
              <span className="absolute inset-y-0 right-0 z-10 w-[2px] bg-signal shadow-[0_0_14px_var(--signal)]">
                <span className="absolute -left-[3px] -top-1 size-2 rounded-full bg-signal" />
              </span>
            )}
          </div>

          {rows.map((r) => {
            const isSel = selected === r.id
            const base = `relative grid h-9 w-full cursor-pointer grid-cols-[var(--label)_minmax(0,1fr)_76px] items-center text-left transition-colors ${
              isSel ? 'bg-signal-soft' : 'hover:bg-hover'
            } ${fresh.has(r.id) ? 'row-new' : ''}`
            const selBar = isSel && <span className="absolute inset-y-1 left-0 w-[2px] rounded-full bg-signal" />
            if (r.type === 'text') {
              return (
                <button key={r.id} className={base} onClick={() => onSelect(isSel ? null : r.id)}>
                  {selBar}
                  <span className="flex min-w-0 items-center gap-2.5 pl-6 pr-3">
                    <span className="size-2 shrink-0 rounded-full border border-fg-2" />
                    <span className="truncate italic text-muted">{r.text.split('\n')[0]}</span>
                  </span>
                  <span className="relative h-full">
                    <span
                      className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-fg-2 bg-bg"
                      style={{ left: `${x(r.at - start)}%` }}
                    />
                  </span>
                  <span />
                </button>
              )
            }
            const open = r.end === null
            const d = (open ? (live ? now : end) : r.end!) - r.start
            const color = r.isError ? 'var(--err)' : kindColor(r.kind)
            return (
              <button key={r.id} className={base} onClick={() => onSelect(isSel ? null : r.id)}>
                {selBar}
                <span className="flex min-w-0 items-center gap-2.5 pl-6 pr-3">
                  <KindDot kind={r.kind} />
                  <span className="shrink-0 font-mono text-[12px] text-fg">{shortTool(r.name)}</span>
                  <span className="truncate text-muted">{r.summary}</span>
                  {r.isError && <span className="label shrink-0 text-[9.5px] text-err">✕ error</span>}
                </span>
                <span className="relative h-full" onMouseMove={(e) => onBar(e, r)} onMouseLeave={() => setTip(null)}>
                  <span
                    className={`absolute top-1/2 h-3.5 -translate-y-1/2 rounded-[4px] ${open && live ? 'bar-live' : ''}`}
                    style={{
                      left: `${x(r.start - start)}%`,
                      width: `max(4px, ${Math.max(x(d) - x(0), 0)}%)`,
                      background: `linear-gradient(90deg, ${color}, color-mix(in srgb, ${color} 70%, white))`,
                      boxShadow: `0 0 14px -2px ${color}`,
                      opacity: open && !live ? 0.35 : 1,
                    }}
                  />
                </span>
                <span className={`tnum pr-6 text-right font-mono text-[12px] ${r.isError ? 'text-err' : 'text-fg-2'}`}>
                  {open && !live ? '—' : duration(d)}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {tip && (
        <div
          className="pointer-events-none absolute z-20 rounded-xl border border-line-strong bg-panel-solid/95 px-3 py-2 text-[12px] shadow-2xl backdrop-blur"
          style={{ left: Math.min(tip.x + 14, (wrap.current?.clientWidth ?? 0) - 230), top: tip.y + 16 }}
        >
          <div className="flex items-center gap-2 font-mono text-fg">
            <KindDot kind={tip.row.kind} />
            {shortTool(tip.row.name)}
          </div>
          <div className="tnum mt-1 text-muted">
            at +{duration(tip.row.start - start)} · took{' '}
            <span className="text-fg">{tip.row.end === null ? 'still running' : duration(tip.row.end - tip.row.start)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

interface InspectorProps {
  row: Row | null
  runStart: number
  now: number
}

function Inspector({ row, runStart, now }: InspectorProps) {
  if (!row)
    return (
      <div className="p-6">
        <SectionTitle>Inspector</SectionTitle>
        <p className="display text-[24px] italic text-fg-2">Pick a step.</p>
        <p className="mt-1 text-muted">Its full input and output show up here.</p>
      </div>
    )

  if (row.type === 'text')
    return (
      <div className="p-6">
        <SectionTitle aside={<span className="tnum font-mono">+{duration(row.at - runStart)}</span>}>Reply</SectionTitle>
        <SkillMarkdown source={row.text} />
      </div>
    )

  const took = (row.end ?? now) - row.start
  return (
    <div className="p-6">
      <div className="label mb-2 flex items-center gap-2">
        <KindDot kind={row.kind} />
        {KINDS.find((k) => k.kind === row.kind)?.label}
      </div>
      <div className="break-all font-mono text-[15px] text-fg">{shortTool(row.name)}</div>
      {row.summary && <p className="mt-1.5 break-words text-fg-2">{row.summary}</p>}
      <dl className="tnum my-5 grid grid-cols-3 gap-3 rounded-xl border border-line p-3">
        <div>
          <dt className="label text-[9.5px]">Start</dt>
          <dd className="font-mono text-[13px] text-fg">+{duration(row.start - runStart)}</dd>
        </div>
        <div>
          <dt className="label text-[9.5px]">Took</dt>
          <dd className="font-mono text-[13px] text-fg">{row.end === null ? 'running' : duration(took)}</dd>
        </div>
        <div>
          <dt className="label text-[9.5px]">Result</dt>
          <dd className={`font-mono text-[13px] ${row.isError ? 'text-err' : 'text-ok'}`}>{row.end === null ? '—' : row.isError ? '✕ error' : '✓ ok'}</dd>
        </div>
      </dl>
      <SectionTitle>Input</SectionTitle>
      <div className="mb-5 max-h-80 overflow-auto rounded-xl border border-line bg-panel-solid p-3">
        <CodeBlock code={row.input} lang="json" wrap />
      </div>
      <SectionTitle>Output</SectionTitle>
      <div className="max-h-[28rem] overflow-auto rounded-xl border border-line bg-panel-solid p-3">
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
