import { Router, type Request, type Response } from 'express';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { scanProjects, getProjectInfo, listFilesRecursive, readProjectFile, writeProjectFile } from '../services/projectService';

const router = Router();

const WORKSPACE_DIR = '/workspace';

router.get('/', async (_req, res) => {
  try {
    const projects = await scanProjects();
    res.json(projects);
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

    const projectPath = path.join(WORKSPACE_DIR, name);
    if (existsSync(projectPath)) {
      res.status(409).json({ error: 'Project already exists' });
      return;
    }

    await fs.mkdir(projectPath, { recursive: true });
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
    res.send(content);
  } catch (err) {
    const status = (err as Error).message === 'Path traversal detected' ? 403 : 500;
    res.status(status).json({ error: String(err) });
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
