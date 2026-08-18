/**
 * Coding agents that can be started in a project's tmux session.
 *
 * All of them are interactive CLIs that own the terminal, so the platform only
 * decides which binary to launch — the model is picked inside the agent itself
 * (`/model` in Claude Code and Codex, `/models` in opencode).
 */
export interface AgentSpec {
  bin: string;
  label: string;
  /** Reopens the previous conversation; `null` when the CLI has no such flag. */
  continueFlag: string | null;
  /** Whether the CLI takes an initial task on the command line. */
  supportsPrompt: boolean;
  /** Flag the initial task rides on; `null` when it is a positional argument. */
  promptFlag: string | null;
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
    promptFlag: null,
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
    promptFlag: null,
    versionCmd: 'opencode --version',
    sessionIdFlag: null,
    resumeFlag: null,
  },
  codex: {
    bin: 'codex',
    label: 'Codex',
    // Not a flag but a subcommand: `codex resume --last` reopens the most recent
    // conversation in this directory. It is appended to `bin` exactly like a flag.
    continueFlag: 'resume --last',
    supportsPrompt: true,
    promptFlag: null,
    versionCmd: 'codex --version',
    // Codex names its own sessions (uuid under $CODEX_HOME/sessions) and has no
    // flag to pin one up front, so the platform cannot record the id it started.
    sessionIdFlag: null,
    resumeFlag: null,
  },
  gemini: {
    bin: 'gemini',
    label: 'Gemini',
    // No documented resume flag, so a Gemini session always starts fresh.
    continueFlag: null,
    supportsPrompt: true,
    // `-p` would answer and exit; `-i` opens the TUI with the task already sent.
    promptFlag: '-i',
    versionCmd: 'gemini --version',
    sessionIdFlag: null,
    resumeFlag: null,
  },
} as const satisfies Record<string, AgentSpec>;

export type AgentId = keyof typeof AGENTS;

export const AGENT_IDS = Object.keys(AGENTS) as AgentId[];

export const DEFAULT_AGENT: AgentId = 'claude';

export function isAgentId(value: unknown): value is AgentId {
  return typeof value === 'string' && value in AGENTS;
}
