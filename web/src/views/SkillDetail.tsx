import { useState } from 'react'
import { Link } from 'wouter'
import type { SkillDetail } from '../../../server/types.ts'
import { CodeBlock, SkillMarkdown, langFromPath } from '../components/Code.tsx'
import { AgentTags } from '../components/Scope.tsx'
import { Empty, Metric, PageHeader, SectionTitle, SourceTag } from '../components/ui.tsx'
import { useApi } from '../lib/api.ts'
import { ago, duration } from '../lib/format.ts'
import { RunTable } from './Runs.tsx'

const fmtDay = (day: string) => new Date(`${day}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

function Activity({ daily }: { daily: SkillDetail['daily'] }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...daily.map((d) => d.runs))
  const total = daily.reduce((s, d) => s + d.runs, 0)
  const shown = hover !== null ? daily[hover] : null

  return (
    <div className="glass rise p-6" style={{ ['--i' as string]: 6 }}>
      <SectionTitle aside={<span className="tnum font-mono">{shown ? `${fmtDay(shown.day)} · ${shown.runs} run${shown.runs === 1 ? '' : 's'}` : `${total} in 30 days`}</span>}>
        Runs per day
      </SectionTitle>
      <div className="flex h-24 items-end gap-[3px]" onMouseLeave={() => setHover(null)} role="img" aria-label={`Runs per day over the last 30 days, ${total} total`}>
        {daily.map((d, i) => (
          <div key={d.day} className="flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)}>
            <div
              className="w-full rounded-t-[4px] transition-all duration-300"
              style={{
                height: d.runs ? `max(4px, ${(d.runs / max) * 100}%)` : '2px',
                background: d.runs ? 'linear-gradient(to top, color-mix(in srgb, var(--signal) 35%, transparent), var(--signal))' : 'var(--line-strong)',
                boxShadow: d.runs ? '0 0 16px -4px var(--signal)' : undefined,
                opacity: hover === null || hover === i ? 1 : 0.35,
              }}
            />
          </div>
        ))}
      </div>
      <div className="label mt-2 flex justify-between text-[9.5px]">
        <span>{fmtDay(daily[0].day)}</span>
        <span>Today</span>
      </div>
    </div>
  )
}

function Frontmatter({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([k]) => k !== 'description')
  if (!entries.length) return null
  return (
    <dl className="mb-8 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 rounded-xl border border-line p-4 text-[12.5px]">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="label pt-0.5 text-[10px]">{k}</dt>
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

function formatSize(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function SkillDetailView({ id }: { id: string }) {
  const { data: skill, error } = useApi<SkillDetail>(`/api/skills/${id}`)
  const [file, setFile] = useState<string | null>(null)

  if (error) return <Empty title="Skill not found.">It may have been removed or renamed.</Empty>
  if (!skill) return null

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href="/skills" className="hover:text-fg">
              Skills
            </Link>
            <span className="text-faint">/</span>
            <AgentTags agents={skill.agents} />
            <SourceTag source={skill.source} />
          </>
        }
        title={skill.name}
        meta={skill.dir && <span className="truncate font-mono text-[11.5px] text-muted">{skill.dir.replace(/^\/Users\/[^/]+/, '~')}</span>}
      />
      <div className="space-y-4 px-6 sm:px-10">
        {skill.description && (
          <p className="rise max-w-3xl pb-2 text-[15.5px] leading-relaxed text-fg-2" style={{ ['--i' as string]: 1 }}>
            {skill.description}
          </p>
        )}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Metric index={2} label="Runs · all time" value={skill.stats.runs} />
          <Metric index={3} label="Avg time" value={duration(skill.stats.avgDurationMs)} />
          <Metric index={4} label="Runs with errors" value={<span className={skill.stats.errors ? 'text-err' : ''}>{skill.stats.errors}</span>} />
          <Metric index={5} label="Last run" value={ago(skill.stats.lastRunAt)} />
        </div>
        <Activity daily={skill.daily} />

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section className="glass rise min-w-0 p-6 sm:p-8" style={{ ['--i' as string]: 7 }}>
            <SectionTitle
              aside={
                file && (
                  <button onClick={() => setFile(null)} className="hover:text-fg">
                    ← SKILL.md
                  </button>
                )
              }
            >
              <span className="font-mono normal-case tracking-normal">{file ?? 'SKILL.md'}</span>
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

          <aside className="glass rise min-w-0 self-start p-4 xl:sticky xl:top-4" style={{ ['--i' as string]: 8 }}>
            <div className="px-2 pt-2">
              <SectionTitle aside={<span className="tnum font-mono">{skill.files.length}</span>}>Files</SectionTitle>
            </div>
            {skill.files.length === 0 ? (
              <p className="px-2 pb-2 text-muted">No files on disk.</p>
            ) : (
              <ul>
                {skill.files.map((f) => {
                  const current = (file ?? 'SKILL.md') === f.path
                  return (
                    <li key={f.path}>
                      <button
                        onClick={() => setFile(f.path === 'SKILL.md' ? null : f.path)}
                        className={`flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left transition-colors ${
                          current ? 'bg-signal-soft text-fg' : 'text-fg-2 hover:bg-hover'
                        }`}
                      >
                        <span className="truncate font-mono text-[12px]">{f.path}</span>
                        <span className="tnum shrink-0 font-mono text-[10.5px] text-faint">{formatSize(f.size)}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </aside>
        </div>

        <section className="glass rise overflow-hidden pt-6" style={{ ['--i' as string]: 9 }}>
          <div className="px-6">
            <SectionTitle aside={skill.runs.length > 0 && <span className="tnum font-mono">{skill.runs.length}</span>}>Runs of this skill</SectionTitle>
          </div>
          {skill.runs.length ? <RunTable runs={skill.runs} showSkill={false} /> : <p className="px-6 pb-6 text-muted">Not used yet.</p>}
        </section>
      </div>
    </>
  )
}
