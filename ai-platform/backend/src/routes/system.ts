import { Router } from 'express';
import { spawn } from 'child_process';
import { docker, execInContainer } from '../services/dockerService';

const router = Router();
const CONTAINER_NAME = process.env.CLAUDE_CONTAINER || 'ai-claude';

const KNOWN_CONTAINERS = ['ai-gateway', 'ai-claude', 'ai-browser', 'ai-backend', 'ai-frontend'];

// The external-IP probe goes out through the proxy — cache it so the
// dashboard polling does not hammer the network every few seconds
let ipCache: { value: string | null; ts: number } = { value: null, ts: 0 };
let versionCache: { value: string; ts: number } = { value: '', ts: 0 };

router.get('/status', async (_req, res) => {
  try {
    let containers: { name: string; state: string; status: string }[] = [];
    try {
      const list = await docker.listContainers({ all: true });
      containers = KNOWN_CONTAINERS.map((name) => {
        const c = list.find((item) => item.Names.includes(`/${name}`));
        return { name, state: c?.State ?? 'missing', status: c?.Status ?? '' };
      });
    } catch {
      containers = KNOWN_CONTAINERS.map((name) => ({ name, state: 'unknown', status: '' }));
    }

    let externalIp = ipCache.value;
    if (Date.now() - ipCache.ts > 60_000) {
      try {
        const out = await execInContainer(CONTAINER_NAME, 'curl -s --max-time 5 https://api.ipify.org');
        externalIp = /^[0-9a-fA-F.:]+$/.test(out.trim()) ? out.trim() : null;
      } catch {
        externalIp = null;
      }
      ipCache = { value: externalIp, ts: Date.now() };
    }

    let claudeVersion = versionCache.value;
    if (Date.now() - versionCache.ts > 60_000) {
      try {
        claudeVersion = (await execInContainer(CONTAINER_NAME, 'claude --version 2>/dev/null || echo unknown')).trim();
      } catch {
        claudeVersion = 'unknown';
      }
      versionCache = { value: claudeVersion, ts: Date.now() };
    }

    let claudeAuth = false;
    try {
      const out = await execInContainer(
        CONTAINER_NAME,
        '[ -s /home/claude/.claude/.credentials.json ] && echo yes || echo no'
      );
      claudeAuth = out.trim() === 'yes';
    } catch {
      claudeAuth = false;
    }

    res.json({ containers, externalIp, claudeAuth, claudeVersion });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/update-claude', async (_req, res) => {
  try {
    await execInContainer(CONTAINER_NAME, 'npm install -g @anthropic-ai/claude-code@latest');
    const version = (await execInContainer(CONTAINER_NAME, 'claude --version 2>/dev/null || echo unknown')).trim();
    versionCache = { value: version, ts: Date.now() };
    res.json({ version });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Git-over-HTTPS credentials, stored inside the claude-auth volume so they
// survive container rebuilds (credential.helper is set in the entrypoint)
router.post('/git-credentials', async (req, res) => {
  try {
    const { host, username, token } = req.body ?? {};
    if (
      typeof host !== 'string' || !/^[A-Za-z0-9.-]+$/.test(host) ||
      typeof username !== 'string' || !username.trim() ||
      typeof token !== 'string' || !token.trim()
    ) {
      res.status(400).json({ error: 'host, username and token are required' });
      return;
    }
    const line = `https://${encodeURIComponent(username.trim())}:${encodeURIComponent(token.trim())}@${host}`;
    const b64 = Buffer.from(line + '\n', 'utf-8').toString('base64');
    await execInContainer(
      CONTAINER_NAME,
      `echo '${b64}' | base64 -d >> /home/claude/.claude/.git-credentials && chmod 600 /home/claude/.claude/.git-credentials`
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/logs/:name', (req, res) => {
  const name = req.params.name;
  if (!KNOWN_CONTAINERS.includes(name)) {
    res.status(400).json({ error: 'Unknown container' });
    return;
  }
  const child = spawn('docker', ['logs', '--tail', '300', name]);
  let out = '';
  child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
  child.stderr.on('data', (d: Buffer) => { out += d.toString(); });
  child.on('close', () => res.json({ logs: out }));
  child.on('error', (err) => res.status(500).json({ error: String(err) }));
});

router.post('/restart/:name', async (req, res) => {
  try {
    const name = req.params.name;
    if (!KNOWN_CONTAINERS.includes(name)) {
      res.status(400).json({ error: 'Unknown container' });
      return;
    }
    await docker.getContainer(name).restart({ t: 5 });
    // claude/browser share the gateway's network namespace; after a gateway
    // restart their netns is orphaned, so they must be restarted too
    if (name === 'ai-gateway') {
      for (const dep of ['ai-claude', 'ai-browser']) {
        try { await docker.getContainer(dep).restart({ t: 5 }); } catch { /* may not exist */ }
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Claude Code hook events (written by hooks configured in the claude container)
router.get('/events', async (_req, res) => {
  try {
    const out = await execInContainer(
      CONTAINER_NAME,
      'tail -n 100 /tmp/claude-events.log 2>/dev/null || true'
    );
    const events = out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [ts, type, project] = line.split('|');
        return { ts: Number(ts) * 1000, type, project };
      })
      .filter((e) => Number.isFinite(e.ts) && e.ts > 0 && !!e.type && !!e.project);
    res.json({ events });
  } catch {
    res.json({ events: [] });
  }
});

export default router;
