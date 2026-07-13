import { useState, useEffect } from 'react'
import { getServerTime } from '../services/api'

/** How often the server is asked again. Enough to correct any drift between polls. */
const SYNC_MS = 150_000

/**
 * Polling alone would leave the header up to SYNC_MS behind, so between polls the
 * clock runs off the local one, offset by the skew measured at the last sync. Only
 * minutes are shown, so ticking just has to land inside the minute it crosses.
 */
const TICK_MS = 15_000

interface Sync {
  /** Server clock minus local clock, in ms. Network latency lands well under a minute. */
  skewMs: number
  timeZone: string
}

/**
 * Its own component so the tick re-renders the clock alone and not the page under it.
 */
export default function Clock() {
  const [sync, setSync] = useState<Sync | null>(null)
  const [, tick] = useState(0)

  useEffect(() => {
    let cancelled = false

    const resync = async () => {
      try {
        const { iso, timeZone } = await getServerTime()
        if (!cancelled) setSync({ skewMs: Date.parse(iso) - Date.now(), timeZone })
      } catch {
        /* keep the last skew: a dropped poll should not blank the header */
      }
    }

    resync()
    const timer = setInterval(resync, SYNC_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), TICK_MS)
    return () => clearInterval(timer)
  }, [])

  if (!sync) {
    return <time className="navbar-clock">--:--</time>
  }

  const now = new Date(Date.now() + sync.skewMs)
  const opts = { timeZone: sync.timeZone } as const

  return (
    <time
      className="navbar-clock"
      dateTime={now.toISOString()}
      title={`${now.toLocaleDateString('ru-RU', { dateStyle: 'full', ...opts })} · ${sync.timeZone}`}
    >
      {now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', ...opts })}
    </time>
  )
}
