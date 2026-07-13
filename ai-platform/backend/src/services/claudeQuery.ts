import { spawn } from 'child_process';
import { UTF8_EXEC_ENV, EXEC_USER_ARGS } from './dockerService';

const CONTAINER_NAME = process.env.CLAUDE_CONTAINER || 'ai-claude';

/** Read-only tools: enough to follow imports and callers, unable to change anything. */
export const READ_ONLY_TOOLS = 'Read Grep Glob';
export const NO_TOOLS = 'Read Grep Glob Bash Edit Write WebFetch WebSearch Task';
/** Loop executor/tester-authoring roles: read, edit and run commands, nothing beyond the project. */
export const WRITE_TOOLS = 'Read Grep Glob Edit Write Bash';

export interface ClaudeQuery {
  projectName: string;
  prompt: string;
  systemPrompt: string;
  model: string;
  timeoutMs: number;
  /** Exactly one of these decides the tool policy. */
  allowedTools?: string;
  disallowedTools?: string;
  /**
   * Names the conversation so a later call can resume it (`--session-id` the
   * first time, `--resume` after) — used by loop roles that keep one session
   * across fix rounds so the prompt cache carries over. Omitted entirely for
   * the stateless one-shot routes (explain/review/commit-message).
   */
  sessionId?: string;
  resumeSession?: boolean;
}

export interface ClaudeHandlers {
  onText(chunk: string): void;
  onError(message: string): void;
  onDone(): void;
}

interface StreamEvent {
  type?: string;
  event?: { type?: string; delta?: { type?: string; text?: string } };
  subtype?: string;
  is_error?: boolean;
  result?: string;
}

/**
 * Runs `claude -p` inside the project directory and streams the reply.
 * Returns a cancel function; handlers fire at most one of onError/onDone.
 */
export function streamClaude(query: ClaudeQuery, handlers: ClaudeHandlers): () => void {
  const toolFlag = query.allowedTools ? '--allowedTools' : '--disallowedTools';
  const toolList = query.allowedTools ?? query.disallowedTools ?? NO_TOOLS;

  const sessionArgs = query.sessionId
    ? [query.resumeSession ? '--resume' : '--session-id', query.sessionId]
    : [];

  // argv goes straight to docker, so the prompt never passes through a shell,
  // and -w puts Claude in the project so relative paths resolve there.
  const child = spawn('docker', [
    'exec',
    '-i',
    ...EXEC_USER_ARGS,
    '-w',
    `/workspace/${query.projectName}`,
    ...UTF8_EXEC_ENV,
    CONTAINER_NAME,
    'claude',
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-mode',
    'dontAsk',
    '--model',
    query.model,
    '--append-system-prompt',
    query.systemPrompt,
    toolFlag,
    toolList,
    ...sessionArgs,
  ]);

  child.stdin.end(query.prompt, 'utf-8');

  let settled = false;
  const settle = (fn: () => void) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    fn();
  };

  const timer = setTimeout(() => {
    child.kill('SIGKILL');
    settle(() => handlers.onError(`Claude did not answer within ${Math.round(query.timeoutMs / 1000)}s`));
  }, query.timeoutMs);

  // Chunk boundaries fall on arbitrary byte offsets, so a multi-byte character
  // can straddle two chunks; the streaming decoder holds the tail until it lands.
  const decoder = new TextDecoder();
  const stderr: Buffer[] = [];
  let buffer = '';

  child.stdout.on('data', (chunk: Buffer) => {
    buffer += decoder.decode(chunk, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;

      let event: StreamEvent;
      try {
        event = JSON.parse(line);
      } catch {
        // A frame we cannot parse is not worth killing the stream over.
        continue;
      }

      if (event.type === 'stream_event') {
        const inner = event.event;
        if (inner?.type === 'content_block_delta' && inner.delta?.type === 'text_delta') {
          const text = inner.delta.text;
          if (text && !settled) handlers.onText(text);
        }
      } else if (event.type === 'result' && event.is_error) {
        child.kill('SIGKILL');
        settle(() => handlers.onError(event.result || event.subtype || 'Claude failed'));
        return;
      }
    }
  });

  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

  child.on('error', (err: Error) => {
    settle(() => handlers.onError(`Cannot reach the Claude container: ${err.message}`));
  });

  child.on('close', (code: number | null) => {
    if (code === 0) {
      settle(() => handlers.onDone());
      return;
    }
    const detail = Buffer.concat(stderr).toString('utf-8').trim();
    settle(() => handlers.onError(detail.slice(0, 500) || `claude exited with code ${code}`));
  });

  return () => {
    settled = true;
    clearTimeout(timer);
    child.kill('SIGKILL');
  };
}
