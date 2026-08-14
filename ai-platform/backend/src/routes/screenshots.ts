import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { execInContainer, tmuxSessionName } from '../services/dockerService';
import { isValidProjectName } from '../services/projectService';
import { list, save, remove, pathOf, agentPathOf, isImage } from '../services/screenshotService';

const router = Router({ mergeParams: true });
const CONTAINER_NAME = process.env.CLAUDE_CONTAINER || 'ai-claude';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 20 },
  defParamCharset: 'utf8',
});

router.use((req, res, next) => {
  const id = (req.params as Record<string, string>).id;
  if (!id || !isValidProjectName(id)) {
    res.status(400).json({ error: 'Invalid project name' });
    return;
  }
  next();
});

router.get('/', async (req: Request<{ id: string }>, res: Response) => {
  try {
    res.json({ screenshots: await list(req.params.id) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/', upload.array('files'), async (req: Request<{ id: string }>, res: Response) => {
  try {
    const files = (req.files as Express.Multer.File[]) ?? [];
    if (files.length === 0) {
      res.status(400).json({ error: 'No files uploaded' });
      return;
    }

    // A clipboard paste arrives as "image.png" or with no usable name at all, so the
    // extension is what decides — the agent reads these as images, nothing else.
    const images = files.filter((f) => f.mimetype.startsWith('image/') && isImage(f.originalname));
    if (images.length === 0) {
      res.status(400).json({ error: 'Только изображения (png, jpg, gif, webp)' });
      return;
    }

    const saved = [];
    for (const f of images) saved.push(await save(req.params.id, f.originalname, f.buffer));
    res.json({ screenshots: saved });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/:name/raw', (req: Request<{ id: string; name: string }>, res: Response) => {
  const file = pathOf(req.params.id, req.params.name);
  if (!file) {
    res.status(400).json({ error: 'Invalid name' });
    return;
  }
  res.sendFile(file, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'Not found' });
  });
});

router.delete('/:name', async (req: Request<{ id: string; name: string }>, res: Response) => {
  if (!(await remove(req.params.id, req.params.name))) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json({ success: true });
});

/**
 * Types the screenshot paths into the running agent, the way the user would have
 * typed them: pasted into the pane, not submitted, so a prompt can be written
 * around them before Enter.
 */
router.post('/attach', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { names } = (req.body ?? {}) as { names?: unknown };
    if (!Array.isArray(names) || names.length === 0) {
      res.status(400).json({ error: 'names is required' });
      return;
    }

    const paths: string[] = [];
    for (const name of names) {
      if (typeof name !== 'string' || !pathOf(req.params.id, name)) {
        res.status(400).json({ error: `Invalid name: ${name}` });
        return;
      }
      paths.push(agentPathOf(req.params.id, name));
    }

    const sessionName = tmuxSessionName(req.params.id);
    try {
      await execInContainer(CONTAINER_NAME, `tmux has-session -t ${sessionName}`);
    } catch {
      res.status(409).json({ error: 'Сессия не запущена — вставлять некуда' });
      return;
    }

    // Same base64 hop as sessions.ts: the text goes through a pipe, never through
    // shell syntax. Trailing space so the user can keep typing after the path.
    const b64 = Buffer.from(`${paths.join(' ')} `, 'utf-8').toString('base64');
    await execInContainer(
      CONTAINER_NAME,
      `printf '%s' '${b64}' | base64 -d | tmux load-buffer - && tmux paste-buffer -t ${sessionName} -d`
    );

    res.json({ success: true, paths });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
