import type { WebSocket } from 'ws';
import * as pty from 'node-pty';
import { UTF8_EXEC_ENV, EXEC_USER_ARGS } from '../services/dockerService';
import { paneTarget } from '../services/paneTarget';

interface TerminalMessage {
  type: 'input' | 'resize';
  data?: string;
  cols?: number;
  rows?: number;
}

const CONTAINER_NAME = process.env.CLAUDE_CONTAINER || 'ai-claude';

export function handleTerminalWebSocket(ws: WebSocket, sessionId: string): void {
  const target = paneTarget(sessionId);
  if (!target) {
    ws.send(JSON.stringify({ type: 'error', data: 'Invalid session id' }));
    ws.close();
    return;
  }

  // Shell tab: attach-or-create a persistent tmux shell session in the project dir.
  // Everything else: attach to the session the API started — or, once it is gone,
  // drop into a plain shell in the same directory, where its output still lives.
  const shellCmd = target.create
    ? `cd "${target.cwd}" 2>/dev/null; exec tmux new-session -A -s ${target.session}`
    : `cd "${target.cwd}" 2>/dev/null; tmux attach-session -t ${target.session} 2>/dev/null || exec bash -i`;

  let term: pty.IPty | null = null;

  try {
    // UTF8_EXEC_ENV is what lets readline echo typed Cyrillic; in the C locale bash
    // mangles the leading byte of every multi-byte character.
    term = pty.spawn('docker', ['exec', '-it', ...EXEC_USER_ARGS, ...UTF8_EXEC_ENV, CONTAINER_NAME, 'bash', '-c', shellCmd], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
    });
  } catch (err) {
    ws.send(JSON.stringify({ type: 'error', data: `Failed to exec: ${err}` }));
    ws.close();
    return;
  }

  term.onData((data: string) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'output', data }));
    }
  });

  term.onExit(() => {
    term = null;
    if (ws.readyState === ws.OPEN) {
      ws.close();
    }
  });

  ws.on('message', (raw: Buffer | string) => {
    if (!term) return;
    try {
      const msg: TerminalMessage = JSON.parse(raw.toString());
      if (msg.type === 'input' && typeof msg.data === 'string') {
        term.write(msg.data);
      } else if (msg.type === 'resize' && msg.cols && msg.rows) {
        term.resize(Math.max(2, Math.floor(msg.cols)), Math.max(2, Math.floor(msg.rows)));
      }
    } catch {
      term.write(raw.toString());
    }
  });

  const killTerm = () => {
    if (term) {
      try { term.kill(); } catch { /* ignore */ }
      term = null;
    }
  };

  ws.on('close', killTerm);
  ws.on('error', killTerm);
}
