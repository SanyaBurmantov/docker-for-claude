import { Router, type Request, type Response } from 'express';
import { execInContainer } from '../services/dockerService';

const router = Router({ mergeParams: true });
const CONTAINER_NAME = 'ai-claude';

async function gitCmd(projectName: string, cmd: string): Promise<string> {
  return execInContainer(CONTAINER_NAME, `cd /workspace/${projectName} && ${cmd}`);
}

router.get('/status', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const output = await gitCmd(req.params.id, 'git status --porcelain');
    const lines = output ? output.split('\n').filter(Boolean) : [];
    res.json({ status: lines });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/diff', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const output = await gitCmd(req.params.id, 'git diff');
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
    const output = await gitCmd(req.params.id, 'git log --oneline -10');
    const log = output ? output.split('\n').filter(Boolean) : [];
    res.json({ log });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
