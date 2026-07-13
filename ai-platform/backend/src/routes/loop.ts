import { Router, type Request, type Response } from 'express';
import { isValidProjectName } from '../services/projectService';
import { openSse } from '../services/sse';
import { startLoop, driveLoop, approveGate, postHumanNote, stopLoop, getLoop, LoopConflictError } from '../services/loopService';
import type { Decision, ExecutorRef } from '../services/loopTypes';

const router = Router({ mergeParams: true });

router.use((req, res, next) => {
  const id = (req.params as Record<string, string>).id;
  if (!id || !isValidProjectName(id)) {
    res.status(400).json({ error: 'Invalid project name' });
    return;
  }
  next();
});

router.post('/', async (req: Request<{ id: string }>, res: Response) => {
  const project = req.params.id;
  const { goal, taskSourceLine } = (req.body ?? {}) as { goal?: string; taskSourceLine?: number };

  if (typeof goal !== 'string' || !goal.trim()) {
    res.status(400).json({ error: 'goal must be a non-empty string' });
    return;
  }

  try {
    const state = await startLoop(project, goal, {
      taskSourceLine: typeof taskSourceLine === 'number' ? taskSourceLine : undefined,
    });
    res.json(state);
  } catch (err) {
    if (err instanceof LoopConflictError) {
      res.status(409).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get('/', async (req: Request<{ id: string }>, res: Response) => {
  const state = await getLoop(req.params.id);
  if (!state) {
    res.status(404).json({ error: 'No loop for this project' });
    return;
  }
  res.json(state);
});

/** Live feed of the loop's turns — the manager panel's only transport. */
router.get('/stream', (req: Request<{ id: string }>, res: Response) => {
  const project = req.params.id;

  let unsubscribe = () => {};
  const sse = openSse(res, () => unsubscribe());

  unsubscribe = driveLoop(project, {
    onTurn: (it) => sse.send({ type: 'turn', it }),
    onText: (text) => sse.send({ type: 'text', text }),
    onGate: (gate) => sse.send({ type: 'gate', gate }),
    onPhase: (status) => sse.send({ type: 'phase', status }),
    onDone: () => sse.send({ type: 'done' }),
    onError: (error) => sse.send({ type: 'error', error }),
  });

  // A freshly opened stream should show the current phase even if nothing changes right away.
  getLoop(project).then((state) => {
    if (state) sse.send({ type: 'phase', status: state.status });
  });
});

router.post('/message', async (req: Request<{ id: string }>, res: Response) => {
  const { note } = (req.body ?? {}) as { note?: string };
  if (typeof note !== 'string' || !note.trim()) {
    res.status(400).json({ error: 'note must be a non-empty string' });
    return;
  }
  try {
    await postHumanNote(req.params.id, note);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post('/gate', async (req: Request<{ id: string }>, res: Response) => {
  const { approve, edit, note } = (req.body ?? {}) as {
    approve?: boolean;
    edit?: Partial<Pick<Decision, 'task' | 'scope' | 'non_goals' | 'constraints' | 'complexity'>> & {
      executor?: ExecutorRef;
    };
    note?: string;
  };

  if (typeof approve !== 'boolean') {
    res.status(400).json({ error: 'approve must be a boolean' });
    return;
  }

  try {
    await approveGate(req.params.id, { approve, edit, note });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post('/stop', async (req: Request<{ id: string }>, res: Response) => {
  try {
    await stopLoop(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
