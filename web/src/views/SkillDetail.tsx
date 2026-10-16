import { useState } from 'react'
import { Link } from 'wouter'
import type { SkillDetail } from '../../../server/types.ts'
import { CodeBlock, SkillMarkdown, langFromPath } from '../components/Code.tsx'
import { Empty, PageHeader, SectionTitle, SourceTag, Stats } from '../components/ui.tsx'
import { useApi } from '../lib/api.ts'
import { ago, duration } from '../lib/format.ts'
import { RunTable } from './Runs.tsx'

function Activity({ daily }: { daily: SkillDetail['daily'] }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...daily.map((d) => d.runs))
  const total = daily.reduce((s, d) => s + d.runs, 0)
  const fmt = (day: string) => new Date(`${day}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const shown = hover !== null ? daily[hover] : null

  return (
    <section className="border-b border-line px-6 py-5 sm:px-8">
      <SectionTitle aside={<span className="tnum">{shown ? `${fmt(shown.day)} · ${shown.runs} run${shown.runs === 1 ? '' : 's'}` : `${total} in 30 days`}</span>}>
        Runs per day
      </SectionTitle>
      <div className="flex h-16 items-end gap-[2px]" onMouseLeave={() => setHover(null)} role="img" aria-label={`Runs per day over the last 30 days, ${total} total`}>
        {daily.map((d, i) => (
          <div key={d.day} className="flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)}>
            <div
              className="w-full rounded-t-[3px] transition-opacity"
              style={{
                height: d.runs ? `max(3px, ${(d.runs / max) * 100}%)` : '1px',
                background: d.runs ? 'var(--k-read)' : 'var(--line-strong)',
                opacity: hover === null || hover === i ? 1 : 0.45,
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-faint">
        <span>{fmt(daily[0].day)}</span>
        <span>Today</span>
      </div>
    </section>
  )
}

function Frontmatter({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([k]) => k !== 'description')
  if (!entries.length) return null
  return (
    <dl className="mb-6 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 border-b border-line pb-5 text-[12.5px]">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-mono text-muted">{k}</dt>
          <dd className="min-w-0 break-words text-fg-2">{typeof v === 'string' ? v : JSON.stringify(v)}</dd>
        </div>
      ))}
    </dl>
  )
}

function FileView({ skillId, path }: { skillId: string; path: string }) {
  const { data, error } = useApi<string>(`/api/skills/${skillId}/file?path=${encodeURIComponent(path)}`)
  if (error) return <p className="text-muted">Cannot show this file ({error.toLowerCase()}).</p>
  if (data === undefined) return null
  return <CodeBlock code={data} lang={langFromPath(path)} />
}

export function SkillDetailView({ id }: { id: string }) {
  const { data: skill, error } = useApi<SkillDetail>(`/api/skills/${id}`)
  const [file, setFile] = useState<string | null>(null)

  if (error) return <Empty title="Skill not found.">It may have been removed or renamed.</Empty>
  if (!skill) return null

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2.5">
            <Link href="/skills" className="font-normal text-muted hover:text-fg-2">
              Skills
            </Link>
            <span className="font-normal text-faint">/</span>
            <span className="font-mono">{skill.name}</span>
            <SourceTag source={skill.source} />
          </span>
        }
        meta={skill.dir && <span className="truncate font-mono text-[11.5px]">{skill.dir}</span>}
      />
      {skill.description && (
        <div className="border-b border-line px-6 py-4 sm:px-8">
          <p className="max-w-3xl text-fg-2">{skill.description}</p>
        </div>
      )}
      <Stats
        items={[
          { label: 'Runs', value: skill.stats.runs },
          { label: 'Runs with errors', value: skill.stats.errors },
          { label: 'Avg time', value: duration(skill.stats.avgDurationMs) },
          { label: 'Last run', value: ago(skill.stats.lastRunAt) },
        ]}
      />
      <Activity daily={skill.daily} />

      <div className="grid xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0 border-line px-6 py-6 sm:px-8 xl:border-r">
          <SectionTitle
            aside={
              file && (
                <button onClick={() => setFile(null)} className="hover:text-fg-2">
                  Back to SKILL.md
                </button>
              )
            }
          >
            <span className="font-mono">{file ?? 'SKILL.md'}</span>
          </SectionTitle>
          {file ? (
            <FileView skillId={skill.id} path={file} />
          ) : skill.body ? (
            <>
              <Frontmatter data={skill.frontmatter} />
              <div className="max-w-3xl">
                <SkillMarkdown source={skill.body} />
              </div>
            </>
          ) : (
            <p className="text-muted">SKILL.md is not available on disk.</p>
          )}
        </section>

        <aside className="min-w-0 border-line px-6 py-6 max-xl:border-t sm:px-8 xl:px-6">
          <SectionTitle aside={<span className="tnum">{skill.files.length}</span>}>Files</SectionTitle>
          {skill.files.length === 0 ? (
            <p className="text-muted">No files on disk.</p>
          ) : (
            <ul className="-mx-2">
              {skill.files.map((f) => (
                <li key={f.path}>
                  <button
                    onClick={() => setFile(f.path === 'SKILL.md' ? null : f.path)}
                    className={`flex w-full items-center justify-between gap-3 rounded px-2 py-1 text-left hover:bg-hover ${
                      (file ?? 'SKILL.md') === f.path ? 'bg-raised text-fg' : 'text-fg-2'
                    }`}
                  >
                    <span className="truncate font-mono text-[12px]">{f.path}</span>
                    <span className="tnum shrink-0 text-[11px] text-faint">{formatSize(f.size)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      <section className="border-t border-line pt-6">
        <div className="px-6 sm:px-8">
          <SectionTitle aside={skill.runs.length > 0 && <span className="tnum">{skill.runs.length}</span>}>Recent runs</SectionTitle>
        </div>
        {skill.runs.length ? <RunTable runs={skill.runs} showSkill={false} /> : <p className="px-6 pb-8 text-muted sm:px-8">Not used yet.</p>}
      </section>
    </>
  )
}

function formatSize(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
