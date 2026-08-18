import { Router, type Request, type Response } from 'express';
import { execInContainer } from '../services/dockerService';
import { paneTarget } from '../services/paneTarget';

/**
 * Scrolling and reading back a pane — both have to happen on the container side.
 *
 * Everything the UI shows runs inside tmux, and tmux draws on the alternate screen,
 * where xterm.js has no scrollback at all: its own `scrollToTop`/`scrollToBottom`
 * and its buffer dump see only the visible screen. So the buttons drive tmux.
 */
const router = Router();

const CONTAINER_NAME = process.env.CLAUDE_CONTAINER || 'ai-claude';

/** How far back `capture` reaches — the same order of magnitude as xterm's scrollback. */
const CAPTURE_LINES = 10000;

type Direction = 'up' | 'down' | 'top' | 'bottom';

const DIRECTIONS: readonly Direction[] = ['up', 'down', 'top', 'bottom'];

// Inside copy-mode. `cancel` leaves it and jumps back to the live output, which is
// exactly what "scroll to the bottom" means here.
const COPY_MODE_MOVES: Record<Direction, string> = {
  up: 'halfpage-up',
  down: 'halfpage-down',
  top: 'history-top',
  bottom: 'cancel',
};

// A full-screen TUI (opencode, codex, gemini) draws on the alternate screen, and tmux
// keeps no history for that — copy-mode would open on an empty pane. There the
// scrollback belongs to the application, so the keys go straight to it and whatever
// it does with PageUp/PageDown is what scrolling means in that pane.
const APP_KEYS: Record<Direction, string> = {
  up: 'PageUp',
  down: 'PageDown',
  top: 'PageUp',
  bottom: 'PageDown',
};

function targetOr400(req: Request, res: Response) {
  const target = paneTarget(String(req.params.sessionId));
  if (!target) {
    res.status(400).json({ error: 'Invalid session id' });
    return null;
  }
  return target;
}

router.post('/:sessionId/scroll', async (req: Request, res: Response) => {
  const target = targetOr400(req, res);
  if (!target) return;

  const { direction } = (req.body ?? {}) as { direction?: Direction };
  if (!direction || !DIRECTIONS.includes(direction)) {
    res.status(400).json({ error: 'direction must be up, down, top or bottom' });
    return;
  }

  // `|| true` throughout: a pane that is not scrolled is not in copy-mode, so
  // `send-keys -X` fails there — a dead button beats a 500.
  const session = target.session;
  const copyMode =
    direction === 'bottom'
      ? `tmux send-keys -X -t ${session} cancel 2>/dev/null || true`
      : `tmux copy-mode -t ${session} 2>/dev/null; ` +
        `tmux send-keys -X -t ${session} ${COPY_MODE_MOVES[direction]} 2>/dev/null || true`;

  const cmd =
    `if [ "$(tmux display-message -p -t ${session} '#{alternate_on}' 2>/dev/null)" = "1" ]; then ` +
    `tmux send-keys -t ${session} ${APP_KEYS[direction]} 2>/dev/null || true; ` +
    `else ${copyMode}; fi`;

  try {
    await execInContainer(CONTAINER_NAME, cmd);
    res.json({ scrolled: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/**
 * The pane's scrollback as text — what "Весь вывод" needs and what xterm cannot give.
 * For a full-screen TUI this is the visible screen and little more, for the same
 * reason as above: its output never enters tmux's history.
 */
router.get('/:sessionId/capture', async (req: Request, res: Response) => {
  const target = targetOr400(req, res);
  if (!target) return;

  try {
    // -J unwraps lines the pane had to break, so a long line comes back in one piece.
    const text = await execInContainer(
      CONTAINER_NAME,
      `tmux capture-pane -p -J -S -${CAPTURE_LINES} -t ${target.session} 2>/dev/null || true`
    );
    res.json({ text });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
