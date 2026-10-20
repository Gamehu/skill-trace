import fs from 'node:fs'
import path from 'node:path'

/**
 * Watches each root recursively with one native handle (FSEvents on macOS, ReadDirectoryChangesW on Windows).
 * Per-file watchers exhaust file descriptors once there are a few hundred skills, so they are avoided.
 * Missing roots and watcher errors are ignored: live updates are best-effort and must never crash the server.
 *
 * @param roots - Directories to watch.
 * @param onChange - Called with the absolute path of each changed entry.
 * @returns A function that closes every watcher.
 */
export function watchTrees(roots: string[], onChange: (file: string) => void): () => void {
  const watchers = [...new Set(roots)].flatMap((root) => {
    try {
      const w = fs.watch(root, { recursive: true, persistent: true }, (_event, name) => {
        if (name) onChange(path.join(root, name.toString()))
      })
      w.on('error', () => w.close())
      return [w]
    } catch {
      return []
    }
  })
  return () => watchers.forEach((w) => w.close())
}

/**
 * Coalesces bursts of calls per key into one trailing call.
 *
 * @param ms - Quiet period before the call fires.
 * @returns A scheduler taking a key and the function to run.
 */
export function debouncer(ms: number): (key: string, fn: () => void) => void {
  const timers = new Map<string, NodeJS.Timeout>()
  return (key, fn) => {
    clearTimeout(timers.get(key))
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key)
        fn()
      }, ms),
    )
  }
}
