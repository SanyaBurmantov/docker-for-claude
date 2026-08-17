import { useEffect, useState } from 'react'
import ChatDrawer from './ChatDrawer'
import { fetchGeminiStatus, streamGeminiChat, GeminiStatus } from '../services/api'
import { useChat } from '../hooks/useChat'
import { useDrawer } from '../hooks/useDrawer'

/** Gemini chat: plain text in, text out — no project and no tools. */
export default function GeminiPanel() {
  const drawer = useDrawer('gemini')
  const [status, setStatus] = useState<GeminiStatus | null>(null)
  const [model, setModel] = useState('')

  const chat = useChat((history, onChunk, signal) =>
    streamGeminiChat(history, model, onChunk, signal)
  )

  useEffect(() => {
    fetchGeminiStatus()
      .then((s) => {
        setStatus(s)
        setModel(s.model)
      })
      .catch(() => setStatus(null))
  }, [])

  return (
    <ChatDrawer
      drawer={drawer}
      label="GEMINI"
      hotkey="g"
      chat={chat}
      disabled={!status?.configured}
      hint="Спроси что угодно. Enter — отправить, Shift+Enter — перенос строки."
      headerActions={
        <>
          <select
            className="chat-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={chat.streaming || !status?.configured}
          >
            {status?.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <button
            className="drawer-icon-btn"
            onClick={chat.clear}
            disabled={chat.streaming || chat.entries.length === 0}
            title="Новый разговор"
          >
            ⌫
          </button>
        </>
      }
      notice={
        <>
          {status && !status.configured && (
            <div className="chat-warning">GEMINI_API_KEY не задан в .env — панель работать не будет.</div>
          )}
          {status?.configured && !status.viaProxy && (
            <div className="chat-warning">Прокси не настроен: backend пойдёт в Google напрямую.</div>
          )}
        </>
      }
    />
  )
}
