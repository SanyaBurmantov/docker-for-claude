import { spawn } from 'child_process';
import { streamClaude } from './claudeQuery';
import { streamGemini } from './geminiQuery';
import { EXEC_USER_ARGS, UTF8_EXEC_ENV } from './dockerService';

export type EngineId = 'claude' | 'opencode' | 'gemini';
export interface ExecutorRef {
  engine: EngineId;
  model: string;
}
export type Role = 'manager' | 'analyst' | 'executor' | 'tester' | 'reviewer';

/**
 * Unified interface every one-shot engine query goes through, so callers never
 * branch on engine — only `runEngine` does.
 */
export interface EngineQuery {
  project: string;
  prompt: string;
  systemPrompt: string;
  engine: ExecutorRef;
  role: Role;
  allowedTools?: string;
  disallowedTools?: string;
  sessionId?: string | null;
  /** True once `sessionId` already names a conversation this loop started earlier. */
  resumeSession?: boolean;
  timeoutMs: number;
}

export interface EngineHandlers {
  onText(t: string): void;
  onError(m: string): void;
  onDone(): void;
}

const CONTAINER_NAME = process.env.CLAUDE_CONTAINER || 'ai-claude';

/**
 * `opencode run --format json` dumps raw internal events with no schema
 * documented anywhere in this repo — only a note that the command itself was
 * exercised by hand and works. This walks every parsed line for a plausible
 * text field and keeps the LAST one found, on the assumption that later
 * events supersede earlier ones (a growing transcript or a delta either way).
 * Needs checking against a real run before leaning on it beyond the cheap/
 * trivial executor slot it's used for today.
 */
function firstStringField(obj: unknown, keys: string[], depth = 0): string | null {
  if (depth > 4 || !obj || typeof obj !== 'object') return null;
  const rec = obj as Record<string, unknown>;
  for (const key of keys) {
    const v = rec[key];
    if (typeof v === 'string' && v.trim()) return v;
  }
  for (const key of keys) {
    const nested = firstStringField(rec[key], keys, depth + 1);
    if (nested) return nested;
  }
  return null;
}

const OPENCODE_TEXT_KEYS = ['text', 'content', 'message', 'delta', 'output'];

function extractOpencodeText(stdout: string): string {
  const candidates: string[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const text = firstStringField(obj, OPENCODE_TEXT_KEYS);
    if (text) candidates.push(text);
  }
  // Nothing parsed as JSON — the CLI may have printed plain text instead.
  if (!candidates.length) return stdout.trim();
  return candidates[candidates.length - 1];
}

/** No `--append-system-prompt` equivalent is documented for opencode, so the system prompt rides in the message itself. */
function runOpencode(q: EngineQuery, h: EngineHandlers): () => void {
  const fullPrompt = q.systemPrompt ? `${q.systemPrompt}\n\n${q.prompt}` : q.prompt;
  const args = ['run', fullPrompt, '--format', 'json', '-m', q.engine.model, '--auto'];
  if (q.sessionId) args.push('--session', q.sessionId);

  const child = spawn('docker', [
    'exec',
    ...EXEC_USER_ARGS,
    '-w',
    `/workspace/${q.project}`,
    ...UTF8_EXEC_ENV,
    CONTAINER_NAME,
    'opencode',
    ...args,
  ]);

  let settled = false;
  const settle = (fn: () => void) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    fn();
  };
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
    settle(() => h.onError(`opencode не ответил за ${Math.round(q.timeoutMs / 1000)}с`));
  }, q.timeoutMs);

  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on('data', (c: Buffer) => stdout.push(c));
  child.stderr.on('data', (c: Buffer) => stderr.push(c));

  child.on('error', (err: Error) => {
    settle(() => h.onError(`Cannot reach the Claude container: ${err.message}`));
  });

  child.on('close', (code: number | null) => {
    if (code !== 0) {
      const detail = Buffer.concat(stderr).toString('utf-8').trim();
      settle(() => h.onError(detail.slice(0, 500) || `opencode exited with code ${code}`));
      return;
    }
    const text = extractOpencodeText(Buffer.concat(stdout).toString('utf-8'));
    settle(() => {
      if (text) h.onText(text);
      h.onDone();
    });
  });

  return () => {
    settled = true;
    clearTimeout(timer);
    child.kill('SIGKILL');
  };
}

export function runEngine(q: EngineQuery, h: EngineHandlers): () => void {
  switch (q.engine.engine) {
    case 'claude':
      return streamClaude(
        {
          projectName: q.project,
          prompt: q.prompt,
          systemPrompt: q.systemPrompt,
          model: q.engine.model,
          timeoutMs: q.timeoutMs,
          allowedTools: q.allowedTools,
          disallowedTools: q.disallowedTools,
          ...(q.sessionId ? { sessionId: q.sessionId, resumeSession: Boolean(q.resumeSession) } : {}),
        },
        h
      );
    case 'opencode':
      return runOpencode(q, h);
    case 'gemini':
      // Text-only: no tools, no container — used only for text-in/text-out roles.
      return streamGemini({ prompt: q.prompt, systemPrompt: q.systemPrompt, timeoutMs: q.timeoutMs }, h);
  }
}
