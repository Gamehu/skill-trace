import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AgentId, AgentSettings, PathStatus, Settings, SettingsPayload, SkillFilter } from '../../../server/types.ts'
import { AgentTags } from '../components/Scope.tsx'
import { Empty, PageHeader, SearchInput, SourceTag } from '../components/ui.tsx'
import { useApi } from '../lib/api.ts'
import { AGENTS } from '../lib/agents.ts'

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-10 shrink-0 rounded-full border transition-colors ${on ? 'border-fg bg-fg' : 'border-line-strong bg-raised'}`}
    >
      <span className={`absolute top-0.5 size-[18px] rounded-full transition-all ${on ? 'left-[18px] bg-bg' : 'left-0.5 bg-muted'}`} />
    </button>
  )
}

/** Editable list of folders, each marked found / not found as of the last save. */
function FolderList({ label, hint, values, statuses, onChange, single }: {
  label: string
  hint: ReactNode
  values: string[]
  statuses: PathStatus[]
  onChange: (v: string[]) => void
  single?: boolean
}) {
  const status = (p: string) => statuses.find((s) => s.path === p)
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-[12.5px] font-medium text-fg">{label}</span>
        {!(single && values.length >= 1) && (
          <button onClick={() => onChange([...values, ''])} className="text-[12px] text-muted underline decoration-line-strong underline-offset-4 hover:text-fg">
            Add folder
          </button>
        )}
      </div>
      <p className="mb-2 text-[12px] text-muted">{hint}</p>
      {values.length === 0 && <p className="text-[12px] italic text-faint">None — nothing is read for this.</p>}
      <ul className="space-y-1.5">
        {values.map((v, i) => {
          const st = status(v)
          return (
            <li key={i} className="flex items-center gap-2">
              <input
                value={v}
                onChange={(e) => onChange(values.map((x, j) => (j === i ? e.target.value : x)))}
                placeholder="/absolute/path or ~/path"
                spellCheck={false}
                className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-panel-solid px-2.5 font-mono text-[12px] text-fg outline-none placeholder:text-faint focus:border-line-strong"
              />
              <span
                className={`shrink-0 text-[11.5px] sm:w-28 ${!st ? 'text-faint' : st.exists ? 'text-ok' : 'text-warn'}`}
                title={!st ? 'Checked when you save' : st.exists ? 'Folder found' : 'Folder not found'}
              >
                {!st ? '…' : st.exists ? '✓' : '✕'}
                <span className="max-sm:sr-only">{!st ? ' Checked on save' : st.exists ? ' Found' : ' Not found'}</span>
              </span>
              <button onClick={() => onChange(values.filter((_, j) => j !== i))} aria-label={`Remove ${v || 'folder'}`} className="shrink-0 px-1 text-muted hover:text-err">
                ✕
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function AgentCard({ id, label, draft, defaults, payload, onChange }: {
  id: AgentId
  label: string
  draft: AgentSettings
  defaults: AgentSettings
  payload: SettingsPayload
  onChange: (next: AgentSettings) => void
}) {
  const st = payload.status[id]
  const saved = payload.settings.agents[id]
  const found = st.skills.some((p) => p.exists) || st.sessions.some((p) => p.exists)
  const isDefault = JSON.stringify(draft) === JSON.stringify(defaults)
  return (
    <section className="glass p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="display text-[28px] text-fg">{label}</h2>
          <p className="mt-1 text-[12.5px] text-muted">
            {!saved.enabled
              ? 'Turned off: nothing is read from it.'
              : found
                ? `${st.skillCount} skill${st.skillCount === 1 ? '' : 's'} and ${st.sessionFiles.toLocaleString()}${st.sessionFiles >= 20_000 ? '+' : ''} session file${st.sessionFiles === 1 ? '' : 's'} found.`
                : 'Nothing found in these folders. Is it installed somewhere else?'}{' '}
            {st.replay ? 'Its runs are replayed.' : 'Its skills are listed; replaying its runs is not supported yet.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!isDefault && (
            <button onClick={() => onChange(structuredClone(defaults))} className="text-[12px] text-muted underline decoration-line-strong underline-offset-4 hover:text-fg">
              Reset to detected
            </button>
          )}
          <span className="text-[12px] text-fg-2">{draft.enabled ? 'On' : 'Off'}</span>
          <Switch on={draft.enabled} onChange={(enabled) => onChange({ ...draft, enabled })} label={`Read ${label}`} />
        </div>
      </div>
      {draft.enabled && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <FolderList
            label="Skill folders"
            hint="Each skill is a sub-folder with a SKILL.md. Project folders are found on their own from the projects you work in."
            values={draft.skills}
            statuses={st.skills}
            onChange={(skills) => onChange({ ...draft, skills })}
          />
          <FolderList
            label="Session logs"
            hint={id === 'claude-code' ? 'Where Claude Code writes its conversation logs (one folder per project).' : 'Where this tool keeps its session history.'}
            values={draft.sessions}
            statuses={st.sessions}
            onChange={(sessions) => onChange({ ...draft, sessions })}
          />
          {id === 'claude-code' && (
            <FolderList
              label="Plugins"
              hint="The folder with installed_plugins.json; only installed plugin versions are read."
              values={draft.plugins}
              statuses={st.plugins}
              onChange={(plugins) => onChange({ ...draft, plugins })}
            />
          )}
        </div>
      )}
    </section>
  )
}

const tracks = (f: SkillFilter, key: string) => (f.mode === 'all-except' ? !f.keys.includes(key) : f.keys.includes(key))

function SkillPicker({ payload, filter, onChange }: { payload: SettingsPayload; filter: SkillFilter; onChange: (f: SkillFilter) => void }) {
  const [q, setQ] = useState('')
  const all = payload.skills
  const shown = all.filter((s) => !q || `${s.name} ${s.description}`.toLowerCase().includes(q.toLowerCase()))
  const tracked = all.filter((s) => tracks(filter, s.key)).length

  const toggle = (key: string) => {
    const has = filter.keys.includes(key)
    onChange({ ...filter, keys: has ? filter.keys.filter((k) => k !== key) : [...filter.keys, key] })
  }
  // Switching mode keeps today's selection: the listed keys flip between "hidden" and "tracked".
  const setMode = (mode: SkillFilter['mode']) => {
    if (mode === filter.mode) return
    const selected = all.filter((s) => tracks(filter, s.key)).map((s) => s.key)
    onChange({ mode, keys: mode === 'only' ? selected : all.filter((s) => !selected.includes(s.key)).map((s) => s.key) })
  }

  return (
    <section id="skills" className="glass scroll-mt-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="display text-[28px] text-fg">Skills to track</h2>
          <p className="mt-1 text-[12.5px] text-muted">
            Tracking {tracked} of {all.length}. Skills you don’t track, and their runs, are left out of Overview, Skills and Runs.
          </p>
        </div>
        <SearchInput value={q} onChange={setQ} placeholder="Find a skill" />
      </div>

      <fieldset className="mt-5 grid gap-2 sm:grid-cols-2">
        <legend className="sr-only">How new skills are handled</legend>
        {(
          [
            ['all-except', 'Track everything I don’t uncheck', 'Skills you add later show up on their own.'],
            ['only', 'Track only what I check', 'Skills you add later stay out until you check them.'],
          ] as const
        ).map(([mode, title, note]) => (
          <label key={mode} className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${filter.mode === mode ? 'border-fg' : 'border-line hover:border-line-strong'}`}>
            <input type="radio" name="mode" checked={filter.mode === mode} onChange={() => setMode(mode)} className="mt-1 accent-[var(--fg)]" />
            <span>
              <span className="block text-[13px] text-fg">{title}</span>
              <span className="block text-[12px] text-muted">{note}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="mt-4 flex flex-wrap gap-2 text-[12px]">
        <span className="text-muted">Quick picks:</span>
        <button onClick={() => onChange({ mode: 'all-except', keys: [] })} className="underline decoration-line-strong underline-offset-4 hover:text-fg">
          Everything
        </button>
        <button
          onClick={() => onChange({ mode: 'only', keys: all.filter((s) => s.source === 'user' || s.source === 'project').map((s) => s.key) })}
          className="underline decoration-line-strong underline-offset-4 hover:text-fg"
        >
          Only my own (user and project skills)
        </button>
        <button onClick={() => onChange({ mode: 'only', keys: [] })} className="underline decoration-line-strong underline-offset-4 hover:text-fg">
          Nothing
        </button>
      </div>

      <ul className="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line">
        {shown.map((s) => {
          const on = tracks(filter, s.key)
          return (
            <li key={s.key}>
              <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-hover">
                <input type="checkbox" checked={on} onChange={() => toggle(s.key)} className="size-4 shrink-0 accent-[var(--fg)]" />
                <span className="min-w-0 flex-1">
                  <span className={`block truncate font-mono text-[12.5px] ${on ? 'text-fg' : 'text-muted'}`}>{s.name}</span>
                  <span className="block truncate text-[11.5px] text-faint" title={s.key}>
                    {s.description || s.key}
                  </span>
                </span>
                <span className="hidden shrink-0 flex-wrap justify-end gap-1 sm:flex">
                  <AgentTags agents={s.agents} />
                  <SourceTag source={s.source} />
                </span>
                <span className="tnum w-16 shrink-0 text-right font-mono text-[11.5px] text-muted">{s.runs} runs</span>
              </label>
            </li>
          )
        })}
        {shown.length === 0 && <li className="px-4 py-6 text-center text-muted">No skill matches.</li>}
      </ul>
    </section>
  )
}

export function SettingsView() {
  const { data: loaded, error } = useApi<SettingsPayload>('/api/settings')
  const [payload, setPayload] = useState<SettingsPayload | null>(null)
  const [draft, setDraft] = useState<Settings | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const dirty = useMemo(() => !!payload && !!draft && JSON.stringify(draft) !== JSON.stringify(payload.settings), [payload, draft])

  // Take fresh data from the server unless the person has unsaved edits.
  useEffect(() => {
    if (!loaded || dirty) return
    setPayload(loaded)
    setDraft(structuredClone(loaded.settings))
  }, [loaded])

  useEffect(() => {
    if (payload && location.hash === '#skills') document.getElementById('skills')?.scrollIntoView()
  }, [payload])

  if (error) return <Empty title="Could not load settings.">{error}</Empty>
  if (!payload || !draft) return null

  const save = async () => {
    setSaving(true)
    setMessage(null)
    const cleaned: Settings = {
      ...draft,
      agents: Object.fromEntries(
        Object.entries(draft.agents).map(([id, a]) => [id, { ...a, skills: a.skills.filter((p) => p.trim()), sessions: a.sessions.filter((p) => p.trim()), plugins: a.plugins.filter((p) => p.trim()) }]),
      ) as Settings['agents'],
      extraSkillDirs: draft.extraSkillDirs.filter((p) => p.trim()),
    }
    try {
      const r = await fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cleaned) })
      const body = await r.json()
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`)
      setPayload(body)
      setDraft(structuredClone(body.settings))
      setMessage({ ok: true, text: 'Saved. Every page now reads from these folders.' })
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title={
          <>
            Sources<span className="italic text-signal">.</span>
          </>
        }
        meta={
          <span>
            Folders were detected automatically; change any that are wrong. skill-trace only reads them. Your choices are saved in{' '}
            <code className="font-mono text-[12px] text-fg-2">{payload.file}</code>.
          </span>
        }
      />
      <div className="space-y-4 px-6 pb-24 sm:px-10">
        {AGENTS.map((a) => (
          <AgentCard
            key={a.id}
            id={a.id}
            label={a.label}
            draft={draft.agents[a.id]}
            defaults={payload.defaults.agents[a.id]}
            payload={payload}
            onChange={(next) => setDraft({ ...draft, agents: { ...draft.agents, [a.id]: next } })}
          />
        ))}
        <section className="glass p-6">
          <h2 className="display mb-4 text-[28px] text-fg">Extra skill folders</h2>
          <FolderList
            label="Folders"
            hint="Skills kept outside any tool’s own folder, such as a shared repo. They show under “All tools”."
            values={draft.extraSkillDirs}
            statuses={payload.extraStatus}
            onChange={(extraSkillDirs) => setDraft({ ...draft, extraSkillDirs })}
          />
        </section>
        <SkillPicker payload={payload} filter={draft.skillFilter} onChange={(skillFilter) => setDraft({ ...draft, skillFilter })} />
      </div>

      {(dirty || message) && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-[color-mix(in_srgb,var(--bg)_92%,transparent)] backdrop-blur md:left-60">
          <div className="flex flex-wrap items-center justify-end gap-3 px-6 py-3 sm:px-10">
            {message && <span className={`mr-auto text-[12.5px] ${message.ok ? 'text-ok' : 'text-err'}`}>{message.text}</span>}
            {dirty && !message && <span className="mr-auto text-[12.5px] text-fg-2">You have unsaved changes.</span>}
            {dirty && (
              <>
                <button
                  onClick={() => {
                    setDraft(structuredClone(payload.settings))
                    setMessage(null)
                  }}
                  className="h-8 rounded-full border border-line-strong px-4 text-[12.5px] text-fg-2 hover:text-fg"
                >
                  Discard
                </button>
                <button onClick={save} disabled={saving} className="h-8 rounded-full bg-fg px-4 text-[12.5px] text-bg disabled:opacity-60">
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </>
            )}
            {!dirty && message && (
              <button onClick={() => setMessage(null)} className="text-[12px] text-muted hover:text-fg">
                Dismiss
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )
}
