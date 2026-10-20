import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono, type Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import { PORT } from './config.ts'
import { AGENT_IDS, loadSettings, saveSettings, settingsFile, validate } from './settings.ts'
import { store } from './store.ts'
import { debouncer, watchTrees } from './watch.ts'
import type { AgentScope, ServerEvent, Settings } from './types.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(root, 'dist')

const app = new Hono()
const subscribers = new Set<(e: ServerEvent) => void>()
const broadcast = (e: ServerEvent) => subscribers.forEach((fn) => fn(e))

/** `?agent=codex` scopes a query to one agent; anything else means all agents. */
const scopeOf = (c: Context): AgentScope => AGENT_IDS.find((id) => id === c.req.query('agent')) ?? null

app.get('/api/overview', (c) => c.json(store.overview(scopeOf(c))))

app.get('/api/agents', (c) => c.json(store.agentSummary()))

app.get('/api/skills', (c) => c.json({ skills: store.listSkills(scopeOf(c)), untracked: store.untrackedCount(scopeOf(c)) }))

app.get('/api/skills/:id', async (c) => {
  const skill = await store.getSkill(c.req.param('id'))
  return skill ? c.json(skill) : c.json({ error: 'not found' }, 404)
})

app.get('/api/skills/:id/file', async (c) => {
  const content = await store.readSkillFile(c.req.param('id'), c.req.query('path') ?? '')
  return content === null ? c.json({ error: 'not found' }, 404) : c.text(content)
})

app.get('/api/runs', (c) => {
  const limit = Number(c.req.query('limit')) || undefined
  return c.json(store.listRuns({ skill: c.req.query('skill'), limit, scope: scopeOf(c) }))
})

app.get('/api/runs/:id', (c) => {
  const run = store.getRun(c.req.param('id'))
  return run ? c.json(run) : c.json({ error: 'not found' }, 404)
})

app.get('/api/settings', async (c) => c.json(await store.settingsPayload()))

/**
 * Saving settings is the only write. Only this page may do it: the request must be JSON (so a
 * cross-site form cannot send it without a CORS preflight, which is never granted), come from a
 * page on this server, and be addressed to localhost (guards against DNS rebinding).
 */
app.put('/api/settings', async (c) => {
  const host = (c.req.header('host') ?? '').replace(/:\d+$/, '')
  const origin = c.req.header('origin')
  const sameOrigin = !origin || new URL(origin).host === c.req.header('host')
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host) || !sameOrigin || !c.req.header('content-type')?.includes('application/json')) {
    return c.json({ error: 'Settings can only be changed from the skill-trace page on this machine.' }, 403)
  }
  const body = (await c.req.json().catch(() => null)) as Settings | null
  const problem = validate(body)
  if (problem) return c.json({ error: problem }, 400)
  await saveSettings(body!)
  await store.reload()
  restartWatcher()
  broadcast({ type: 'update', sessions: [] })
  return c.json(await store.settingsPayload())
})

app.get('/api/events', (c) =>
  streamSSE(c, async (stream) => {
    const send = (e: ServerEvent) => void stream.writeSSE({ data: JSON.stringify(e) })
    subscribers.add(send)
    send({ type: 'hello' })
    const ping = setInterval(() => void stream.writeSSE({ event: 'ping', data: '' }), 25_000)
    await new Promise<void>((resolve) => stream.onAbort(resolve))
    clearInterval(ping)
    subscribers.delete(send)
  }),
)

if (fs.existsSync(path.join(distDir, 'index.html'))) {
  app.use('/*', serveStatic({ root: path.relative(process.cwd(), distDir) }))
  // Read per request so a rebuild never leaves the page pointing at stale asset hashes.
  app.get('*', (c) => c.html(fs.readFileSync(path.join(distDir, 'index.html'), 'utf8')))
}

let stopWatching = () => {}

/** Watches the folders in effect; called again whenever settings change them. */
function restartWatcher() {
  stopWatching()
  const debounce = debouncer(250)
  const roots = store.watchRoots()
  const stopSessions = watchTrees(roots.sessions, (file) => {
    if (!store.isSessionFile(file)) return
    debounce(file, async () => {
      const id = await store.refreshSession(file)
      if (id) broadcast({ type: 'update', sessions: [id] })
    })
  })
  const stopSkills = watchTrees(roots.skills, () =>
    debounce('skills', async () => {
      await store.rebuild()
      broadcast({ type: 'update', sessions: [] })
    }),
  )
  stopWatching = () => {
    stopSessions()
    stopSkills()
  }
}

const t0 = Date.now()
await loadSettings()
await store.init()
restartWatcher()

serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, ({ port }) => {
  const skills = store.listSkills()
  const runs = store.listRuns({}).length
  console.log(`skill-trace  settings ${settingsFile()}`)
  console.log(`             ${skills.length} skills, ${runs} runs indexed in ${Date.now() - t0}ms`)
  console.log(`             http://localhost:${port}`)
})
