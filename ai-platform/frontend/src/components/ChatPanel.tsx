import { useEffect, useRef, useState } from 'react'
import ChatDrawer from './ChatDrawer'
import { fetchChatStatus, streamChat, AiProvider, ChatEngine, ChatStatus } from '../services/api'
import { useChat } from '../hooks/useChat'
import { useDrawer } from '../hooks/useDrawer'

interface Props {
  /** Given: the chat runs inside that project and may read its files. Omitted: plain talk, no tools. */
  projectId?: string
  /** Project pages own this selection so the chat and Git tools use the same provider. */
  provider?: AiProvider
}

const ENGINES: { id: ChatEngine; label: string }[] = [
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'GPT' },
]

/**
 * Chat drawer for the selected AI provider. Claude keeps its native session;
 * stateless providers receive the visible transcript from the backend.
 *
 * Ctrl+Shift+K for the global chat, Ctrl+Shift+J for the project one — both
 * reachable while the terminal has focus.
 */
export default function ChatPanel({ projectId, provider }: Props) {
  const drawer = useDrawer(projectId ? 'project' : 'claude')
  const [status, setStatus] = useState<ChatStatus | null>(null)
  const [localEngine, setLocalEngine] = useState<ChatEngine>('claude')
  const [model, setModel] = useState('')
  const engine = provider ?? localEngine

  // Names the Claude conversation; a fresh id starts a fresh one.
  const sessionRef = useRef(crypto.randomUUID())
  const startedRef = useRef(false)

  const chat = useChat(async (messages, onChunk, signal) => {
    await streamChat(
      projectId,
      { messages, engine, model, sessionId: sessionRef.current, resume: startedRef.current },
      onChunk,
      signal
    )
    // Only a turn that finished left a session on disk to resume.
    startedRef.current = true
  })

  useEffect(() => {
    fetchChatStatus(projectId)
      .then((s) => {
        setStatus(s)
        setModel(s.model)
      })
      .catch(() => setStatus(null))
  }, [projectId])

  function reset() {
    chat.clear()
    sessionRef.current = crypto.randomUUID()
    startedRef.current = false
  }

  function switchEngine(next: ChatEngine) {
    if (next === engine || chat.streaming) return
    setLocalEngine(next)
    // Providers cannot read each other's history, so the thread starts over.
    reset()
  }

  return (
    <ChatDrawer
      drawer={drawer}
      label={projectId ? 'ПРОЕКТ' : 'CLAUDE'}
      hotkey={projectId ? 'j' : 'k'}
      chat={chat}
      streamNote={engine === 'codex' && 'GPT отвечает целиком, без стрима — ждём…'}
      hint={
        <>
          {projectId
            ? engine === 'gemini'
              ? `Разговор про проект «${projectId}» — Gemini отвечает без доступа к его файлам.`
              : `Разговор про проект «${projectId}» — модель читает его файлы, но не меняет.`
            : 'Просто разговор, без инструментов и без проекта.'}
          <br />
          Enter — отправить, Shift+Enter — перенос строки.
        </>
      }
      headerActions={
        <>
          {!provider && (
            <div className="chat-engines">
              {ENGINES.map(({ id, label }) => (
                <button
                  key={id}
                  className={`chat-engine ${engine === id ? 'chat-engine-on' : ''}`}
                  onClick={() => switchEngine(id)}
                  disabled={chat.streaming}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {engine === 'claude' && (
            <select
              className="chat-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={chat.streaming}
            >
              {status?.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )}
          <button
            className="drawer-icon-btn"
            onClick={reset}
            disabled={chat.streaming || chat.entries.length === 0}
            title="Новый разговор"
          >
            ⌫
          </button>
        </>
      }
    />
  )
}
