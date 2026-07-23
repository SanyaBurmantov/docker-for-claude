/**
 * Coding agents that can be started in a project's tmux session.
 *
 * Both are interactive CLIs that own the terminal, so the platform only decides
 * which binary to launch — the model is picked inside the agent itself
 * (`/model` in Claude Code, `/models` in opencode).
 */
export interface AgentSpec {
  bin: string;
  label: string;
  continueFlag: string;
  /** Whether the CLI takes an initial task as a positional argument. */
  supportsPrompt: boolean;
  /** `<bin> --version` prints this agent's version; used to detect it in the container. */
  versionCmd: string;
  /**
   * Flag that pins a fresh conversation to an id the platform chooses, and the
   * flag that later resumes that exact conversation. Together they let us name
   * the transcript instead of guessing it: `continueFlag` resumes whatever ran
   * most recently in the directory, which is not necessarily the session the
   * project page is showing. `null` when the CLI has no such flags.
   */
  sessionIdFlag: string | null;
  resumeFlag: string | null;
}

export const AGENTS = {
  claude: {
    bin: 'claude',
    label: 'Claude Code',
    continueFlag: '--continue',
    supportsPrompt: true,
    versionCmd: 'claude --version',
    sessionIdFlag: '--session-id',
    resumeFlag: '--resume',
  },
  opencode: {
    bin: 'opencode',
    label: 'opencode',
    continueFlag: '--continue',
    // opencode takes the first task through its TUI, not through argv.
    supportsPrompt: false,
    versionCmd: 'opencode --version',
    sessionIdFlag: null,
    resumeFlag: null,
  },
} as const satisfies Record<string, AgentSpec>;

export type AgentId = keyof typeof AGENTS;

export const DEFAULT_AGENT: AgentId = 'claude';

export function isAgentId(value: unknown): value is AgentId {
  return typeof value === 'string' && value in AGENTS;
}
