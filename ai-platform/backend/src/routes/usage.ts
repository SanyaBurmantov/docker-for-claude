import { Router, type Request, type Response } from 'express';
import { isValidProjectName } from '../services/projectService';
import { execInContainer } from '../services/dockerService';

const router = Router({ mergeParams: true });

const CONTAINER_NAME = process.env.CLAUDE_CONTAINER || 'ai-claude';
const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || '/home/claude/.claude';
// The last assistant reply is at the end of the file, but a single record can be
// large, so read a generous tail rather than a line count.
const TAIL_BYTES = 300_000;

/**
 * Context window per model. The current Opus/Sonnet line is 1M; only Haiku is
 * still 200k. Guessing 200k for everything reported "0% left" on a session that
 * was legitimately past 300k tokens.
 */
const HAIKU_WINDOW = 200_000;
const DEFAULT_WINDOW = 1_000_000;
const WINDOW_OVERRIDE = Number(process.env.CONTEXT_WINDOW_TOKENS) || 0;

function windowFor(model: string): number {
  if (WINDOW_OVERRIDE > 0) return WINDOW_OVERRIDE;
  return /haiku/i.test(model) ? HAIKU_WINDOW : DEFAULT_WINDOW;
}

interface Usage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
}

interface TranscriptEntry {
  type?: string;
  isSidechain?: boolean;
  timestamp?: string;
  message?: { model?: string; usage?: Usage };
}

export interface UsageReport {
  contextTokens: number | null;
  windowTokens: number;
  outputTokens: number;
  model: string;
  updatedAt: string | null;
}

/** Claude Code names a transcript directory after the cwd, non-alphanumerics dashed. */
function transcriptDir(projectName: string): string {
  const slug = `/workspace/${projectName}`.replace(/[^a-zA-Z0-9]/g, '-');
  return `${CONFIG_DIR}/projects/${slug}`;
}

/**
 * What the next request will have to re-send: everything the last reply read,
 * cached or not. Output tokens of that reply are excluded — they are counted as
 * input only once the conversation continues.
 */
function contextTokens(usage: Usage): number {
  return (
    (usage.input_tokens || 0) +
    (usage.cache_creation_input_tokens || 0) +
    (usage.cache_read_input_tokens || 0)
  );
}

/** Sidechain entries are subagent turns; they carry their own, unrelated context. */
function lastMainAssistant(transcript: string): TranscriptEntry | null {
  const lines = transcript.split('\n');

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;

    let entry: TranscriptEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      // The tail cut the first record in half, and a subagent record may be
      // truncated the same way; neither is worth failing the request over.
      continue;
    }

    if (entry.type === 'assistant' && !entry.isSidechain && entry.message?.usage) return entry;
  }

  return null;
}

router.get('/', async (req: Request<{ id: string }>, res: Response) => {
  const projectName = req.params.id;
  if (!isValidProjectName(projectName)) {
    res.status(400).json({ error: 'Invalid project name' });
    return;
  }

  const dir = transcriptDir(projectName);
  const empty: UsageReport = {
    contextTokens: null,
    windowTokens: windowFor(''),
    outputTokens: 0,
    model: '',
    updatedAt: null,
  };

  let transcript: string;
  try {
    transcript = await execInContainer(
      CONTAINER_NAME,
      `f=$(ls -1t ${dir}/*.jsonl 2>/dev/null | head -1); if [ -n "$f" ]; then tail -c ${TAIL_BYTES} "$f"; fi`
    );
  } catch {
    // No container, no transcript directory, no session yet — all the same to the UI.
    res.json(empty);
    return;
  }

  const entry = lastMainAssistant(transcript);
  if (!entry?.message?.usage) {
    res.json(empty);
    return;
  }

  const model = entry.message.model || '';

  res.json({
    contextTokens: contextTokens(entry.message.usage),
    windowTokens: windowFor(model),
    outputTokens: entry.message.usage.output_tokens || 0,
    model,
    updatedAt: entry.timestamp || null,
  } satisfies UsageReport);
});

export default router;
