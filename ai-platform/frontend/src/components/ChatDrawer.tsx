import { ReactNode, useEffect, useRef } from 'react'
import Drawer from './Drawer'
import Markdown from './Markdown'
import MicButton, { appendTo } from './MicButton'
import { Chat } from '../hooks/useChat'
import { DrawerState } from '../hooks/useDrawer'

interface ChatDrawerProps {
  drawer: DrawerState
  label: string
  hotkey: string
  chat: Chat
  /** Empty-state text: says what this particular assistant is for. */
  hint: ReactNode
  headerActions?: ReactNode
  /** Above the messages — misconfiguration warnings and the like. */
  notice?: ReactNode
  /** Under the messages while a turn is streaming. */
  streamNote?: ReactNode
  /** Nothing to talk to (no API key): the composer stays read-only. */
  disabled?: boolean
}

/**
 * A drawer holding a conversation: message list plus composer. Shared by every
 * assistant panel — they differ only in who answers, which is `chat`'s business.
 * User text and errors show as they are; a model's answer is markdown, so it is
 * rendered.
 */
export default function ChatDrawer({
  drawer,
  label,
  hotkey,
  chat,
  hint,
  headerActions,
  notice,
  streamNote,
  disabled,
}: ChatDrawerProps) {
  const { entries, input, setInput, streaming, send, stop } = chat
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [entries])

  useEffect(() => {
    if (drawer.open) inputRef.current?.focus()
  }, [drawer.open])

  return (
    <Drawer drawer={drawer} label={label} hotkey={hotkey} headerActions={headerActions}>
      {notice}

      <div className="chat-messages" ref={scrollRef}>
        {entries.length === 0 && <p className="chat-empty">{hint}</p>}
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
        {streaming && streamNote && <p className="chat-empty">{streamNote}</p>}
      </div>

      <div className="chat-composer">
        <textarea
          ref={inputRef}
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder="Сообщение…"
          rows={3}
          disabled={disabled}
        />
        <div className="chat-composer-actions">
          <MicButton onText={appendTo(setInput)} disabled={streaming} />
          {streaming ? (
            <button className="btn btn-danger btn-sm" onClick={stop}>
              Stop
            </button>
          ) : (
            <button
              className="btn btn-primary btn-sm"
              onClick={send}
              disabled={!input.trim() || disabled}
            >
              Send
            </button>
          )}
        </div>
      </div>
    </Drawer>
  )
}
