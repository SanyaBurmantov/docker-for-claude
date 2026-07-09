import { Router, type Request, type Response } from 'express';
import { execInContainer, execInContainerSync, tmuxSessionName } from '../services/dockerService';
import { isValidProjectName } from '../services/projectService';

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

router.post('/start', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const projectName = req.params.id;
    const sessionName = tmuxSessionName(projectName);
    const { mode, prompt } = (req.body ?? {}) as { mode?: string; prompt?: string };

    let claudeCmd = 'claude';
    if (mode === 'continue') claudeCmd += ' --continue';

    // The prompt travels base64-encoded so arbitrary user text never touches shell syntax
    let startCmd = `tmux new-session -d -s ${sessionName} '${claudeCmd}'`;
    if (prompt && typeof prompt === 'string' && prompt.trim()) {
      const b64 = Buffer.from(prompt.trim(), 'utf-8').toString('base64');
      const promptFile = `/tmp/.prompt-${sessionName}`;
      startCmd =
        `printf '%s' '${b64}' | base64 -d > ${promptFile} && ` +
        `tmux new-session -d -s ${sessionName} '${claudeCmd} "$(cat ${promptFile}; rm -f ${promptFile})"'`;
    }

    const cmd = `cd /workspace/${projectName} && (tmux has-session -t ${sessionName} 2>/dev/null || (${startCmd}))`;
    await execInContainer(CONTAINER_NAME, cmd);
    res.json({ sessionId: `claude-${projectName}`, status: 'started', running: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/stop', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const projectName = req.params.id;
    const sessionName = tmuxSessionName(projectName);
    await execInContainer(CONTAINER_NAME, `tmux kill-session -t ${sessionName}`);
    res.json({ status: 'stopped', running: false });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/status', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const projectName = req.params.id;
    const sessionName = tmuxSessionName(projectName);

    try {
      execInContainerSync(CONTAINER_NAME, `tmux has-session -t ${sessionName}`);
      res.json({ sessionId: `claude-${projectName}`, running: true });
    } catch {
      res.json({ sessionId: null, running: false });
    }
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
