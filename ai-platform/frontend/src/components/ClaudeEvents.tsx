import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react'
import { fetchEvents, ClaudeEvent } from '../services/api'
import { useToast } from './Toast'

type AttentionMap = Record<string, 'waiting' | 'done' | undefined>

const AttentionContext = createContext<AttentionMap>({})

export function ClaudeEventsProvider({ children }: { children: ReactNode }) {
  const toast = useToast()
  const [attention, setAttention] = useState<AttentionMap>({})
  const lastTsRef = useRef<number>(Number(localStorage.getItem('claude-events-ts')) || Date.now())

  useEffect(() => {
    let cancelled = false

    function notify(e: ClaudeEvent) {
      const msg =
        e.type === 'notification'
          ? `${e.project}: Claude ждёт ввода`
          : `${e.project}: Claude закончил`
      toast('info', msg)
      if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
        try {
          new Notification('AI Platform', { body: msg })
        } catch { /* not supported */ }
      }
    }

    async function poll() {
      try {
        const events = await fetchEvents()
        if (cancelled) return

        const fresh = events.filter((e) => e.ts > lastTsRef.current)
        if (fresh.length > 0) {
          lastTsRef.current = Math.max(...fresh.map((e) => e.ts))
          localStorage.setItem('claude-events-ts', String(lastTsRef.current))
          fresh.forEach(notify)
        }

        // events arrive oldest-first, so the last write per project wins
        const map: AttentionMap = {}
        for (const e of events) {
          map[e.project] = e.type === 'notification' ? 'waiting' : 'done'
        }
        setAttention(map)
      } catch {
        // backend unreachable — keep previous state
      }
    }

    poll()
    const interval = setInterval(poll, 5000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <AttentionContext.Provider value={attention}>{children}</AttentionContext.Provider>
}

export function useAttention(): AttentionMap {
  return useContext(AttentionContext)
}
