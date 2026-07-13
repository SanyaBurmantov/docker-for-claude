import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebLinksAddon } from 'xterm-addon-web-links'
import { SearchAddon } from 'xterm-addon-search'
import { useWebSocket } from '../hooks/useWebSocket'
import 'xterm/css/xterm.css'

interface TerminalProps {
  sessionId: string | null
  /** The parent keeps this mounted across tab switches and hides it with CSS; `fit()` needs
   *  a re-run once it's visible again since it can't measure a `display:none` container. */
  visible?: boolean
}

export default function Terminal({ sessionId, visible = true }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [searchQuery, setSearchQuery] = useState('')
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

    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && e.ctrlKey && !e.shiftKey && e.key === 'f') {
        searchInputRef.current?.focus()
        return false
      }
      return true
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

  useEffect(() => {
    const term = xtermRef.current
    if (!term) return
    term.options.fontSize = fontSize
    fitAddonRef.current?.fit()
    localStorage.setItem('terminal-font-size', String(fontSize))
  }, [fontSize])

  function runSearch(backwards: boolean) {
    if (!searchQuery) return
    if (backwards) {
      searchAddonRef.current?.findPrevious(searchQuery)
    } else {
      searchAddonRef.current?.findNext(searchQuery)
    }
  }

  return (
    <div>
      <div className="terminal-toolbar">
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
              xtermRef.current?.focus()
            }
          }}
        />
      </div>
      <div className="terminal-container" ref={containerRef}>
        {!sessionId && (
          <div className="terminal-placeholder">
            Session not started
          </div>
        )}
      </div>
    </div>
  )
}
