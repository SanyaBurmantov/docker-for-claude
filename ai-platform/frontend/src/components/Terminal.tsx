import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { useWebSocket } from '../hooks/useWebSocket'
import 'xterm/css/xterm.css'

interface TerminalProps {
  sessionId: string | null
}

export default function Terminal({ sessionId }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  const { send, isConnected } = useWebSocket(sessionId, (data) => {
    xtermRef.current?.write(data)
  })

  useEffect(() => {
    if (!containerRef.current) return

    const term = new XTerm({
      theme: {
        background: '#0d0d1a',
        foreground: '#00ff41',
        cursor: '#00ff41',
        black: '#000000',
        red: '#ff5555',
        green: '#00ff41',
        yellow: '#ffd700',
        blue: '#7c83ff',
        magenta: '#ff79c6',
        cyan: '#8be9fd',
        white: '#f8f8f2',
        brightBlack: '#6272a4',
        brightRed: '#ff6e6e',
        brightGreen: '#69ff94',
        brightYellow: '#ffffa5',
        brightBlue: '#a0a8ff',
        brightMagenta: '#ff92df',
        brightCyan: '#a4ffff',
        brightWhite: '#ffffff',
      },
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace",
      allowTransparency: true,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    fitAddonRef.current = fitAddon

    term.open(containerRef.current)
    term.onData((data) => {
      send(data)
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
    }
  }, [sessionId, isConnected])

  useEffect(() => {
    fitAddonRef.current?.fit()
  }, [sessionId])

  return (
    <div className="terminal-container" ref={containerRef}>
      {!sessionId && (
        <div className="terminal-placeholder">
          Session not started
        </div>
      )}
    </div>
  )
}
