import { Router, type Response } from 'express';
import {
  addToken, clearToken, listTokens, loginSessionName, removeToken, renameToken, saveCurrentLogin,
  selectedToken, selectToken, startLogin, LAUNCHER, TOKEN_ID,
} from '../services/claudeTokens';
import { isValidProjectName } from '../services/projectService';
import { execInContainer, listTmuxSessions, tmuxSessionName } from '../services/dockerService';
import { getAll, metaFor } from '../services/metadataService';

const router = Router();
const container = process.env.CLAUDE_CONTAINER || 'ai-claude';

/** What the user is allowed to read in a failure. Validation done here produces
 *  the whole message; the storage script runs in the container, so its own
 *  refusals arrive wrapped in an exec error and are matched by phrase. */
const OWN_ERROR = /^(Invalid|Expected|Account name|Unknown)/;
const CONTAINER_ERROR = /No current Claude login to save|Unknown Claude account|Invalid token import/;
function fail(res: Response, err: unknown, fallback: string): void {
  const message = err instanceof Error ? err.message : '';
  const own = OWN_ERROR.test(message) ? message.split('\n')[0] : CONTAINER_ERROR.exec(message)?.[0];
  res.status(own ? 400 : 500).json({ error: own ?? fallback });
}

function tokenId(res: Response, id: string): boolean {
  if (TOKEN_ID.test(id) && id !== 'default') return true;
  res.status(400).json({ error: 'Unknown Claude account' });
  return false;
}

/**
 * Which projects run on the account that just changed: the one being edited, or
 * every project that follows the global choice. A project whose session is not
 * running needs nothing — it picks the account up at its next start.
 */
async function affectedProjects(project?: string): Promise<string[]> {
  if (project) return [project];
  const store = await getAll();
  return Object.keys(store).filter((name) => isValidProjectName(name) && !metaFor(store, name).claudeTokenId);
}

/** A running Claude keeps the account it launched with, so the switch only takes
 *  effect once tmux restarts it on the same conversation. */
async function restartClaudeSessions(projects: string[]): Promise<string[]> {
  if (!projects.length) return [];
  const sessions = await listTmuxSessions(container);
  const store = await getAll();
  const restarted: string[] = [];
  for (const name of projects) {
    const session = tmuxSessionName(name, 'claude');
    if (!isValidProjectName(name) || !sessions.includes(session)) continue;
    const prior = metaFor(store, name).sessionId;
    const resume = prior && TOKEN_ID.test(prior) && prior !== 'default' ? `--resume ${prior}` : '--continue';
    const id = await selectedToken(name);
    await execInContainer(container,
      `tmux kill-session -t ${session} && cd /workspace/${name} && tmux new-session -d -s ${session} '${LAUNCHER} ${id} ${resume}'`);
    restarted.push(name);
  }
  return restarted;
}

router.use((req, res, next) => {
  if (req.query.project !== undefined && (typeof req.query.project !== 'string' || !isValidProjectName(req.query.project))) {
    res.status(400).json({ error: 'Invalid project name' }); return;
  }
  res.set('Cache-Control', 'no-store');
  next();
});
router.get('/', async (req, res) => {
  try {
    const project = req.query.project as string | undefined;
    res.json({
      tokens: await listTokens(),
      selected: await selectedToken(project),
      // Tells the page whether this project has an account of its own or is
      // showing the global one.
      inherited: Boolean(project) && !metaFor(await getAll(), project!).claudeTokenId,
    });
  } catch { res.status(500).json({ error: 'Cannot load Claude tokens' }); }
});
router.post('/', async (req, res) => {
  try { res.status(201).json({ tokens: await addToken(req.body?.name, req.body?.token) }); }
  catch (err) { fail(res, err, 'Cannot save Claude token'); }
});
router.post('/capture', async (req, res) => {
  try { res.json({ tokens: await saveCurrentLogin(req.query.project as string | undefined) }); }
  catch (err) { fail(res, err, 'Cannot save current Claude login'); }
});
// Signing in to another account: an empty profile plus a terminal of its own, so
// the OAuth flow runs in a clean Claude instead of logging the current one out.
router.post('/login', async (req, res) => {
  try {
    const { id, tokens } = await startLogin(req.body?.name);
    const session = loginSessionName(id);
    await execInContainer(container,
      `cd /workspace && tmux kill-session -t ${session} 2>/dev/null; tmux new-session -d -s ${session} '${LAUNCHER} ${id}'`);
    res.status(201).json({ id, session, tokens });
  } catch (err) { fail(res, err, 'Cannot open a Claude login window'); }
});
router.delete('/login/:id', async (req, res) => {
  const id = req.params.id;
  if (!tokenId(res, id)) return;
  try {
    await execInContainer(container, `tmux kill-session -t ${loginSessionName(id)} 2>/dev/null; true`);
    // An abandoned login leaves an empty profile behind; drop it so the list
    // only offers accounts that can actually be used.
    const tokens = await listTokens();
    const profile = tokens.find((token) => token.id === id);
    res.json({ tokens: profile && !profile.hasLogin ? await removeToken(id) : tokens });
  } catch (err) { fail(res, err, 'Cannot close the Claude login window'); }
});
router.patch('/:id', async (req, res) => {
  const id = req.params.id;
  if (!tokenId(res, id)) return;
  try { res.json({ tokens: await renameToken(id, req.body?.name) }); }
  catch (err) { fail(res, err, 'Cannot rename the Claude account'); }
});
router.delete('/:id', async (req, res) => {
  const id = req.params.id;
  if (!tokenId(res, id)) return;
  try {
    const tokens = await removeToken(id);
    // A selection left pointing at a deleted profile would launch Claude with an
    // empty config dir and no login, so those fall back to the inherited account.
    const store = await getAll();
    const orphaned = Object.keys(store).filter((name) => metaFor(store, name).claudeTokenId === id);
    for (const name of orphaned) await clearToken(name);
    res.json({ tokens, restarted: await restartClaudeSessions(orphaned.filter(isValidProjectName)) });
  } catch (err) { fail(res, err, 'Cannot delete the Claude account'); }
});
// Serialize switches so concurrent clicks cannot restart with stale credentials.
let switches: Promise<unknown> = Promise.resolve();
router.put('/selected', (req, res) => {
  const task = switches.then(async () => {
    const project = req.query.project as string | undefined;
    const inherit = req.body?.inherit === true;
    const id = req.body?.id;
    if (inherit && !project) { res.status(400).json({ error: 'Only a project can follow the global account' }); return; }
    if (!inherit && (typeof id !== 'string' || !TOKEN_ID.test(id) || !(await listTokens()).some((t) => t.id === id))) {
      res.status(400).json({ error: 'Unknown Claude token' }); return;
    }
    const before = await selectedToken(project);
    // Save first: a restart error must leave the choice made and the session alone.
    if (inherit) await clearToken(project!); else await selectToken(project, id);
    const selected = await selectedToken(project);
    const restarted = selected === before ? [] : await restartClaudeSessions(await affectedProjects(project));
    res.json({ selected, inherited: inherit, restarted });
  });
  switches = task.catch(() => {});
  task.catch(() => { res.status(500).json({ error: 'Cannot switch Claude token; check session status before continuing' }); });
});
export default router;
