import { useEffect, useState } from 'react'
import { fetchHeadroom, HeadroomState } from '../services/api'

const POLL_MS = 4000

/** 12345 → "12.3k", 1200000 → "1.2M" — compact enough for the chip. */
function compact(n: number): string {
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return String(n)
}

function formatValue(v: unknown): string {
  if (typeof v === 'number') return v.toLocaleString('en-US')
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (v === null) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/**
 * The /stats shape is not contracted, so instead of naming a field we scan one
 * level for a numeric "…saved…tokens…" (or any "saved") number to headline on the
 * chip. Returns null when nothing plausible is there — the chip then just shows a
 * status dot.
 */
function headlineSaved(stats: Record<string, unknown>): number | null {
  const nums = Object.entries(stats).filter(([, v]) => typeof v === 'number') as [string, number][]
  const tokenSaved = nums.find(([k]) => /saved/i.test(k) && /tokens?/i.test(k))
  if (tokenSaved) return tokenSaved[1]
  const anySaved = nums.find(([k]) => /saved/i.test(k))
  return anySaved ? anySaved[1] : null
}

/**
 * Toolbar-adjacent chip plus a slide-out panel showing the Headroom proxy's live
 * compression stats. Rendered only while a Claude Code + Headroom session runs
 * (`active`), and polls just for as long as it is on screen.
 */
export default function HeadroomPanel({ active }: { active: boolean }) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<HeadroomState | null>(null)

  useEffect(() => {
    if (!active) {
      setState(null)
      setOpen(false)
      return
    }
    let cancelled = false
    const tick = () => {
      fetchHeadroom()
        .then((s) => !cancelled && setState(s))
        .catch(() => !cancelled && setState(null))
    }
    tick()
    const timer = setInterval(tick, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [active])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && open) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!active) return null

  // down → proxy not answering; up → answering but no /stats (base package);
  // ok → serving stats we can show.
  const status: 'down' | 'up' | 'ok' = !state?.running ? 'down' : state.reachable ? 'ok' : 'up'
  const saved = state?.stats ? headlineSaved(state.stats) : null
  const chipLabel = status === 'ok' && saved !== null ? `HR ${compact(saved)}` : 'HR'
  const entries = state?.stats ? Object.entries(state.stats) : []

  return (
    <>
      <button
        className={`hr-chip hr-chip-${status} ${open ? 'hr-chip-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Headroom — сжатие контекста"
      >
        <span className={`hr-dot hr-dot-${status}`} />
        {chipLabel}
      </button>

      {open && <div className="hr-scrim" onClick={() => setOpen(false)} />}

      <aside className={`hr-panel ${open ? 'hr-panel-open' : ''}`} aria-hidden={!open}>
        <header className="hr-header">
          <h3>HEADROOM</h3>
          <button className="hr-close" onClick={() => setOpen(false)} aria-label="Close">
            ×
          </button>
        </header>

        {status === 'down' && (
          <div className="hr-note hr-note-warn">
            Прокси не отвечает на :8787. Сессия Headroom не запущена или прокси упал.
          </div>
        )}
        {status === 'up' && (
          <div className="hr-note hr-note-warn">
            Прокси работает, но /stats недоступен — в базовом пакете headroom-ai этого
            эндпоинта нет. Диагностика: <code>headroom doctor</code>.
          </div>
        )}

        {status === 'ok' && (
          <div className="hr-stats">
            {entries.length === 0 && <p className="hr-empty">Прокси не отдал ни одного поля.</p>}
            {entries.map(([k, v]) => (
              <div key={k} className="hr-row">
                <span className="hr-k">{k}</span>
                <span className="hr-v">{formatValue(v)}</span>
              </div>
            ))}
          </div>
        )}

        <footer className="hr-footer">Обновляется каждые {POLL_MS / 1000} с</footer>
      </aside>
    </>
  )
}
