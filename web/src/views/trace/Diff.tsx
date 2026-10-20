import { useState } from 'react'
import type { FileChange } from '../../../../server/types.ts'

type Line = { sign: ' ' | '+' | '-'; text: string }

/** Line diff via LCS; falls back to "all removed, all added" for very large inputs. */
function diffLines(before: string, after: string): Line[] {
  const a = before ? before.split('\n') : []
  const b = after ? after.split('\n') : []
  if (a.length * b.length > 400_000) return [...a.map((text) => ({ sign: '-' as const, text })), ...b.map((text) => ({ sign: '+' as const, text }))]
  const dp = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out: Line[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ sign: ' ', text: a[i++] })
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ sign: '-', text: a[i++] })
    else out.push({ sign: '+', text: b[j++] })
  }
  while (i < a.length) out.push({ sign: '-', text: a[i++] })
  while (j < b.length) out.push({ sign: '+', text: b[j++] })
  return out
}

const LINE_STYLE: Record<Line['sign'], string> = {
  ' ': 'text-muted',
  '+': 'bg-[color-mix(in_srgb,var(--ok)_12%,transparent)] text-fg',
  '-': 'bg-[color-mix(in_srgb,var(--err)_12%,transparent)] text-fg-2',
}

function Hunk({ edit, limit }: { edit: FileChange['edits'][number]; limit: number }) {
  const lines = diffLines(edit.old, edit.new)
  const shown = lines.slice(0, limit)
  return (
    <div className="font-mono text-[12px] leading-[1.65]">
      {shown.map((l, i) => (
        <div key={i} className={`flex whitespace-pre-wrap break-all px-3 ${LINE_STYLE[l.sign]}`}>
          <span className={`w-5 shrink-0 select-none ${l.sign === '+' ? 'text-ok' : l.sign === '-' ? 'text-err' : 'text-faint'}`}>{l.sign}</span>
          <span className="min-w-0">{l.text || ' '}</span>
        </div>
      ))}
      {lines.length > limit && <div className="px-3 py-1 text-muted">… {lines.length - limit} more lines</div>}
    </div>
  )
}

/** GitHub-style five-block ratio of additions to deletions. */
function DeltaBlocks({ add, del }: { add: number; del: number }) {
  const total = add + del || 1
  const green = Math.round((add / total) * 5)
  return (
    <span className="flex gap-[2px]" aria-hidden>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className="size-[7px] rounded-[2px]" style={{ background: i < green ? 'var(--ok)' : add + del ? 'var(--err)' : 'var(--line-strong)' }} />
      ))}
    </span>
  )
}

export function FileChanges({ files }: { files: FileChange[] }) {
  const [open, setOpen] = useState<string | null>(files.length === 1 ? files[0].path : null)
  const [full, setFull] = useState(false)
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
      {files.map((f) => {
        const isOpen = open === f.path
        return (
          <li key={f.path}>
            <button
              onClick={() => setOpen(isOpen ? null : f.path)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-hover"
              aria-expanded={isOpen}
            >
              <span className={`inline-block text-faint transition-transform ${isOpen ? 'rotate-90' : ''}`}>›</span>
              <span
                className={`rounded-full border px-2 font-mono text-[9.5px] uppercase tracking-[0.1em] ${
                  f.op === 'create' ? 'border-ok/40 text-ok' : 'border-line-strong text-fg-2'
                }`}
              >
                {f.op === 'create' ? 'new' : 'edit'}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-fg">{f.path}</span>
              <span className="tnum shrink-0 font-mono text-[11.5px]">
                <span className="text-ok">+{f.additions}</span> <span className="text-err">−{f.deletions}</span>
              </span>
              <DeltaBlocks add={f.additions} del={f.deletions} />
            </button>
            {isOpen && (
              <div className="border-t border-line bg-panel-solid py-2">
                {f.edits.map((e, i) => (
                  <div key={i} className={i ? 'mt-2 border-t border-dashed border-line pt-2' : ''}>
                    <Hunk edit={e} limit={full ? Infinity : 60} />
                  </div>
                ))}
                {!full && f.edits.some((e) => diffLines(e.old, e.new).length > 60) && (
                  <button onClick={() => setFull(true)} className="label ml-3 mt-2 hover:text-fg">
                    Show everything
                  </button>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
