import { Router, type Request, type Response } from 'express';
import { execInContainer } from '../services/dockerService';
import { isValidProjectName } from '../services/projectService';
import { workingDiff } from '../services/gitService';

const router = Router({ mergeParams: true });
const CONTAINER_NAME = process.env.CLAUDE_CONTAINER || 'ai-claude';

router.use((req, res, next) => {
  const id = (req.params as Record<string, string>).id;
  if (!id || !isValidProjectName(id)) {
    res.status(400).json({ error: 'Invalid project name' });
    return;
  }
  next();
});

async function gitCmd(projectName: string, cmd: string): Promise<string> {
  return execInContainer(CONTAINER_NAME, `cd /workspace/${projectName} && ${cmd}`);
}

router.get('/status', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const output = await gitCmd(req.params.id, 'git status --porcelain');
    const lines = output ? output.split('\n').filter(Boolean) : [];
    let branch = '';
    try {
      branch = await gitCmd(req.params.id, 'git branch --show-current');
    } catch {
      branch = '';
    }
    res.json({ status: lines, branch });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/diff', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const output = await workingDiff(req.params.id);
    const lines = output ? output.split('\n') : [];
    res.json({ diff: lines });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/commit', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'message is required' });
      return;
    }
    await gitCmd(req.params.id, 'git add -A');
    const output = await gitCmd(req.params.id, `git commit -m ${JSON.stringify(message)}`);
    res.json({ output });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/branch', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._\/-]*$/.test(name) || name.includes('..')) {
      res.status(400).json({ error: 'Invalid branch name' });
      return;
    }
    const output = await gitCmd(req.params.id, `git checkout -b ${name}`);
    res.json({ output });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/rollback', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const output = await gitCmd(req.params.id, 'git checkout -- .');
    res.json({ output: output || 'Changes reverted' });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/log', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const output = await gitCmd(req.params.id, 'git log --oneline -20');
    const log = output ? output.split('\n').filter(Boolean) : [];
    res.json({ log });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/show/:hash', async (req: Request<{ id: string; hash: string }>, res: Response) => {
  try {
    const hash = req.params.hash;
    if (!/^[0-9a-fA-F]{4,40}$/.test(hash)) {
      res.status(400).json({ error: 'Invalid commit hash' });
      return;
    }
    const output = await gitCmd(req.params.id, `git show ${hash}`);
    res.json({ diff: output ? output.split('\n') : [] });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/branches', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const output = await gitCmd(req.params.id, `git branch --format='%(refname:short)'`);
    const branches = output ? output.split('\n').filter(Boolean) : [];
    let current = '';
    try {
      current = await gitCmd(req.params.id, 'git branch --show-current');
    } catch { /* empty repo */ }
    res.json({ branches, current });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/checkout', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._\/-]*$/.test(name) || name.includes('..')) {
      res.status(400).json({ error: 'Invalid branch name' });
      return;
    }
    const output = await gitCmd(req.params.id, `git checkout ${name} 2>&1`);
    res.json({ output });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// git writes progress to stderr even on success — merge it into stdout
router.post('/pull', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const output = await gitCmd(req.params.id, 'git pull --ff-only 2>&1');
    res.json({ output });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/push', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const output = await gitCmd(req.params.id, 'git push -u origin HEAD 2>&1');
    res.json({ output });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
