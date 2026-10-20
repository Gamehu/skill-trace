#!/usr/bin/env node
// Starts the skill-trace server (TypeScript is loaded through tsx, no separate server build).
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { register } from 'tsx/esm/api'

const args = process.argv.slice(2)
if (args.includes('-h') || args.includes('--help')) {
  console.log(`Usage: skill-trace [--port <n>]

Reads Claude Code transcripts and skills from ~/.claude (override with CLAUDE_CONFIG_DIR)
and serves a live dashboard on http://localhost:4317.`)
  process.exit(0)
}
const portIdx = args.indexOf('--port')
if (portIdx !== -1 && args[portIdx + 1]) process.env.PORT = args[portIdx + 1]

if (!existsSync(fileURLToPath(new URL('../dist/index.html', import.meta.url)))) {
  console.warn('skill-trace: web UI is not built yet; run `npm run build` (serving the API only).')
}

register()
await import('../server/index.ts')
