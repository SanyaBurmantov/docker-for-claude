import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react'
import { ClaudeEvent } from '../services/api'
import { useToast } from './Toast'

type AttentionMap = Record<string, 'waiting' | 'done' | undefined>

const AttentionContext = createContext<AttentionMap>({})

const RECONNECT_MS = 2000

export function ClaudeEventsProvider({ children }: { children: ReactNode }) {
  const toast = useToast()
  const [attention, setAttention] = useState<AttentionMap>({})
  const lastTsRef = useRef<number>(Number(localStorage.getItem('claude-events-ts')) || Date.now())

  useEffect(() => {
    let closed = false
    let socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout>

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

    // Events arrive oldest-first, so the last one per project wins the badge.
    // A snapshot replays what the socket missed; the timestamp decides what is
    // genuinely new, which keeps a reconnect from re-toasting old events.
    function ingest(events: ClaudeEvent[]) {
      if (events.length === 0) return

      const fresh = events.filter((e) => e.ts > lastTsRef.current)
      if (fresh.length > 0) {
        lastTsRef.current = Math.max(...fresh.map((e) => e.ts))
        localStorage.setItem('claude-events-ts', String(lastTsRef.current))
        fresh.forEach(notify)
      }

      setAttention((prev) => {
        const next = { ...prev }
        for (const e of events) {
          next[e.project] = e.type === 'notification' ? 'waiting' : 'done'
        }
        return next
      })
    }

    function connect() {
      if (closed) return

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/events`)
      socket = ws

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'snapshot') ingest(msg.events as ClaudeEvent[])
          else if (msg.type === 'event') ingest([msg.event as ClaudeEvent])
        } catch {
          // a frame we cannot parse tells us nothing — keep the socket
        }
      }

      ws.onerror = () => ws.close()

      ws.onclose = () => {
        if (!closed) reconnectTimer = setTimeout(connect, RECONNECT_MS)
      }
    }

    connect()

    return () => {
      closed = true
      clearTimeout(reconnectTimer)
      socket?.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <AttentionContext.Provider value={attention}>{children}</AttentionContext.Provider>
}

export function useAttention(): AttentionMap {
  return useContext(AttentionContext)
}
