import { randomUUID } from 'crypto';
import { Router, type Request, type Response } from 'express';
import { execInContainer, execInContainerSync, tmuxSessionName } from '../services/dockerService';
import { isValidProjectName } from '../services/projectService';
import { AGENTS, DEFAULT_AGENT, isAgentId, type AgentId } from '../services/agents';
import { getAll, metaFor, update } from '../services/metadataService';

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

    // The tmux session keeps its historical "claude-" name whichever agent runs
    // inside it: the terminal tab, the running-status probe and the stop button
    // all address the session by that name.
    const sessionName = tmuxSessionName(projectName);
    const { mode, prompt, agent } = (req.body ?? {}) as { mode?: string; prompt?: string; agent?: string };

    if (agent !== undefined && !isAgentId(agent)) {
      res.status(400).json({ error: `Unknown agent: ${agent}` });
      return;
    }
    const agentId: AgentId = agent ?? DEFAULT_AGENT;
    const spec = AGENTS[agentId];

    const task = typeof prompt === 'string' ? prompt.trim() : '';
    if (task && !spec.supportsPrompt) {
      res.status(400).json({ error: `${spec.label} нельзя запустить сразу с задачей` });
      return;
    }

    const meta = metaFor(await getAll(), projectName);
    const priorSessionId = meta.sessionId;

    // Resuming by id, not by the bare continue flag: that flag reopens whatever
    // ran last in the project, which may be a one-shot helper query. So the
    // conversation gets named up front and the id is recorded below.
    let agentCmd = spec.bin;
    let sessionId: string | null = null;

    if (spec.sessionIdFlag && spec.resumeFlag) {
      if (mode === 'continue' && priorSessionId) {
        agentCmd += ` ${spec.resumeFlag} ${priorSessionId}`;
        sessionId = priorSessionId;
      } else if (mode === 'continue') {
        // A session started before we recorded ids: we cannot name it, so fall
        // back to the continue flag.
        agentCmd += ` ${spec.continueFlag}`;
      } else {
        sessionId = randomUUID();
        agentCmd += ` ${spec.sessionIdFlag} ${sessionId}`;
      }
    } else if (mode === 'continue') {
      agentCmd += ` ${spec.continueFlag}`;
    }

    // The prompt travels base64-encoded so arbitrary user text never touches shell syntax
    let startCmd = `tmux new-session -d -s ${sessionName} '${agentCmd}'`;
    if (task) {
      const b64 = Buffer.from(task, 'utf-8').toString('base64');
      const promptFile = `/tmp/.prompt-${sessionName}`;
      startCmd =
        `printf '%s' '${b64}' | base64 -d > ${promptFile} && ` +
        `tmux new-session -d -s ${sessionName} '${agentCmd} "$(cat ${promptFile}; rm -f ${promptFile})"'`;
    }

    // Attach-or-create: an existing session is left alone, whatever agent runs in
    // it. Saying "STARTED" only when one was created keeps the recorded agent —
    // and the badge the UI draws from it — honest about what is really running.
    const cmd =
      `cd /workspace/${projectName} && ` +
      `if tmux has-session -t ${sessionName} 2>/dev/null; then echo EXISTS; else ${startCmd} && echo STARTED; fi`;
    const started = (await execInContainer(CONTAINER_NAME, cmd)).trim().endsWith('STARTED');

    const runningAgent: AgentId = started ? agentId : isAgentId(meta.agent) ? meta.agent : DEFAULT_AGENT;

    // Only a session we actually created gets its id recorded: an existing one is
    // left alone, and so is the id already stored for it.
    if (started) await update(projectName, { agent: agentId, sessionId }).catch(() => {});
    res.json({ sessionId: `claude-${projectName}`, status: 'started', running: true, agent: runningAgent });
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
    const stored = metaFor(await getAll(), projectName).agent;
    const agent: AgentId = isAgentId(stored) ? stored : DEFAULT_AGENT;

    try {
      execInContainerSync(CONTAINER_NAME, `tmux has-session -t ${sessionName}`);
      res.json({ sessionId: `claude-${projectName}`, running: true, agent });
    } catch {
      res.json({ sessionId: null, running: false, agent });
    }
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Claude runs under tmux with mouse mode on, so a drag-select inside it lands in
// tmux's own paste buffer, not xterm's selection. Expose the most recent buffer so
// the UI can pull it out and the user can copy it in the browser. `|| true` keeps
// the exec at code 0 (empty output) when no buffer has been set yet.
router.get('/tmux-buffer', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const text = await execInContainer(CONTAINER_NAME, 'tmux show-buffer 2>/dev/null || true');
    res.json({ text });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
