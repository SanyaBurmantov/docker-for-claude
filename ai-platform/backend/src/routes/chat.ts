import { Router, type Request, type Response } from 'express';
import { isValidProjectName } from '../services/projectService';
import { READ_ONLY_TOOLS, NO_TOOLS } from '../services/claudeQuery';
import { runEngine } from '../services/engines';
import { openSse } from '../services/sse';

/**
 * Free-form chat, mounted twice: at `/api/claude/chat` (no project, no tools —
 * just talking) and at `/api/projects/:id/chat` (cwd is the project, read-only
 * access, so the model can look at the code it is being asked about).
 */
const router = Router({ mergeParams: true });

const DEFAULT_MODEL = process.env.CHAT_MODEL || 'opus';
// Keeps a compromised frontend from pointing `--model` at anything it likes.
const CLAUDE_MODELS = ['opus', 'sonnet', 'haiku'];
// Codex takes its model from `codex-config.toml`; an empty string means "the default there".
const CODEX_MODEL = process.env.CODEX_CHAT_MODEL || '';
// Reading files before answering takes review-sized time, not explain-sized.
const TIMEOUT_MS = Number(process.env.CHAT_TIMEOUT_MS || 300_000);

const SYSTEM_PROMPT = 'Ты собеседник в чат-панели платформы. Отвечай по-русски, по делу и без воды.';

const PROJECT_SYSTEM_PROMPT = [
  SYSTEM_PROMPT,
  'Разговор идёт про проект, в котором ты запущен: читай его файлы, чтобы отвечать точно.',
  'Менять файлы нельзя — только читать.',
].join(' ');

// The session id lands in argv, so it must not be able to pose as a flag.
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

/**
 * Codex cannot be handed a session id (it names its own sessions), so its
 * memory of the conversation is the transcript we resend every turn. Claude
 * keeps history in its own session and only needs the newest message.
 */
function renderTranscript(messages: ChatMessage[]): string {
  return messages
    .map((m) => `${m.role === 'model' ? 'Ассистент' : 'Пользователь'}: ${String(m.text ?? '')}`)
    .join('\n\n');
}

router.get('/status', (_req, res) => {
  res.json({ model: DEFAULT_MODEL, models: CLAUDE_MODELS });
});

router.post('/', (req: Request<{ id?: string }>, res: Response) => {
  const project = req.params.id;
  if (project !== undefined && !isValidProjectName(project)) {
    res.status(400).json({ error: 'Invalid project name' });
    return;
  }

  const { messages, model, engine, sessionId, resume } = req.body as {
    messages?: ChatMessage[];
    model?: string;
    engine?: string;
    sessionId?: string;
    resume?: boolean;
  };

  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'messages must be a non-empty array' });
    return;
  }
  const last = messages[messages.length - 1];
  if (typeof last?.text !== 'string' || !last.text.trim()) {
    res.status(400).json({ error: 'the last message must carry text' });
    return;
  }
  if (sessionId !== undefined && !SESSION_ID_RE.test(sessionId)) {
    res.status(400).json({ error: 'sessionId must be a UUID' });
    return;
  }

  const isCodex = engine === 'codex';

  let cancel = () => {};
  const sse = openSse(res, () => cancel());

  cancel = runEngine(
    {
      project,
      prompt: isCodex ? renderTranscript(messages) : last.text,
      systemPrompt: project ? PROJECT_SYSTEM_PROMPT : SYSTEM_PROMPT,
      engine: {
        engine: isCodex ? 'codex' : 'claude',
        model: isCodex ? CODEX_MODEL : model && CLAUDE_MODELS.includes(model) ? model : DEFAULT_MODEL,
      },
      timeoutMs: TIMEOUT_MS,
      ...(project ? { allowedTools: READ_ONLY_TOOLS } : { disallowedTools: NO_TOOLS }),
      readOnly: true,
      ...(isCodex ? {} : { sessionId, resumeSession: Boolean(resume) }),
    },
    {
      onText: (text) => sse.send({ text }),
      onError: (error) => sse.finish({ error }),
      onDone: () => sse.finish({ done: true }),
    }
  );
});

export default router;
