import { Router, type Request, type Response } from 'express';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import multer from 'multer';
import { scanProjects, getProjectInfo, listFilesRecursive, readProjectFile, writeProjectFile, isValidProjectName, isPathSafe } from '../services/projectService';
import { execInContainer, tmuxSessionName } from '../services/dockerService';

const router = Router();

const WORKSPACE_DIR = '/workspace';
const CONTAINER_NAME = process.env.CLAUDE_CONTAINER || 'ai-claude';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 50 },
  // busboy decodes multipart filenames as latin1 unless told otherwise, which lands
  // "отчёт.txt" on disk as "Ð¾ÑÑÑÑ.txt"
  defParamCharset: 'utf8',
});

router.param('id', (req, res, next, id) => {
  if (!isValidProjectName(id)) {
    res.status(400).json({ error: 'Invalid project name' });
    return;
  }
  next();
});

router.get('/', async (_req, res) => {
  try {
    const projects = await scanProjects();

    // One tmux call covers session status for every project
    let sessions: string[] = [];
    try {
      const out = await execInContainer(
        CONTAINER_NAME,
        `tmux list-sessions -F '#{session_name}' 2>/dev/null || true`
      );
      sessions = out.split('\n').filter(Boolean);
    } catch {
      sessions = [];
    }

    res.json(projects.map((p) => ({ ...p, running: sessions.includes(tmuxSessionName(p.name)) })));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    if (!isValidProjectName(name)) {
      res.status(400).json({ error: 'Invalid project name' });
      return;
    }

    const projectPath = path.join(WORKSPACE_DIR, name);
    if (existsSync(projectPath)) {
      res.status(409).json({ error: 'Project already exists' });
      return;
    }

    const { gitUrl } = req.body;
    if (gitUrl !== undefined && gitUrl !== '') {
      if (typeof gitUrl !== 'string' || !/^(https?:\/\/|git@)[\w.@:~/+-]+$/.test(gitUrl)) {
        res.status(400).json({ error: 'Invalid git URL' });
        return;
      }
      // Clone inside the claude container so the traffic goes through the proxy
      await execInContainer(CONTAINER_NAME, `git clone ${gitUrl} /workspace/${name}`);
    } else {
      await fs.mkdir(projectPath, { recursive: true });
    }
    res.status(201).json({ name, path: projectPath });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.delete('/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const projectPath = path.join(WORKSPACE_DIR, req.params.id);
    if (!existsSync(projectPath)) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    await fs.rm(projectPath, { recursive: true, force: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const info = await getProjectInfo(req.params.id);
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/:id/files', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const projectPath = path.join(WORKSPACE_DIR, req.params.id);
    if (!existsSync(projectPath)) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const files = await listFilesRecursive(projectPath);
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/:id/files/*', async (req: Request, res: Response) => {
  try {
    const filePath = (req.params as any)[0] as string | undefined;
    if (!filePath) {
      res.status(400).json({ error: 'File path is required' });
      return;
    }
    const content = await readProjectFile(req.params.id, filePath);
    // Default for a string body is text/html, which both invites sniffing and
    // leaves the charset up to the browser
    res.type('text/plain; charset=utf-8').send(content);
  } catch (err) {
    const status = (err as Error).message === 'Path traversal detected' ? 403 : 500;
    res.status(status).json({ error: String(err) });
  }
});

router.post('/:id/fs', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const base = path.join(WORKSPACE_DIR, req.params.id);
    if (!existsSync(base)) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const { action, path: relPath, newPath } = req.body ?? {};
    if (typeof action !== 'string' || typeof relPath !== 'string' || !relPath.trim()) {
      res.status(400).json({ error: 'action and path are required' });
      return;
    }
    const full = path.resolve(base, relPath);
    if (!isPathSafe(base, full)) {
      res.status(403).json({ error: 'Path traversal detected' });
      return;
    }

    switch (action) {
      case 'create-file':
        if (existsSync(full)) {
          res.status(409).json({ error: 'Already exists' });
          return;
        }
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, '', 'utf-8');
        break;
      case 'mkdir':
        await fs.mkdir(full, { recursive: true });
        break;
      case 'rename': {
        if (typeof newPath !== 'string' || !newPath.trim()) {
          res.status(400).json({ error: 'newPath is required' });
          return;
        }
        const fullNew = path.resolve(base, newPath);
        if (!isPathSafe(base, fullNew)) {
          res.status(403).json({ error: 'Path traversal detected' });
          return;
        }
        await fs.mkdir(path.dirname(fullNew), { recursive: true });
        await fs.rename(full, fullNew);
        break;
      }
      case 'delete':
        if (full === base) {
          res.status(400).json({ error: 'Cannot delete project root' });
          return;
        }
        await fs.rm(full, { recursive: true, force: true });
        break;
      default:
        res.status(400).json({ error: 'Unknown action' });
        return;
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/:id/archive', (req: Request<{ id: string }>, res: Response) => {
  const projectPath = path.join(WORKSPACE_DIR, req.params.id);
  if (!existsSync(projectPath)) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}.tar.gz"`);
  const child = spawn('tar', ['-czf', '-', '--exclude=node_modules', '--exclude=.git', '-C', projectPath, '.']);
  child.stdout.pipe(res);
  child.on('error', () => res.end());
  child.on('close', () => res.end());
});

router.post('/:id/upload', upload.array('files'), async (req: Request<{ id: string }>, res: Response) => {
  try {
    const base = path.join(WORKSPACE_DIR, req.params.id);
    if (!existsSync(base)) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const dir = typeof req.query.dir === 'string' ? req.query.dir : '';
    const targetDir = path.resolve(base, dir);
    if (!isPathSafe(base, targetDir)) {
      res.status(403).json({ error: 'Path traversal detected' });
      return;
    }
    const files = (req.files as Express.Multer.File[]) ?? [];
    if (files.length === 0) {
      res.status(400).json({ error: 'No files uploaded' });
      return;
    }
    await fs.mkdir(targetDir, { recursive: true });
    for (const f of files) {
      await fs.writeFile(path.join(targetDir, path.basename(f.originalname)), f.buffer);
    }
    res.json({ success: true, count: files.length });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.put('/:id/files/*', async (req: Request, res: Response) => {
  try {
    const filePath = (req.params as any)[0] as string | undefined;
    if (!filePath) {
      res.status(400).json({ error: 'File path is required' });
      return;
    }
    const { content } = req.body;
    if (content === undefined) {
      res.status(400).json({ error: 'content is required' });
      return;
    }
    await writeProjectFile(req.params.id, filePath, content);
    res.json({ success: true });
  } catch (err) {
    const status = (err as Error).message === 'Path traversal detected' ? 403 : 500;
    res.status(status).json({ error: String(err) });
  }
});

export default router;
