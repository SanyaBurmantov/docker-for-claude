import { tmuxSessionName } from './dockerService';
import { isValidProjectName } from './projectService';
import { AGENT_IDS } from './agents';

/**
 * What a terminal id points at. Both tabs of a project — the agent one and the shell
 * one — are tmux sessions in the container, and everything the platform does to a
 * pane (attach, scroll, capture) needs the same two answers.
 */
export interface PaneTarget {
  /** tmux session name inside the container. */
  session: string;
  cwd: string;
  /** Shell tab only: the session is created on demand instead of being started via the API. */
  create: boolean;
}

/**
 * Resolves a terminal id: `<agent>-<project>` for an agent tab, `shell-<project>`
 * for the shell one. The prefix is also the tmux session's, so the id the page
 * connects to and the session the API starts are the same string.
 */
export function paneTarget(sessionId: string): PaneTarget | null {
  const prefixes = [...AGENT_IDS, 'shell'];
  const prefix = prefixes.find((p) => sessionId.startsWith(`${p}-`));
  if (!prefix) return null;

  const project = sessionId.slice(prefix.length + 1);
  if (!isValidProjectName(project)) return null;

  return {
    session: tmuxSessionName(project, prefix),
    cwd: `/workspace/${project}`,
    // Only the shell tab creates its session on demand; an agent is started via the API.
    create: prefix === 'shell',
  };
}
