import { streamClaude } from './claudeQuery';
import type { ExecutorRef, Role } from './loopTypes';

/**
 * Unified interface every loop role queries through, so `loopService` never
 * branches on engine — only `runEngine` does. Slice 1 wires the Claude adapter;
 * opencode and gemini (spec §2) are stubs until slice 2.
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
    case 'gemini':
      // Routed to in slice 2 (opencode-deepseek and gemini-flash-lite adapters).
      h.onError(`Движок "${q.engine.engine}" ещё не подключён к loop-менеджеру (срез 2)`);
      return () => {};
  }
}
