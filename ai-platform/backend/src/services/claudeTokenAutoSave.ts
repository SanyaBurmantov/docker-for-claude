import { listTokens } from './claudeTokens';

/** Credentials are written by Claude itself. Poll inside its container, including
 * when the user logs in through the shell rather than a platform API request. */
export function startClaudeTokenAutoSave(): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let unavailable = false;
  async function capture(): Promise<void> {
    try {
      await listTokens();
      unavailable = false;
    } catch {
      if (!unavailable && !stopped) console.warn('Claude token autosave unavailable; retrying when the container is ready');
      unavailable = true;
    } finally {
      if (!stopped) {
        timer = setTimeout(() => { void capture(); }, 3000);
        timer.unref();
      }
    }
  }
  void capture();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
