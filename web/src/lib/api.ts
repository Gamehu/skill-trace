import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ServerEvent } from '../../../server/types.ts'

/** Bumped whenever the server reports a transcript or skill change; data hooks refetch on change. */
export const LiveContext = createContext<{ version: number; connected: boolean }>({ version: 0, connected: false })

export function useLiveConnection() {
  const [state, setState] = useState({ version: 0, connected: false })
  useEffect(() => {
    let es: EventSource | null = null
    let retry: ReturnType<typeof setTimeout>
    const connect = () => {
      es = new EventSource('/api/events')
      es.onopen = () => setState((s) => ({ ...s, connected: true }))
      es.onmessage = (msg) => {
        const e = JSON.parse(msg.data) as ServerEvent
        if (e.type === 'update') setState((s) => ({ ...s, version: s.version + 1 }))
      }
      es.onerror = () => {
        es?.close()
        setState((s) => ({ ...s, connected: false }))
        retry = setTimeout(connect, 2000)
      }
    }
    connect()
    return () => {
      clearTimeout(retry)
      es?.close()
    }
  }, [])
  return state
}

export function useApi<T>(path: string | null): { data: T | undefined; error: string | null; loading: boolean } {
  const { version } = useContext(LiveContext)
  const [data, setData] = useState<T>()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const lastPath = useRef(path)

  useEffect(() => {
    if (!path) return
    // Keep showing the previous data during live refreshes; clear it only when the resource changes.
    if (lastPath.current !== path) {
      lastPath.current = path
      setData(undefined)
      setLoading(true)
    }
    const ctrl = new AbortController()
    fetch(path, { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 404 ? 'Not found' : `HTTP ${r.status}`)
        return (r.headers.get('content-type')?.includes('json') ? r.json() : r.text()) as Promise<T>
      })
      .then((d) => {
        setData(d)
        setError(null)
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setError(e.message)
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })
    return () => ctrl.abort()
  }, [path, version])

  return { data, error, loading }
}

/** Re-renders every `ms` while `active`, for live durations. */
export function useNow(active: boolean, ms = 1000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [active, ms])
  return now
}
