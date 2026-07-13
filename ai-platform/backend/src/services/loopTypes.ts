/**
 * Shared types for the loop-manager, per `ai-platform/docs/loop-manager-spec.md` §3–§4.
 * One file so loopStore/engines/loopService/routes agree on the same shapes.
 */

export type Phase =
  | 'idle'
  | 'analyzing'
  | 'awaiting_approval'
  | 'implementing'
  | 'verifying'
  | 'aggregating'
  | 'done'
  | 'failed'
  | 'stopped';

export type Tier = 'trivial' | 'medium' | 'hard';
/** Slice 1 runs the Claude axis only; opencode/gemini adapters land in slice 2. */
export type EngineId = 'claude' | 'opencode' | 'gemini';
export type Role = 'manager' | 'analyst' | 'executor' | 'tester' | 'reviewer';

export interface ExecutorRef {
  engine: EngineId;
  model: string;
}

export type Severity = 'BUG' | 'RISK' | 'NIT';

export interface ReviewNote {
  severity: Severity;
  file: string;
  line: number;
  msg: string;
}

export interface TestResult {
  command: string;
  passed: boolean;
  failed: string[];
  /** Path under `.loop/` holding the full log tail. */
  logPath: string;
}

export interface Iteration {
  n: number;
  role: Role;
  phase: Phase;
  engine?: ExecutorRef;
  /** One line for the feed. */
  summary: string;
  /** Pointer into `.loop/`, not the body. */
  artifactPath?: string;
  tokens?: { in: number; out: number; cacheRead: number };
  ts: string;
}

/** The manager's per-step decision — the only shape an LLM produces in this system. */
export interface Decision {
  action: 'analyze' | 'implement' | 'test' | 'review' | 'done' | 'ask_human';
  task: string;
  scope: string;
  non_goals: string;
  constraints: string;
  complexity: Tier;
  executor: ExecutorRef;
  rationale: string;
  done_criteria: string;
  open_questions: string[];
}

export interface LoopState {
  project: string;
  goal: string;
  taskSourceLine?: number;
  status: Phase;
  tier: Tier;
  executor: ExecutorRef;
  sessionId: string | null;
  planPath: string;
  findingsSummary: string;
  reviewNotes: ReviewNote[];
  testResults: TestResult[];
  humanNotes: string[];
  currentDiffSha: string | null;
  verifiedDiffSha: string | null;
  /** HEAD before the current decision's first executor attempt — rollback target on escalation. */
  checkpointSha: string | null;
  /** The decision currently awaiting a human answer at the gate, if any. */
  pendingDecision: Decision | null;
  /** The decision the loop is presently implementing/verifying against (survives gate approval). */
  activeDecision: Decision | null;
  fixRounds: number;
  /** Consecutive verify failures at the current tier — resets on tier change or pass. */
  consecutiveFailsAtTier: number;
  /** One-line reason the last verify failed, fed to the next executor/manager turn. */
  lastFailureNote: string | null;
  budget: { maxIterations: number; maxFixRounds: number; deadlineMs: number };
  /** Deadline clock base — reset every time a human gate resumes the loop, so wait time doesn't count. Absent in pre-existing stores. */
  budgetResumedAt?: string;
  iterations: Iteration[];
  createdAt: string;
  updatedAt: string;
}

export interface GatePayload {
  task: string;
  complexity: Tier;
  executor: ExecutorRef;
  planPath: string;
  /** Present only for an `ask_human` decision — the questions blocking progress. */
  openQuestions?: string[];
}

export interface LoopHandlers {
  onTurn(it: Iteration): void;
  onText(chunk: string): void;
  onGate(g: GatePayload): void;
  onPhase(status: Phase): void;
  onDone(state: LoopState): void;
  onError(message: string): void;
  /** A human-authored note just landed in `humanNotes` — otherwise it has no visible trace in the panel. */
  onNote(note: string): void;
}
