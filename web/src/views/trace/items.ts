import type { RunDetail, TraceEvent } from '../../../../server/types.ts'

export type ToolRow = Extract<TraceEvent, { type: 'tool' }>
export type AskRow = Extract<TraceEvent, { type: 'ask' }>
export type PlanRow = Extract<TraceEvent, { type: 'plan' }>
export type HumanRow = Extract<TraceEvent, { type: 'human' }>

/** What the Replay shows, in order. Consecutive tool calls fold into one `work` item. */
export type Item =
  | { kind: 'work'; id: string; at: number; end: number | null; steps: ToolRow[] }
  | { kind: 'say'; id: string; at: number; text: string; asks: boolean }
  | { kind: 'ask'; id: string; at: number; ev: AskRow }
  | { kind: 'plan'; id: string; at: number; ev: PlanRow }
  | { kind: 'human'; id: string; at: number; ev: HumanRow }

const DECLINED = /doesn't want to proceed|tool use was rejected/i

/** A tool call the person turned down at the permission prompt (not a failure). */
export const isDeclined = (t: ToolRow) => t.isError && DECLINED.test(t.output ?? '')

/** Index of the last event that is not Claude talking; everything after it is the conclusion. */
function lastActionIndex(events: TraceEvent[]) {
  let last = -1
  events.forEach((e, i) => {
    if (e.type !== 'text' && e.type !== 'thinking') last = i
  })
  return last
}

/**
 * Groups a run's events into Replay items. The closing text (shown as the outcome) is left out
 * so it is not repeated in the process.
 */
export function buildItems(run: RunDetail): Item[] {
  const events = run.events
  const cut = run.outcome.text ? lastActionIndex(events) + 1 : events.length
  const items: Item[] = []
  for (let i = 0; i < cut; i++) {
    const e = events[i]
    if (e.type === 'thinking') continue
    if (e.type === 'tool') {
      const prev = items[items.length - 1]
      if (prev?.kind === 'work') {
        prev.steps.push(e)
        prev.end = e.end
      } else items.push({ kind: 'work', id: e.id, at: e.start, end: e.end, steps: [e] })
    } else if (e.type === 'text') {
      const next = events.slice(i + 1).find((x) => x.type !== 'thinking')
      items.push({ kind: 'say', id: e.id, at: e.at, text: e.text, asks: next?.type === 'human' && next.kind === 'reply' })
    } else items.push({ kind: e.type, id: e.id, at: e.at, ev: e } as Item)
  }
  return items
}

export const isHumanItem = (it: Item) => it.kind === 'ask' || it.kind === 'plan' || it.kind === 'human'

/** Which offered options the person picked; anything that matches none is their own words. */
export function readAnswer(answer: string | undefined, labels: string[]): { picked: Set<string>; custom: string | null } {
  if (answer === undefined) return { picked: new Set(), custom: null }
  if (labels.includes(answer)) return { picked: new Set([answer]), custom: null }
  const parts = answer.split(/\s*[,，、]\s*/)
  if (parts.length > 1 && parts.every((p) => labels.includes(p))) return { picked: new Set(parts), custom: null }
  return { picked: new Set(), custom: answer }
}

/** One-line description of a person's moment, for the overview rail and markers. */
export function humanLabel(it: Item): string {
  if (it.kind === 'ask') {
    if (it.ev.declined) return 'Dismissed a question'
    if (!it.ev.answers) return 'Question waiting for you'
    const answers = Object.values(it.ev.answers)
    return `Chose “${answers.join(' / ')}”`
  }
  if (it.kind === 'plan') return it.ev.approved === null ? 'Plan waiting for you' : it.ev.approved ? 'Approved the plan' : 'Sent the plan back'
  if (it.kind === 'human') {
    const t = it.ev.text.length > 40 ? `${it.ev.text.slice(0, 40)}…` : it.ev.text
    if (it.ev.kind === 'reject') return `Declined ${it.ev.tool ?? 'an action'}`
    if (it.ev.kind === 'interrupt') return 'Interrupted'
    return `${it.ev.kind === 'steer' ? 'Added' : 'Replied'} “${t}”`
  }
  return ''
}

// mcp__server__tool → server · tool
export function shortTool(name: string) {
  if (!name.startsWith('mcp__')) return name
  const [, server, ...tool] = name.split('__')
  return `${server} · ${tool.join('__')}`
}

/** Scrolls a Replay item into view and flashes it. */
export function jumpTo(id: string) {
  const el = document.getElementById(`item-${id}`)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.remove('row-new')
  void el.offsetWidth // restart the animation
  el.classList.add('row-new')
}
