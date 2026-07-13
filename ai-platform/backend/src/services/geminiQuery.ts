import { fetch } from 'undici';
import { GEMINI_API_BASE, geminiApiKey, geminiProxyDispatcher } from './geminiClient';

/** The loop-manager's only working Gemini model on this key (per loop-manager-prompt.md §Правила). */
export const LOOP_GEMINI_MODEL = 'gemini-3.1-flash-lite';

export interface GeminiQuery {
  prompt: string;
  systemPrompt?: string;
  timeoutMs: number;
}

export interface GeminiHandlers {
  onText(chunk: string): void;
  onError(message: string): void;
  onDone(): void;
}

/**
 * Single-prompt Gemini call for the loop's text-only roles (manager, cheap
 * verify diagnosis) — shaped like `streamClaude`'s handlers so `engines.ts`
 * can dispatch to either engine without the caller knowing which one ran.
 * No tools: Gemini here is chat-only, same as `routes/gemini.ts`.
 */
export function streamGemini(q: GeminiQuery, h: GeminiHandlers): () => void {
  const key = geminiApiKey();
  if (!key) {
    h.onError('GEMINI_API_KEY is not set');
    return () => {};
  }

  const abort = new AbortController();
  let settled = false;
  const settle = (fn: () => void) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    fn();
  };
  const timer = setTimeout(() => {
    abort.abort();
  }, q.timeoutMs);

  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: q.prompt }] }],
  };
  if (q.systemPrompt) body.systemInstruction = { parts: [{ text: q.systemPrompt }] };

  (async () => {
    let upstream;
    try {
      upstream = await fetch(`${GEMINI_API_BASE}/models/${LOOP_GEMINI_MODEL}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
        dispatcher: geminiProxyDispatcher(),
        signal: abort.signal,
      });
    } catch (err) {
      settle(() => h.onError(`Cannot reach Gemini: ${(err as Error).message}`));
      return;
    }

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => upstream.statusText);
      settle(() => h.onError(detail.slice(0, 500)));
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for await (const chunk of upstream.body) {
        if (settled) break;
        buffer += decoder.decode(chunk as Uint8Array, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;

          try {
            const parsed = JSON.parse(payload);
            const parts = parsed?.candidates?.[0]?.content?.parts;
            if (Array.isArray(parts)) {
              const text = parts.map((p: { text?: string }) => p.text ?? '').join('');
              if (text && !settled) h.onText(text);
            }
          } catch {
            // A frame we cannot parse is not worth killing the stream over.
          }
        }
      }
      settle(() => h.onDone());
    } catch (err) {
      if (!abort.signal.aborted) settle(() => h.onError((err as Error).message));
    }
  })();

  return () => {
    settled = true;
    clearTimeout(timer);
    abort.abort();
  };
}
