import { useEffect, useRef, useState, useCallback } from 'react'

interface UseWebSocketResult {
  send: (data: string) => void
  isConnected: boolean
  error: string | null
}

type MessageHandler = (data: string) => void

export function useWebSocket(
  sessionId: string | null,
  onMessage: MessageHandler
): UseWebSocketResult {
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const onMessageRef = useRef<MessageHandler>(onMessage)

  onMessageRef.current = onMessage

  useEffect(() => {
    if (!sessionId) {
      setIsConnected(false)
      setError(null)
      return
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const url = `${protocol}//${host}/ws/terminal/${sessionId}`

    let reconnectTimer: ReturnType<typeof setTimeout>
    let closed = false

    function connect() {
      if (closed) return

      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        setIsConnected(true)
        setError(null)
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'output' || msg.type === 'error') {
            onMessageRef.current(msg.data)
          }
        } catch {
          onMessageRef.current(event.data)
        }
      }

      ws.onerror = () => {
        setError('WebSocket connection error')
        setIsConnected(false)
      }

      ws.onclose = () => {
        setIsConnected(false)
        if (!closed) {
          reconnectTimer = setTimeout(connect, 2000)
        }
      }
    }

    connect()

    return () => {
      closed = true
      clearTimeout(reconnectTimer)
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [sessionId])

  const send = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'input', data }))
    }
  }, [])

  return { send, isConnected, error }
}
