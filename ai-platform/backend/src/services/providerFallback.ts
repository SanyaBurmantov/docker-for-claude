import { runEngine, type EngineHandlers, type EngineQuery, type ExecutorRef } from './engines';

export const AI_PROVIDERS = ['claude', 'opencode', 'codex', 'gemini'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
const METERED_PROVIDERS = ['claude', 'codex', 'gemini'] as const;

const PROVIDER_LABEL: Record<AiProvider, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  opencode: 'OpenCode',
};

export function parseAiProvider(value: unknown, fallback: AiProvider = 'claude'): AiProvider | null {
  if (value === undefined || value === null || value === '') return fallback;
  return typeof value === 'string' && (AI_PROVIDERS as readonly string[]).includes(value)
    ? value as AiProvider
    : null;
}

function configuredFreeModels(): string[] {
  const models = (process.env.OPENCODE_FREE_MODELS || 'opencode/hy3-free')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);
  return models.length ? models : ['opencode/hy3-free'];
}

/**
 * The explicitly selected provider always goes first. Providers before it are
 * not retried: choosing Codex must not silently spend Claude quota. OpenCode is
 * the final, key-free safety net; choosing it explicitly skips paid providers.
 */
export function providerFallbackChain(
  preferred: AiProvider,
  models: Partial<Record<AiProvider, string>> = {},
  freeModels: string[] = configuredFreeModels()
): ExecutorRef[] {
  const free = freeModels.map((model) => ({ engine: 'opencode' as const, model }));
  if (preferred === 'opencode') return free;

  const start = METERED_PROVIDERS.indexOf(preferred);
  const paid = METERED_PROVIDERS.slice(start).map((engine) => ({
    engine,
    model: models[engine] || '',
  }));
  return [...paid, ...free];
}

export interface ProviderEngineQuery extends Omit<EngineQuery, 'engine'> {
  preferred: AiProvider;
  models?: Partial<Record<AiProvider, string>>;
  /** Primarily useful for deterministic tests; production reads OPENCODE_FREE_MODELS. */
  freeModels?: string[];
  /** Allows chat to give stateless fallback providers the full transcript. */
  adapt?: (query: EngineQuery) => EngineQuery;
}

/**
 * Tries the selected provider and then the remaining fallback chain. A provider
 * that already emitted text is not replaced mid-answer, otherwise two answers
 * would be spliced together in the same SSE stream.
 */
export function runEngineWithFallback(q: ProviderEngineQuery, h: EngineHandlers): () => void {
  const { preferred, models, freeModels, adapt, ...base } = q;
  const chain = providerFallbackChain(preferred, models, freeModels);
  const errors: string[] = [];
  let index = 0;
  let cancelled = false;
  let activeCancel = () => {};

  const attempt = () => {
    if (cancelled) return;
    const engine = chain[index++];
    if (!engine) {
      h.onError(errors.join(' | ') || 'Нет доступного AI-провайдера');
      return;
    }

    let emitted = false;
    const query = { ...base, engine };
    activeCancel = runEngine(
      adapt ? adapt(query) : query,
      {
        onText: (text) => {
          emitted = true;
          h.onText(text);
        },
        onDone: () => {
          if (!cancelled) h.onDone();
        },
        onError: (message) => {
          if (cancelled) return;
          errors.push(`${PROVIDER_LABEL[engine.engine]}: ${message}`);
          if (emitted) {
            h.onError(errors[errors.length - 1]);
            return;
          }
          // Gemini can reject synchronously when its key is absent. Deferring
          // avoids the outer runEngine assignment overwriting the next cancel fn.
          queueMicrotask(attempt);
        },
      }
    );
  };

  attempt();
  return () => {
    cancelled = true;
    activeCancel();
  };
}
