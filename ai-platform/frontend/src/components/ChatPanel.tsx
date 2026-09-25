import { useEffect, useRef, useState } from 'react'
import ChatDrawer from './ChatDrawer'
import {
  fetchChatStatus,
  fetchGeminiStatus,
  streamChat,
  streamGeminiChat,
  AiProvider,
  ChatEngine,
  ChatStatus,
  GeminiStatus,
} from '../services/api'
import { useChat } from '../hooks/useChat'
import { useDrawer } from '../hooks/useDrawer'
import { useLanguage } from '../i18n'

interface Props {
  /** Given: the chat runs inside that project and may read its files. Omitted: plain talk, no tools. */
  projectId?: string
  /** Project pages own this selection so the chat and Git tools use the same provider. */
  provider?: AiProvider
}

const ENGINES: { id: ChatEngine; label: string }[] = [
  { id: 'gemini', label: 'Gemini' },
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'GPT' },
]

/**
 * Chat drawer for the selected AI provider. Global text chat also offers the
 * direct Gemini API; project chat keeps using the provider selected by its page.
 *
 * Ctrl+Shift+K for the global chat, Ctrl+Shift+J for the project one.
 */
export default function ChatPanel({ projectId, provider }: Props) {
  const { t } = useLanguage()
  const drawer = useDrawer(projectId ? 'project' : 'chat')
  const [status, setStatus] = useState<ChatStatus | null>(null)
  const [geminiStatus, setGeminiStatus] = useState<GeminiStatus | null>(null)
  const [localEngine, setLocalEngine] = useState<ChatEngine>('claude')
  const [model, setModel] = useState('')
  const [geminiModel, setGeminiModel] = useState('')
  const engine = provider ?? localEngine

  // Names the Claude conversation; a fresh id starts a fresh one.
  const sessionRef = useRef(crypto.randomUUID())
  const startedRef = useRef(false)

  const chat = useChat(async (messages, onChunk, signal) => {
    if (!projectId && engine === 'gemini') {
      await streamGeminiChat(messages, geminiModel, onChunk, signal)
      return
    }

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

  useEffect(() => {
    if (projectId) return
    fetchGeminiStatus()
      .then((s) => {
        setGeminiStatus(s)
        setGeminiModel(s.model)
      })
      .catch(() => setGeminiStatus(null))
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
      label={projectId ? t('chat.projectLabel') : t('chat.globalLabel')}
      hotkey={projectId ? 'j' : 'k'}
      chat={chat}
      streamNote={(engine === 'codex' || engine === 'opencode') && t('chat.waitWhole')}
      disabled={!projectId && engine === 'gemini' && !geminiStatus?.configured}
      hint={
        <>
          {projectId
            ? engine === 'gemini'
              ? t('chat.projectGeminiHint', { project: projectId })
              : t('chat.projectHint', { project: projectId })
            : t('chat.globalHint')}
          <br />
          {t('chat.controlsHint')}
        </>
      }
      notice={
        !projectId && engine === 'gemini' ? (
          <>
            {geminiStatus && !geminiStatus.configured && (
              <div className="chat-warning">{t('chat.geminiKeyMissing')}</div>
            )}
            {geminiStatus?.configured && !geminiStatus.viaProxy && (
              <div className="chat-warning">{t('chat.proxyMissing')}</div>
            )}
          </>
        ) : undefined
      }
      headerActions={
        <>
          {!provider && (
            <select
              className="chat-provider"
              value={engine}
              onChange={(e) => switchEngine(e.target.value as ChatEngine)}
              disabled={chat.streaming}
              aria-label={t('chat.providerAria')}
            >
              {ENGINES.map(({ id, label }) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
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
          {!projectId && engine === 'gemini' && (
            <select
              className="chat-model"
              value={geminiModel}
              onChange={(e) => setGeminiModel(e.target.value)}
              disabled={chat.streaming || !geminiStatus?.configured}
            >
              {geminiStatus?.models.map((m) => (
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
            title={t('chat.newConversation')}
          >
            ⌫
          </button>
        </>
      }
    />
  )
}
