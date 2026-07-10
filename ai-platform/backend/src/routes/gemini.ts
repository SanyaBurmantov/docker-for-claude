import { Router } from 'express';
import { fetch, ProxyAgent, Dispatcher } from 'undici';

const router = Router();

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';

// Allowed models — keeps a compromised frontend from pointing the key at
// arbitrary endpoints, and keeps the UI dropdown honest.
//
// The gemini-2.5-* names still appear in the ListModels response but return 404
// ("no longer available to new users") on generateContent, so they are omitted.
// Everything below the first entry needs a billed plan; on the free tier they
// answer 429 and the panel will surface that verbatim.
const MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-3-flash-preview',
  'gemini-2.0-flash',
  'gemini-3-pro-preview',
];

function apiKey(): string {
  return process.env.GEMINI_API_KEY || '';
}

// undefined = not resolved yet, null = resolved to "no proxy"
let cachedDispatcher: Dispatcher | null | undefined;

function proxyDispatcher(): Dispatcher | undefined {
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

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

router.get('/status', (_req, res) => {
  res.json({
    configured: Boolean(apiKey()),
    model: DEFAULT_MODEL,
    models: MODELS,
    viaProxy: Boolean(proxyDispatcher()),
  });
});

router.post('/chat', async (req, res) => {
  const key = apiKey();
  if (!key) {
    res.status(503).json({ error: 'GEMINI_API_KEY is not set' });
    return;
  }

  const { messages, model } = req.body as { messages?: ChatMessage[]; model?: string };
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'messages must be a non-empty array' });
    return;
  }

  const chosen = model && MODELS.includes(model) ? model : DEFAULT_MODEL;
  const contents = messages.map((m) => ({
    role: m.role === 'model' ? 'model' : 'user',
    parts: [{ text: String(m.text ?? '') }],
  }));

  const abort = new AbortController();
  res.on('close', () => abort.abort());

  let upstream;
  try {
    upstream = await fetch(`${API_BASE}/models/${chosen}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      // This credential authenticates only as x-goog-api-key; Gemini rejects it
      // as an OAuth bearer token.
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents }),
      dispatcher: proxyDispatcher(),
      signal: abort.signal,
    });
  } catch (err) {
    res.status(502).json({ error: `Cannot reach Gemini: ${(err as Error).message}` });
    return;
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => upstream.statusText);
    res.status(upstream.status).json({ error: detail.slice(0, 500) });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event: object) => res.write(`data: ${JSON.stringify(event)}\n\n`);

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for await (const chunk of upstream.body) {
      buffer += decoder.decode(chunk as Uint8Array, { stream: true });

      // Upstream frames are SSE too: "data: {json}\n\n". Keep the trailing
      // partial line in the buffer until its newline arrives.
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
            if (text) send({ text });
          }
        } catch {
          // A frame we cannot parse is not worth killing the stream over.
        }
      }
    }
    send({ done: true });
  } catch (err) {
    if (!abort.signal.aborted) send({ error: (err as Error).message });
  } finally {
    res.end();
  }
});

export default router;
