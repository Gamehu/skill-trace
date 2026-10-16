import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { watch } from 'chokidar'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { CLAUDE_HOME, PLUGINS_DIR, PORT, PROJECTS_DIR, USER_SKILLS_DIR } from './config.ts'
import { store } from './store.ts'
import type { ServerEvent } from './types.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(root, 'dist')

const app = new Hono()
const subscribers = new Set<(e: ServerEvent) => void>()
const broadcast = (e: ServerEvent) => subscribers.forEach((fn) => fn(e))

app.get('/api/skills', (c) => c.json(store.listSkills()))

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
  return c.json(store.listRuns({ skill: c.req.query('skill'), limit }))
})

app.get('/api/runs/:id', (c) => {
  const run = store.getRun(c.req.param('id'))
  return run ? c.json(run) : c.json({ error: 'not found' }, 404)
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

function startWatcher() {
  const timers = new Map<string, NodeJS.Timeout>()
  const debounce = (key: string, fn: () => void) => {
    clearTimeout(timers.get(key))
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key)
        fn()
      }, 250),
    )
  }

  const transcripts = watch(PROJECTS_DIR, {
    ignoreInitial: true,
    depth: 1,
    ignored: (p, stats) => !!stats?.isFile() && !p.endsWith('.jsonl'),
  })
  const onTranscript = (file: string) =>
    debounce(file, async () => {
      const id = await store.refreshSession(file)
      if (id) broadcast({ type: 'update', sessions: [id] })
    })
  transcripts.on('add', onTranscript).on('change', onTranscript).on('unlink', onTranscript)

  const skills = watch([USER_SKILLS_DIR, PLUGINS_DIR, ...store.skillDirs()], { ignoreInitial: true, depth: 6 })
  skills.on('all', () =>
    debounce('skills', async () => {
      await store.rebuild()
      broadcast({ type: 'update', sessions: [] })
    }),
  )
}

const t0 = Date.now()
await store.init()
startWatcher()

serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, ({ port }) => {
  const skills = store.listSkills()
  const runs = store.listRuns({}).length
  console.log(`skill-trace  reading ${CLAUDE_HOME}`)
  console.log(`             ${skills.length} skills, ${runs} runs indexed in ${Date.now() - t0}ms`)
  console.log(`             http://localhost:${port}`)
})
