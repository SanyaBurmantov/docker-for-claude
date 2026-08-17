import { useEffect, useRef, useState } from 'react'
import MicButton from './MicButton'
import Markdown from './Markdown'
import {
  fetchGeminiStatus,
  streamGeminiChat,
  GeminiMessage,
  GeminiStatus,
} from '../services/api'
import { useDrawer } from '../hooks/useDrawer'

interface ChatEntry extends GeminiMessage {
  error?: boolean
}

export default function GeminiPanel() {
  const { open, close, toggle } = useDrawer('gemini')
  const [status, setStatus] = useState<GeminiStatus | null>(null)
  const [model, setModel] = useState('')
  const [entries, setEntries] = useState<ChatEntry[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    fetchGeminiStatus()
      .then((s) => {
        setStatus(s)
        setModel(s.model)
      })
      .catch(() => setStatus(null))
  }, [])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [entries])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && open) close()
      // Ctrl+Shift+G toggles from anywhere, including inside the terminal
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'g') {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => () => abortRef.current?.abort(), [])

  async function send() {
    const text = input.trim()
    if (!text || streaming) return

    const history: ChatEntry[] = [...entries.filter((e) => !e.error), { role: 'user', text }]
    setEntries([...history, { role: 'model', text: '' }])
    setInput('')
    setStreaming(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      await streamGeminiChat(
        history.map(({ role, text }) => ({ role, text })),
        model,
        (chunk) => {
          setEntries((prev) => {
            const next = [...prev]
            const last = next[next.length - 1]
            next[next.length - 1] = { ...last, text: last.text + chunk }
            return next
          })
        },
        controller.signal
      )
    } catch (err) {
      if (controller.signal.aborted) return
      setEntries((prev) => {
        const next = [...prev]
        next[next.length - 1] = { role: 'model', text: (err as Error).message, error: true }
        return next
      })
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }

  function onInputKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  function stop() {
    abortRef.current?.abort()
    setStreaming(false)
  }

  return (
    <>
      <button
        className={`chat-tab chat-tab-gemini ${open ? 'chat-tab-open' : ''}`}
        onClick={() => toggle()}
        title="Gemini (Ctrl+Shift+G)"
        aria-label="Toggle Gemini panel"
      >
        <span className="chat-tab-label">GEMINI</span>
      </button>

      {open && <div className="chat-scrim" onClick={() => close()} />}

      <aside className={`chat-panel chat-panel-gemini ${open ? 'chat-panel-open' : ''}`} aria-hidden={!open}>
        <header className="chat-header">
          <h3>GEMINI</h3>
          <div className="chat-header-actions">
            <select
              className="chat-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={streaming || !status?.configured}
            >
              {status?.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <button
              className="chat-icon-btn"
              onClick={() => setEntries([])}
              disabled={streaming || entries.length === 0}
              title="Clear conversation"
            >
              ⌫
            </button>
            <button className="chat-icon-btn" onClick={() => close()} aria-label="Close">
              ×
            </button>
          </div>
        </header>

        {status && !status.configured && (
          <div className="chat-warning">
            GEMINI_API_KEY не задан в .env — панель работать не будет.
          </div>
        )}
        {status?.configured && !status.viaProxy && (
          <div className="chat-warning">
            Прокси не настроен: backend пойдёт в Google напрямую.
          </div>
        )}

        <div className="chat-messages" ref={scrollRef}>
          {entries.length === 0 && (
            <p className="chat-empty">
              Спроси что угодно. Enter — отправить, Shift+Enter — перенос строки.
            </p>
          )}
          {entries.map((entry, i) => (
            <div
              key={i}
              className={`chat-msg chat-msg-${entry.role} ${entry.error ? 'chat-msg-error' : ''}`}
            >
              {entry.role === 'model' && !entry.error ? <Markdown text={entry.text} /> : entry.text}
              {streaming && i === entries.length - 1 && entry.role === 'model' && (
                <span className="chat-caret" />
              )}
            </div>
          ))}
        </div>

        <div className="chat-composer">
          <textarea
            ref={inputRef}
            className="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Сообщение…"
            rows={3}
            disabled={!status?.configured}
          />
          <div className="chat-composer-actions">
            <MicButton onText={(t) => setInput((v) => (v ? `${v} ${t}` : t))} disabled={streaming} />
            {streaming ? (
              <button className="btn btn-danger btn-sm" onClick={stop}>
                Stop
              </button>
            ) : (
              <button
                className="btn btn-primary btn-sm"
                onClick={send}
                disabled={!input.trim() || !status?.configured}
              >
                Send
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  )
}
