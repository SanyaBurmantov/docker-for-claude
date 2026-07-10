import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'node:events';
import { UTF8_EXEC_ENV } from './dockerService';

const CONTAINER_NAME = process.env.CLAUDE_CONTAINER || 'ai-claude';
const LOG_PATH = '/tmp/claude-events.log';
const RESPAWN_MS = 3000;
const HISTORY_LIMIT = 100;

export interface ClaudeEvent {
  ts: number;
  type: string;
  project: string;
}

/** Hook lines look like "1783670306|stop|my-project". */
function parseLine(line: string): ClaudeEvent | null {
  const [ts, type, project] = line.split('|');
  const event: ClaudeEvent = { ts: Number(ts) * 1000, type, project };
  if (!Number.isFinite(event.ts) || event.ts <= 0 || !type || !project) return null;
  return event;
}

class ClaudeEventStream extends EventEmitter {
  private history: ClaudeEvent[] = [];
  private rawHistory: string[] = [];
  private seen = new Set<string>();
  private child: ChildProcess | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor() {
    super();
    // One tail feeds every connected browser, so the listener count tracks clients.
    this.setMaxListeners(0);
  }

  recent(): ClaudeEvent[] {
    return [...this.history];
  }

  start(): void {
    if (!this.child) this.follow();
  }

  private follow(): void {
    // -F retries while the file is missing and survives the container recreating
    // it, so a restarted claude container reattaches on its own.
    const child = spawn(
      'docker',
      [
        'exec',
        ...UTF8_EXEC_ENV,
        CONTAINER_NAME,
        'tail',
        '-n',
        String(HISTORY_LIMIT),
        '-F',
        LOG_PATH,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    );

    this.child = child;

    const decoder = new TextDecoder();
    let buffer = '';

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) this.ingest(line.trim());
    });

    const respawn = () => {
      if (this.child !== child) return;
      this.child = null;
      this.timer = setTimeout(() => this.follow(), RESPAWN_MS);
    };

    child.on('close', respawn);
    child.on('error', respawn);
  }

  /**
   * A respawned tail re-reads the last lines of the log, so identical lines are
   * replays rather than new events. Two hook events that share a second, a type
   * and a project are indistinguishable here and the second one is dropped —
   * a fair trade against replaying the whole tail on every container restart.
   */
  private ingest(raw: string): void {
    if (!raw || this.seen.has(raw)) return;

    const event = parseLine(raw);
    if (!event) return;

    this.seen.add(raw);
    this.history.push(event);
    this.rawHistory.push(raw);

    if (this.history.length > HISTORY_LIMIT) {
      this.history.shift();
      const dropped = this.rawHistory.shift();
      if (dropped) this.seen.delete(dropped);
    }

    this.emit('event', event);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const child = this.child;
    this.child = null;
    child?.kill('SIGKILL');
  }
}

export const claudeEvents = new ClaudeEventStream();
