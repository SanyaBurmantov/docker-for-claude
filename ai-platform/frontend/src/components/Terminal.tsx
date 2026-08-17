import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebLinksAddon } from 'xterm-addon-web-links'
import { SearchAddon } from 'xterm-addon-search'
import { useWebSocket } from '../hooks/useWebSocket'
import { getTmuxBuffer } from '../services/api'
import { copyText } from '../services/clipboard'
import 'xterm/css/xterm.css'

/** Подсветка всех совпадений + отметки на overview ruler; цвета — из темы терминала ниже. */
const SEARCH_OPTIONS = {
  decorations: {
    matchBackground: '#1d4a63',
    matchOverviewRuler: '#00f0ff',
    activeMatchBackground: '#00f0ff',
    activeMatchBorder: '#7ff8ff',
    activeMatchColorOverviewRuler: '#ff2ec4',
  },
}

interface TerminalProps {
  sessionId: string | null
  /** Project name — needed to pull the tmux paste buffer (Claude's mouse-mode
   *  selection lands there, not in xterm's own selection). */
  projectId?: string
  /** The parent keeps this mounted across tab switches and hides it with CSS; `fit()` needs
   *  a re-run once it's visible again since it can't measure a `display:none` container. */
  visible?: boolean
  /** Rendered at the left of the toolbar row — lets the parent put its own controls
   *  (e.g. "Новая задача") on the same line as the font/search controls. */
  toolbarExtra?: ReactNode
}

export default function Terminal({ sessionId, projectId, visible = true, toolbarExtra }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [searchQuery, setSearchQuery] = useState('')
  // «3 / 17» рядом с полем поиска; resultIndex === -1 — совпадений больше highlightLimit
  const [searchResults, setSearchResults] = useState({ index: -1, count: 0 })
  const [fullscreen, setFullscreen] = useState(false)
  // Прокручен ли вид в самый низ — от этого зависит плавающая кнопка «вниз»
  const [atBottom, setAtBottom] = useState(true)
  // Clipboard bridge: on a non-secure origin (http via LAN IP) the browser blocks
  // the clipboard API, so terminal copy can't reach the OS buffer. Selected text
  // is mirrored here instead — a real textarea the user can copy from natively.
  const [clip, setClip] = useState('')
  const [fontSize, setFontSize] = useState(() => {
    const saved = Number(localStorage.getItem('terminal-font-size'))
    return saved >= 8 && saved <= 24 ? saved : 13
  })

  const { send, sendResize, isConnected } = useWebSocket(sessionId, (data) => {
    xtermRef.current?.write(data)
  })

  const sendResizeRef = useRef(sendResize)
  sendResizeRef.current = sendResize

  useEffect(() => {
    if (!containerRef.current) return

    const term = new XTerm({
      theme: {
        background: '#04070e',
        foreground: '#c9e4f6',
        cursor: '#00f0ff',
        cursorAccent: '#04070e',
        selectionBackground: 'rgba(0, 240, 255, 0.3)',
        black: '#0d1222',
        red: '#ff3b5c',
        green: '#2bff88',
        yellow: '#e8b04b',
        blue: '#4d9fff',
        magenta: '#ff2ec4',
        cyan: '#00f0ff',
        white: '#d5e5f5',
        brightBlack: '#4a5875',
        brightRed: '#ff7591',
        brightGreen: '#7dffb6',
        brightYellow: '#ffd28a',
        brightBlue: '#8ec2ff',
        brightMagenta: '#ff7ad9',
        brightCyan: '#7ff8ff',
        brightWhite: '#f2faff',
      },
      cursorBlink: true,
      fontSize,
      fontFamily: "'JetBrains Mono', 'Consolas', 'Monaco', 'Courier New', monospace",
      allowTransparency: true,
      scrollback: 10000,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    fitAddonRef.current = fitAddon

    // Clickable URLs (Claude's OAuth links) and Ctrl+F search over the scrollback
    term.loadAddon(new WebLinksAddon())
    const searchAddon = new SearchAddon()
    term.loadAddon(searchAddon)
    searchAddonRef.current = searchAddon

    searchAddon.onDidChangeResults(({ resultIndex, resultCount }) =>
      setSearchResults({ index: resultIndex, count: resultCount })
    )

    const syncAtBottom = () => {
      const buf = term.buffer.active
      setAtBottom(buf.viewportY >= buf.baseY)
    }
    term.onScroll(syncAtBottom)
    // Новый вывод не двигает вид, если пользователь ушёл вверх, — состояние надо пересчитать
    term.onWriteParsed(syncAtBottom)

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      if (e.ctrlKey && !e.shiftKey && e.key === 'f') {
        searchInputRef.current?.focus()
        return false
      }
      // Ctrl+Shift+C/V — the terminal copy/paste convention (plain Ctrl+C is SIGINT).
      if (e.ctrlKey && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        copyText(term.getSelection())
        return false
      }
      if (e.ctrlKey && e.shiftKey && (e.key === 'V' || e.key === 'v')) {
        navigator.clipboard?.readText?.().then((t) => t && term.paste(t)).catch(() => {})
        return false
      }
      return true
    })

    // Mirror any drag-selection into the bridge field below; a plain click clears
    // the selection, so keep the last non-empty text until copied or cleared.
    // Only the non-focus-stealing async clipboard is attempted here — the
    // execCopy fallback would call ta.select() on every drag event, yanking the
    // selection out of the terminal before it finishes. On insecure origins
    // (where async clipboard is unavailable) the field + button is the path.
    term.onSelectionChange(() => {
      const sel = term.getSelection()
      if (!sel) return
      setClip(sel)
      navigator.clipboard?.writeText?.(sel).catch(() => {})
    })

    term.open(containerRef.current)
    term.onData((data) => {
      send(data)
    })
    term.onResize(({ cols, rows }) => {
      sendResizeRef.current(cols, rows)
    })

    setTimeout(() => fitAddon.fit(), 50)
    term.write('Claude AI Terminal\r\n')
    if (!sessionId) {
      term.write('\x1b[33mSession not started. Click "Start Claude" to begin.\x1b[0m\r\n')
    }

    xtermRef.current = term

    const handleResize = () => fitAddon.fit()
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      term.dispose()
      xtermRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!xtermRef.current) return
    xtermRef.current.clear()
    if (!sessionId) {
      xtermRef.current.write('\x1b[33mSession not started. Click "Start Claude" to begin.\x1b[0m\r\n')
    } else if (isConnected) {
      xtermRef.current.write('\x1b[32mConnected to Claude session.\x1b[0m\r\n')
      // Sync the server-side pty with the actual terminal size
      fitAddonRef.current?.fit()
      const term = xtermRef.current
      sendResizeRef.current(term.cols, term.rows)
    }
  }, [sessionId, isConnected])

  useEffect(() => {
    fitAddonRef.current?.fit()
  }, [sessionId])

  useEffect(() => {
    if (!visible) return
    fitAddonRef.current?.fit()
    const term = xtermRef.current
    if (term) sendResizeRef.current(term.cols, term.rows)
  }, [visible])

  // Смена размера контейнера — CSS уже применён к моменту эффекта, можно мерить
  useEffect(() => {
    fitAddonRef.current?.fit()
    const term = xtermRef.current
    if (term) sendResizeRef.current(term.cols, term.rows)
  }, [fullscreen])

  useEffect(() => {
    const term = xtermRef.current
    if (!term) return
    term.options.fontSize = fontSize
    fitAddonRef.current?.fit()
    localStorage.setItem('terminal-font-size', String(fontSize))
  }, [fontSize])

  async function pullTmuxBuffer() {
    if (!projectId) return
    try {
      const { text } = await getTmuxBuffer(projectId)
      setClip(text)
    } catch (err) {
      setClip(`Не удалось прочитать буфер tmux: ${err}`)
    }
  }

  function runSearch(backwards: boolean) {
    if (!searchQuery) return
    if (backwards) {
      searchAddonRef.current?.findPrevious(searchQuery, SEARCH_OPTIONS)
    } else {
      searchAddonRef.current?.findNext(searchQuery, SEARCH_OPTIONS)
    }
  }

  /** Весь scrollback текстом — выделить мышью 10000 строк нереально. */
  function dumpBuffer() {
    const term = xtermRef.current
    if (!term) return
    const buf = term.buffer.active
    const lines: string[] = []
    for (let i = 0; i < buf.length; i++) {
      lines.push(buf.getLine(i)?.translateToString(true) ?? '')
    }
    // Хвост из пустых строк ниже курсора только мешает
    while (lines.length && !lines[lines.length - 1]) lines.pop()
    setClip(lines.join('\n'))
  }

  return (
    <div className={fullscreen ? 'terminal-wrap terminal-wrap-fullscreen' : 'terminal-wrap'}>
      <div className="terminal-toolbar">
        {toolbarExtra}
        <div className="terminal-font-controls">
          <button
            className="icon-btn"
            title="Smaller font"
            onClick={() => setFontSize((s) => Math.max(8, s - 1))}
          >
            A−
          </button>
          <button
            className="icon-btn"
            title="Larger font"
            onClick={() => setFontSize((s) => Math.min(24, s + 1))}
          >
            A＋
          </button>
        </div>
        <div className="terminal-scroll-controls">
          <button
            className="icon-btn"
            title="В начало вывода"
            onClick={() => xtermRef.current?.scrollToTop()}
          >
            ↑
          </button>
          <button
            className="icon-btn"
            title="В конец вывода"
            onClick={() => xtermRef.current?.scrollToBottom()}
          >
            ↓
          </button>
          <button
            className="icon-btn"
            title={fullscreen ? 'Свернуть терминал' : 'Терминал на весь экран'}
            onClick={() => setFullscreen((f) => !f)}
          >
            {fullscreen ? '⤡' : '⤢'}
          </button>
        </div>
        <div className="terminal-search-box">
          <input
            ref={searchInputRef}
            type="text"
            className="terminal-search"
            placeholder="Search output (Ctrl+F)…  Enter — next, Shift+Enter — prev"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runSearch(e.shiftKey)
              if (e.key === 'Escape') {
                setSearchQuery('')
                searchAddonRef.current?.clearDecorations()
                setSearchResults({ index: -1, count: 0 })
                xtermRef.current?.focus()
              }
            }}
          />
          {searchQuery && (
            <span className="terminal-search-count">
              {searchResults.count === 0
                ? 'нет'
                : searchResults.index < 0
                  ? `>${searchResults.count}`
                  : `${searchResults.index + 1} / ${searchResults.count}`}
            </span>
          )}
        </div>
      </div>
      <div className="terminal-container" ref={containerRef}>
        {!sessionId && (
          <div className="terminal-placeholder">
            Session not started
          </div>
        )}
        {!atBottom && (
          <button
            className="terminal-jump-bottom"
            title="К последнему выводу"
            onClick={() => xtermRef.current?.scrollToBottom()}
          >
            ↓ вниз
          </button>
        )}
      </div>

      <div className="terminal-clip">
        <textarea
          className="terminal-clip-field"
          placeholder="Выделенное в терминале появляется здесь — отсюда можно скопировать и вставить в браузере. В Claude выдели мышью и жми «Из буфера tmux»."
          value={clip}
          onChange={(e) => setClip(e.target.value)}
        />
        <div className="terminal-clip-actions">
          {projectId && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={pullTmuxBuffer}
              title="Забрать текст, выделенный мышью в Claude (он попадает в буфер tmux, а не в выделение xterm)"
            >
              Из буфера tmux
            </button>
          )}
          <button
            className="btn btn-secondary btn-sm"
            onClick={dumpBuffer}
            title="Переложить сюда весь вывод терминала, включая прокрученный"
          >
            Весь вывод
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => copyText(clip)} disabled={!clip}>
            Копировать
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => setClip('')} disabled={!clip}>
            Очистить
          </button>
        </div>
      </div>
    </div>
  )
}
