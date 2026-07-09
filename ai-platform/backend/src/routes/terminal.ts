import type { WebSocket } from 'ws';
import * as pty from 'node-pty';
import { tmuxSessionName, UTF8_EXEC_ENV } from '../services/dockerService';
import { isValidProjectName } from '../services/projectService';

interface TerminalMessage {
  type: 'input' | 'resize';
  data?: string;
  cols?: number;
  rows?: number;
}

const CONTAINER_NAME = process.env.CLAUDE_CONTAINER || 'ai-claude';

export function handleTerminalWebSocket(ws: WebSocket, sessionId: string): void {
  let kind: 'claude' | 'shell' = 'claude';
  let projectName = sessionId;
  if (sessionId.startsWith('claude-')) {
    projectName = sessionId.slice('claude-'.length);
  } else if (sessionId.startsWith('shell-')) {
    kind = 'shell';
    projectName = sessionId.slice('shell-'.length);
  }

  if (!isValidProjectName(projectName)) {
    ws.send(JSON.stringify({ type: 'error', data: 'Invalid session id' }));
    ws.close();
    return;
  }

  // Claude tab: attach to the session started via the API (plain shell if it is gone).
  // Shell tab: attach-or-create a persistent tmux shell session in the project dir.
  const shellCmd =
    kind === 'claude'
      ? `cd /workspace/${projectName} 2>/dev/null; tmux attach-session -t ${tmuxSessionName(projectName)} 2>/dev/null || exec bash -i`
      : `cd /workspace/${projectName} 2>/dev/null; exec tmux new-session -A -s ${tmuxSessionName(projectName, 'shell')}`;

  let term: pty.IPty | null = null;

  try {
    // UTF8_EXEC_ENV is what lets readline echo typed Cyrillic; in the C locale bash
    // mangles the leading byte of every multi-byte character.
    term = pty.spawn('docker', ['exec', '-it', ...UTF8_EXEC_ENV, CONTAINER_NAME, 'bash', '-c', shellCmd], {
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
