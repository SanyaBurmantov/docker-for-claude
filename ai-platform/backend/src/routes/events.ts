import type { WebSocket } from 'ws';
import { claudeEvents, type ClaudeEvent } from '../services/claudeEvents';

/**
 * Pushes Claude hook events to one browser. The snapshot lets a client that
 * reconnects catch up on what it missed; it decides what is new by timestamp.
 */
export function handleEventsWebSocket(ws: WebSocket): void {
  ws.send(JSON.stringify({ type: 'snapshot', events: claudeEvents.recent() }));

  const onEvent = (event: ClaudeEvent) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'event', event }));
  };

  claudeEvents.on('event', onEvent);
  ws.on('close', () => claudeEvents.off('event', onEvent));
  ws.on('error', () => claudeEvents.off('event', onEvent));
}
