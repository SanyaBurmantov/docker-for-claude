import type { WebSocket } from 'ws';
import { spawn, type ChildProcess } from 'child_process';

interface TerminalMessage {
  type: 'input';
  data: string;
}

export function handleTerminalWebSocket(ws: WebSocket, sessionId: string): void {
  const prefix = 'claude-';
  const projectName = sessionId.startsWith(prefix) ? sessionId.slice(prefix.length) : sessionId;

  let child: ChildProcess | null = null;

  try {
    child = spawn('docker', ['exec', '-i', 'ai-claude', 'script', '-q', '-c', 'bash -i', '/dev/null'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    ws.send(JSON.stringify({ type: 'error', data: `Failed to exec: ${err}` }));
    ws.close();
    return;
  }

  if (child.stdout) {
    child.stdout.on('data', (data: Buffer) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'output', data: data.toString() }));
      }
    });
  }

  if (child.stderr) {
    child.stderr.on('data', (data: Buffer) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'output', data: data.toString() }));
      }
    });
  }

  child.on('exit', () => {
    if (ws.readyState === ws.OPEN) {
      ws.close();
    }
  });

  child.on('error', (err) => {
    ws.send(JSON.stringify({ type: 'error', data: `Process error: ${err.message}` }));
  });

  setTimeout(() => {
    if (child?.stdin?.writable) {
      child.stdin.write(`cd /workspace/${projectName} 2>/dev/null\n`);
    }
  }, 300);

  ws.on('message', (raw: Buffer | string) => {
    if (!child?.stdin?.writable) return;
    try {
      const msg: TerminalMessage = JSON.parse(raw.toString());
      if (msg.type === 'input') {
        child.stdin.write(msg.data);
      }
    } catch {
      child.stdin.write(raw.toString());
    }
  });

  ws.on('close', () => {
    if (child) {
      try { child.kill(); } catch { /* ignore */ }
      child = null;
    }
  });

  ws.on('error', () => {
    if (child) {
      try { child.kill(); } catch { /* ignore */ }
      child = null;
    }
  });
}
