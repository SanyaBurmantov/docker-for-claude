import { randomUUID } from 'crypto';
import { Router, type Request, type Response } from 'express';
import { execInContainer, listTmuxSessions, pasteIntoSession, tmuxSessionName } from '../services/dockerService';
import { isValidProjectName } from '../services/projectService';
import { AGENTS, AGENT_IDS, DEFAULT_AGENT, isAgentId, type AgentId } from '../services/agents';
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

/**
 * Every agent gets its own tmux session in the project — `claude-<project>`,
 * `codex-<project>` and so on — so the page can show them side by side as tabs
 * and each can be started and stopped without touching the others. Claude keeps
 * the historical name, which is also the name a session started before this
 * change already has.
 */
function sessionNameFor(projectName: string, agent: AgentId): string {
  return tmuxSessionName(projectName, agent);
}

/** The agent a request is about; absent means Claude, as it did before agents were a choice. */
function agentOf(value: unknown): AgentId | null {
  if (value === undefined || value === null || value === '') return DEFAULT_AGENT;
  return isAgentId(value) ? value : null;
}

router.post('/start', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const projectName = req.params.id;
    const { mode, prompt, agent } = (req.body ?? {}) as { mode?: string; prompt?: string; agent?: string };

    const agentId = agentOf(agent);
    if (!agentId) {
      res.status(400).json({ error: `Unknown agent: ${agent}` });
      return;
    }
    const spec = AGENTS[agentId];
    const sessionName = sessionNameFor(projectName, agentId);

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
      } else if (mode === 'continue' && spec.continueFlag) {
        // A session started before we recorded ids: we cannot name it, so fall
        // back to the continue flag.
        agentCmd += ` ${spec.continueFlag}`;
      } else {
        sessionId = randomUUID();
        agentCmd += ` ${spec.sessionIdFlag} ${sessionId}`;
      }
    } else if (mode === 'continue' && spec.continueFlag) {
      agentCmd += ` ${spec.continueFlag}`;
    }

    // The prompt travels base64-encoded so arbitrary user text never touches shell syntax
    let startCmd = `tmux new-session -d -s ${sessionName} '${agentCmd}'`;
    if (task) {
      const b64 = Buffer.from(task, 'utf-8').toString('base64');
      const promptFile = `/tmp/.prompt-${sessionName}`;
      const promptArg = spec.promptFlag ? ` ${spec.promptFlag}` : '';
      startCmd =
        `printf '%s' '${b64}' | base64 -d > ${promptFile} && ` +
        `tmux new-session -d -s ${sessionName} '${agentCmd}${promptArg} "$(cat ${promptFile}; rm -f ${promptFile})"'`;
    }

    // Attach-or-create: an existing session is left alone. Its name already says
    // which agent runs in it, so nothing has to be guessed about it.
    const cmd =
      `cd /workspace/${projectName} && ` +
      `if tmux has-session -t ${sessionName} 2>/dev/null; then echo EXISTS; else ${startCmd} && echo STARTED; fi`;
    const started = (await execInContainer(CONTAINER_NAME, cmd)).trim().endsWith('STARTED');

    // Only Claude can be told its conversation id, so only its sessions record one.
    // `agent` stays the last one started here — the dashboard opens the project with it.
    if (started) await update(projectName, { agent: agentId, sessionId }).catch(() => {});
    res.json({ sessionId: sessionName, status: 'started', running: true, agent: agentId });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/stop', async (req: Request<{ id: string }>, res: Response) => {
  const agentId = agentOf((req.body ?? {}).agent);
  if (!agentId) {
    res.status(400).json({ error: 'Unknown agent' });
    return;
  }

  try {
    await execInContainer(CONTAINER_NAME, `tmux kill-session -t ${sessionNameFor(req.params.id, agentId)}`);
    res.json({ status: 'stopped', running: false, agent: agentId });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** One answer for every agent: the page draws a tab per agent and needs all of them. */
router.get('/status', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const projectName = req.params.id;
    const live = new Set(await listTmuxSessions(CONTAINER_NAME));
    const sessions = AGENT_IDS.map((agent) => ({
      agent,
      sessionId: sessionNameFor(projectName, agent),
      running: live.has(sessionNameFor(projectName, agent)),
    }));

    const stored = metaFor(await getAll(), projectName).agent;
    res.json({
      sessions,
      running: sessions.some((s) => s.running),
      /** Agent the project was last opened with — the tab the page starts on. */
      lastAgent: isAgentId(stored) ? stored : DEFAULT_AGENT,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** Types dictated (or otherwise composed) text into an agent's pane, without submitting. */
router.post('/paste', async (req: Request<{ id: string }>, res: Response) => {
  const { text, agent } = (req.body ?? {}) as { text?: unknown; agent?: unknown };
  if (typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'text is required' });
    return;
  }
  const agentId = agentOf(agent);
  if (!agentId) {
    res.status(400).json({ error: 'Unknown agent' });
    return;
  }

  try {
    const pasted = await pasteIntoSession(CONTAINER_NAME, sessionNameFor(req.params.id, agentId), text);
    if (!pasted) {
      res.status(409).json({ error: 'Сессия не запущена — вставлять некуда' });
      return;
    }
    res.json({ success: true });
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
