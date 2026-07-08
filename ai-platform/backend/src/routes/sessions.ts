import { Router, type Request, type Response } from 'express';
import { execInContainer, execInContainerSync } from '../services/dockerService';

const router = Router({ mergeParams: true });
const CONTAINER_NAME = 'ai-claude';

router.post('/start', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const projectName = req.params.id;
    const sessionName = `claude-${projectName}`;
    const cmd = `cd /workspace/${projectName} && tmux new-session -d -s ${sessionName} 'claude'`;
    await execInContainer(CONTAINER_NAME, cmd);
    res.json({ sessionId: sessionName, status: 'started', running: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/stop', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const projectName = req.params.id;
    const sessionName = `claude-${projectName}`;
    await execInContainer(CONTAINER_NAME, `tmux kill-session -t ${sessionName}`);
    res.json({ status: 'stopped', running: false });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/status', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const projectName = req.params.id;
    const sessionName = `claude-${projectName}`;

    try {
      execInContainerSync(CONTAINER_NAME, `tmux has-session -t ${sessionName}`);
      res.json({ sessionId: sessionName, running: true });
    } catch {
      res.json({ sessionId: null, running: false });
    }
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
