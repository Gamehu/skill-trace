import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ServerEvent } from '../../../server/types.ts'

export interface LiveState {
  /** Bumped whenever the server reports a transcript or skill change; data hooks refetch on change. */
  version: number
  connected: boolean
  /** When the server last reported a change (ms), or null if nothing changed since the page opened. */
  updatedAt: number | null
}

export const LiveContext = createContext<LiveState>({ version: 0, connected: false, updatedAt: null })

/**
 * Subscribes to the server's change stream, reconnecting after drops.
 *
 * @returns The live connection state to provide through {@link LiveContext}.
 */
export function useLiveConnection(): LiveState {
  const [state, setState] = useState<LiveState>({ version: 0, connected: false, updatedAt: null })
  useEffect(() => {
    let es: EventSource | null = null
    let retry: ReturnType<typeof setTimeout>
    const connect = () => {
      es = new EventSource('/api/events')
      es.onopen = () => setState((s) => ({ ...s, connected: true }))
      es.onmessage = (msg) => {
        const e = JSON.parse(msg.data) as ServerEvent
        if (e.type === 'update') setState((s) => ({ ...s, version: s.version + 1, updatedAt: Date.now() }))
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

export interface UseApiResult<T> {
  data: T | undefined
  error: string | null
  loading: boolean
}

/**
 * Fetches a JSON (or text) API resource and refetches it on every live update.
 *
 * @param path - API path, or null to skip fetching.
 * @returns The latest data, error message and loading flag.
 */
export function useApi<T>(path: string | null): UseApiResult<T> {
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

/**
 * Re-renders every `ms` while `active`, for live durations.
 *
 * @returns The current timestamp in milliseconds.
 */
export function useNow(active: boolean, ms = 1000): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [active, ms])
  return now
}
