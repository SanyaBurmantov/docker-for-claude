import { useEffect, useRef, useState } from 'react'
import MicButton from './MicButton'
import Markdown from './Markdown'
import {
  fetchChatStatus,
  streamChat,
  ChatEngine,
  ChatStatus,
  GeminiMessage,
} from '../services/api'
import { useDrawer } from '../hooks/useDrawer'

interface ChatEntry extends GeminiMessage {
  error?: boolean
}

interface Props {
  /** Given: the chat runs inside that project and may read its files. Omitted: plain talk, no tools. */
  projectId?: string
}

/**
 * Chat drawer for the container agents — Claude (`claude -p`) and GPT (`codex exec`).
 * Same shell as `GeminiPanel`, but the history lives in a Claude session
 * (`sessionId` + `resume`) instead of being resent, so long conversations stay cheap.
 */
export default function ChatPanel({ projectId }: Props) {
  // Ctrl+Shift+K for the global chat, Ctrl+Shift+J for the project one — both
  // reachable while the terminal has focus.
  const hotkey = projectId ? 'j' : 'k'
  const variant = projectId ? 'project' : 'claude'
  const label = projectId ? 'ПРОЕКТ' : 'CLAUDE'

  const { open, close, toggle } = useDrawer(variant)
  const [status, setStatus] = useState<ChatStatus | null>(null)
  const [engine, setEngine] = useState<ChatEngine>('claude')
  const [model, setModel] = useState('')
  const [entries, setEntries] = useState<ChatEntry[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // Names the Claude conversation; a fresh id starts a fresh one.
  const sessionRef = useRef(crypto.randomUUID())
  const startedRef = useRef(false)

  useEffect(() => {
    fetchChatStatus(projectId)
      .then((s) => {
        setStatus(s)
        setModel(s.model)
      })
      .catch(() => setStatus(null))
  }, [projectId])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [entries])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && open) close()
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === hotkey) {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, hotkey])

  useEffect(() => () => abortRef.current?.abort(), [])

  function reset() {
    setEntries([])
    sessionRef.current = crypto.randomUUID()
    startedRef.current = false
  }

  function switchEngine(next: ChatEngine) {
    if (next === engine || streaming) return
    setEngine(next)
    // The two CLIs cannot read each other's history, so the thread starts over.
    reset()
  }

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
      await streamChat(
        projectId,
        {
          messages: history.map(({ role, text }) => ({ role, text })),
          engine,
          model,
          sessionId: sessionRef.current,
          resume: startedRef.current,
        },
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
      // Only a turn that finished left a session on disk to resume.
      startedRef.current = true
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
        className={`chat-tab chat-tab-${variant} ${open ? 'chat-tab-open' : ''}`}
        onClick={() => toggle()}
        title={`${label} (Ctrl+Shift+${hotkey.toUpperCase()})`}
        aria-label={`Toggle ${label} chat panel`}
      >
        <span className="chat-tab-label">{label}</span>
      </button>

      {open && <div className="chat-scrim" onClick={() => close()} />}

      <aside className={`chat-panel chat-panel-${variant} ${open ? 'chat-panel-open' : ''}`} aria-hidden={!open}>
        <header className="chat-header">
          <h3>{label}</h3>
          <div className="chat-header-actions">
            <div className="chat-engines">
              {(['claude', 'codex'] as ChatEngine[]).map((id) => (
                <button
                  key={id}
                  className={`chat-engine ${engine === id ? 'chat-engine-on' : ''}`}
                  onClick={() => switchEngine(id)}
                  disabled={streaming}
                >
                  {id === 'claude' ? 'Claude' : 'GPT'}
                </button>
              ))}
            </div>
            {engine === 'claude' && (
              <select
                className="chat-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={streaming}
              >
                {status?.models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            )}
            <button
              className="chat-icon-btn"
              onClick={reset}
              disabled={streaming || entries.length === 0}
              title="Новый разговор"
            >
              ⌫
            </button>
            <button className="chat-icon-btn" onClick={() => close()} aria-label="Close">
              ×
            </button>
          </div>
        </header>

        <div className="chat-messages" ref={scrollRef}>
          {entries.length === 0 && (
            <p className="chat-empty">
              {projectId
                ? `Разговор про проект «${projectId}» — модель читает его файлы, но не меняет.`
                : 'Просто разговор, без инструментов и без проекта.'}
              <br />
              Enter — отправить, Shift+Enter — перенос строки.
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
          {streaming && engine === 'codex' && (
            <p className="chat-empty">GPT отвечает целиком, без стрима — ждём…</p>
          )}
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
          />
          <div className="chat-composer-actions">
            <MicButton onText={(t) => setInput((v) => (v ? `${v} ${t}` : t))} disabled={streaming} />
            {streaming ? (
              <button className="btn btn-danger btn-sm" onClick={stop}>
                Stop
              </button>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={send} disabled={!input.trim()}>
                Send
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  )
}
