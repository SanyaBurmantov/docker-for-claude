import { spawn } from 'child_process';
import { streamClaude } from './claudeQuery';
import { streamGemini } from './geminiQuery';
import { EXEC_USER_ARGS, UTF8_EXEC_ENV } from './dockerService';

export type EngineId = 'claude' | 'opencode' | 'codex' | 'gemini';
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
  /** Project to run in; omitted for chat with no project context (cwd stays `/workspace`). */
  project?: string;
  prompt: string;
  systemPrompt: string;
  engine: ExecutorRef;
  /** Loop role, for callers that have one; `runEngine` itself does not branch on it. */
  role?: Role;
  allowedTools?: string;
  disallowedTools?: string;
  /** Codex only: run it with a read-only sandbox instead of the default full access. */
  readOnly?: boolean;
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

/** Codex `exec --json` prints the same shape of thing: one JSON event per line. */
function extractJsonlText(stdout: string): string {
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

/**
 * Runs one of the container CLIs to completion and reports its last text event.
 * Neither opencode nor codex streams into our SSE frames — the whole answer
 * arrives at once when the process exits.
 */
function runContainerCli(bin: string, args: string[], q: EngineQuery, h: EngineHandlers): () => void {
  const child = spawn('docker', [
    'exec',
    ...EXEC_USER_ARGS,
    '-w',
    q.project ? `/workspace/${q.project}` : '/workspace',
    ...UTF8_EXEC_ENV,
    CONTAINER_NAME,
    bin,
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
    settle(() => h.onError(`${bin} не ответил за ${Math.round(q.timeoutMs / 1000)}с`));
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
      settle(() => h.onError(detail.slice(0, 500) || `${bin} exited with code ${code}`));
      return;
    }
    const text = extractJsonlText(Buffer.concat(stdout).toString('utf-8'));
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

/** No `--append-system-prompt` equivalent is documented for opencode, so the system prompt rides in the message itself. */
function runOpencode(q: EngineQuery, h: EngineHandlers): () => void {
  const fullPrompt = q.systemPrompt ? `${q.systemPrompt}\n\n${q.prompt}` : q.prompt;
  const args = ['run', fullPrompt, '--format', 'json', '-m', q.engine.model, '--auto'];
  if (q.sessionId) args.push('--session', q.sessionId);
  return runContainerCli('opencode', args, q, h);
}

/**
 * Codex has no system-prompt flag either, so the prompt is merged the same way.
 * Sandbox off by default: the container already is the sandbox (see `codex-config.toml`),
 * and a one-shot query has nobody to answer an approval prompt. Chat asks for
 * `readOnly` instead — it only talks about the code, so it has no business editing it.
 * `q.sessionId` is ignored — codex names its own sessions and cannot be told an id.
 * An empty model means "whatever `config.toml` says".
 */
function runCodex(q: EngineQuery, h: EngineHandlers): () => void {
  const fullPrompt = q.systemPrompt ? `${q.systemPrompt}\n\n${q.prompt}` : q.prompt;
  const args = [
    'exec',
    '--json',
    '--skip-git-repo-check',
    ...(q.engine.model ? ['-m', q.engine.model] : []),
    ...(q.readOnly ? ['-a', 'never', '-s', 'read-only'] : ['--dangerously-bypass-approvals-and-sandbox']),
    fullPrompt,
  ];
  return runContainerCli('codex', args, q, h);
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
    case 'codex':
      return runCodex(q, h);
    case 'gemini':
      // Text-only: no tools, no container — used only for text-in/text-out roles.
      return streamGemini({ prompt: q.prompt, systemPrompt: q.systemPrompt, timeoutMs: q.timeoutMs }, h);
  }
}
