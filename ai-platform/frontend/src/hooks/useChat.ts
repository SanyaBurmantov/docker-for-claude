import { useEffect, useRef, useState } from 'react'
import { GeminiMessage } from '../services/api'

export interface ChatEntry extends GeminiMessage {
  error?: boolean
}

/** Streams one turn: gets the history to send, calls `onChunk` as text arrives. */
export type ChatSender = (
  history: GeminiMessage[],
  onChunk: (chunk: string) => void,
  signal: AbortSignal
) => Promise<void>

function patchLast(entries: ChatEntry[], patch: (last: ChatEntry) => ChatEntry): ChatEntry[] {
  const next = [...entries]
  next[next.length - 1] = patch(next[next.length - 1])
  return next
}

/**
 * The conversation behind a chat drawer: what has been said, what is being typed,
 * and the one turn that may be streaming. Every drawer talks to a different
 * backend, so the request itself stays with the caller — `sender` is all that differs.
 */
export function useChat(sender: ChatSender) {
  const [entries, setEntries] = useState<ChatEntry[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  async function send() {
    const text = input.trim()
    if (!text || streaming) return

    // A failed turn is not context — the model never saw it, so it is not resent.
    const history: ChatEntry[] = [...entries.filter((e) => !e.error), { role: 'user', text }]
    setEntries([...history, { role: 'model', text: '' }])
    setInput('')
    setStreaming(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      await sender(
        history.map(({ role, text }) => ({ role, text })),
        (chunk) => setEntries((prev) => patchLast(prev, (last) => ({ ...last, text: last.text + chunk }))),
        controller.signal
      )
    } catch (err) {
      if (controller.signal.aborted) return
      setEntries((prev) =>
        patchLast(prev, () => ({ role: 'model', text: (err as Error).message, error: true }))
      )
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }

  return {
    entries,
    input,
    setInput,
    streaming,
    send,
    stop: () => {
      abortRef.current?.abort()
      setStreaming(false)
    },
    clear: () => setEntries([]),
  }
}

export type Chat = ReturnType<typeof useChat>
