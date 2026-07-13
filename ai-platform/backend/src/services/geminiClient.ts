import { ProxyAgent, Dispatcher } from 'undici';

/**
 * Bits `routes/gemini.ts` (the chat panel) and `services/geminiQuery.ts` (the
 * loop-manager's text-only roles) both need: the key and the outbound proxy.
 * Everything else about the two calls (multi-turn chat vs. single prompt)
 * differs enough that unifying further would cost more clarity than it saves.
 */

export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export function geminiApiKey(): string {
  return process.env.GEMINI_API_KEY || '';
}

// undefined = not resolved yet, null = resolved to "no proxy"
let cachedDispatcher: Dispatcher | null | undefined;

export function geminiProxyDispatcher(): Dispatcher | undefined {
  if (cachedDispatcher !== undefined) return cachedDispatcher ?? undefined;

  const { PROXY_HOST, PROXY_PORT, PROXY_USER, PROXY_PASS } = process.env;
  if (!PROXY_HOST || !PROXY_PORT) {
    cachedDispatcher = null;
    return undefined;
  }

  const opts: ProxyAgent.Options = { uri: `http://${PROXY_HOST}:${PROXY_PORT}` };
  if (PROXY_USER && PROXY_PASS) {
    opts.token = `Basic ${Buffer.from(`${PROXY_USER}:${PROXY_PASS}`).toString('base64')}`;
  }
  cachedDispatcher = new ProxyAgent(opts);
  return cachedDispatcher;
}
