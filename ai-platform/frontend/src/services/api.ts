export interface Project {
  name: string
  path: string
  size: string
  hasGit: boolean
  lastActivity: string | null
  running: boolean
  favorite: boolean
  /** When the project page was last opened here; null if never. */
  lastOpened: string | null
}

export interface ContainerState {
  name: string
  state: string
  status: string
}

export interface SystemStatus {
  containers: ContainerState[]
  externalIp: string | null
  claudeAuth: boolean
  claudeVersion: string
}

export interface ClaudeEvent {
  ts: number
  type: 'notification' | 'stop'
  project: string
}

export type AgentId = 'claude' | 'opencode'

export interface AgentInfo {
  id: AgentId
  label: string
  version: string
  /** Whether the agent can be handed a task on the command line. */
  supportsPrompt: boolean
}

export interface StartSessionOptions {
  mode?: 'continue'
  prompt?: string
  agent?: AgentId
}

export const NOVNC_PORT = 9901

export function novncUrl(): string {
  // resize=scale fits the 1920x1080 desktop into the window; reconnect survives container restarts.
  // noVNC will still prompt for the VNC password (VNC_PASSWORD in .env, default "claude").
  return `http://${window.location.hostname}:${NOVNC_PORT}/vnc.html?autoconnect=1&resize=scale&reconnect=1`
}

export interface FileItem {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileItem[]
}

const BASE = ''

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`HTTP ${res.status}: ${text}`)
  }
  if (res.status === 204) return undefined as T
  if (res.headers.get('content-type')?.includes('application/json')) {
    return res.json()
  }
  return res.text() as T
}

export function fetchProjects(): Promise<Project[]> {
  return request<Project[]>('/api/projects')
}

export function addProject(name: string, gitUrl?: string): Promise<Project> {
  return request<Project>('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ name, gitUrl: gitUrl || undefined }),
  })
}

export function fetchSystemStatus(): Promise<SystemStatus> {
  return request<SystemStatus>('/api/system/status')
}

export interface ServerTime {
  /** The server's wall clock at the moment it answered. */
  iso: string
  /** IANA zone of the server, so the header renders its clock and not the viewer's. */
  timeZone: string
}

export function getServerTime(): Promise<ServerTime> {
  return request<ServerTime>('/api/system/time')
}

export function getProject(id: string): Promise<Project> {
  return request<Project>(`/api/projects/${id}`)
}

export function deleteProject(id: string): Promise<void> {
  return request<void>(`/api/projects/${id}`, { method: 'DELETE' })
}

/** Records the project as opened now, which is what the dashboard sorts on. */
export function markProjectOpened(id: string): Promise<{ lastOpened: string }> {
  return request<{ lastOpened: string }>(`/api/projects/${id}/open`, { method: 'POST' })
}

export function setProjectFavorite(id: string, favorite: boolean): Promise<{ favorite: boolean }> {
  return request<{ favorite: boolean }>(`/api/projects/${id}/favorite`, {
    method: 'PUT',
    body: JSON.stringify({ favorite }),
  })
}

/** Agents actually installed in the Claude container, newest status cached server-side. */
export function fetchAgents(): Promise<AgentInfo[]> {
  return request<{ agents: AgentInfo[] }>('/api/system/agents').then((r) => r.agents)
}

export function fetchFiles(id: string): Promise<FileItem[]> {
  return request<FileItem[]>(`/api/projects/${id}/files`)
}

export function fetchFileContent(id: string, path: string): Promise<string> {
  return request<string>(`/api/projects/${id}/files/${encodeURIComponent(path)}`)
}

export function saveFileContent(id: string, path: string, content: string): Promise<void> {
  return request<void>(`/api/projects/${id}/files/${encodeURIComponent(path)}`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  })
}

/** Checklists live in the project root so Claude can read and edit them too. */
export const TASKS_FILE = 'TASKS.md'
export const FIXES_FILE = 'FIXES.md'

/** Returns null when the project has no such file yet, as opposed to failing. */
export async function fetchChecklistFile(id: string, file: string): Promise<string | null> {
  const res = await fetch(`/api/projects/${id}/files/${encodeURIComponent(file)}`)
  if (res.status === 404) return null
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`HTTP ${res.status}: ${text}`)
  }
  return res.text()
}

export function saveChecklistFile(id: string, file: string, content: string): Promise<void> {
  return saveFileContent(id, file, content)
}

/** Reports back the agent it actually started, which may differ from the request. */
export function startSession(id: string, opts: StartSessionOptions = {}): Promise<{ sessionId: string; agent: AgentId }> {
  return request<{ sessionId: string; agent: AgentId }>(`/api/projects/${id}/session/start`, {
    method: 'POST',
    body: JSON.stringify(opts),
  })
}

export function stopSession(id: string): Promise<void> {
  return request<void>(`/api/projects/${id}/session/stop`, { method: 'POST' })
}

export function getSessionStatus(id: string): Promise<{ running: boolean; sessionId?: string; agent: AgentId }> {
  return request<{ running: boolean; sessionId?: string; agent: AgentId }>(`/api/projects/${id}/session/status`)
}

export function getGitStatus(id: string): Promise<{ text: string; branch: string }> {
  return request<{ status: string[]; branch: string }>(`/api/projects/${id}/git/status`).then((r) => ({
    text: r.status.join('\n'),
    branch: r.branch,
  }))
}

export function getGitDiff(id: string): Promise<string> {
  return request<{ diff: string[] }>(`/api/projects/${id}/git/diff`).then((r) => r.diff.join('\n'))
}

export function gitCommit(id: string, message: string): Promise<void> {
  return request<void>(`/api/projects/${id}/git/commit`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  })
}

export function gitBranch(id: string, name: string): Promise<void> {
  return request<void>(`/api/projects/${id}/git/branch`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export function gitRollback(id: string): Promise<void> {
  return request<void>(`/api/projects/${id}/git/rollback`, { method: 'POST' })
}

export function getGitLog(id: string): Promise<string[]> {
  return request<{ log: string[] }>(`/api/projects/${id}/git/log`).then((r) => r.log)
}

export function getGitShow(id: string, hash: string): Promise<string> {
  return request<{ diff: string[] }>(`/api/projects/${id}/git/show/${hash}`).then((r) => r.diff.join('\n'))
}

export function getGitBranches(id: string): Promise<{ branches: string[]; current: string }> {
  return request<{ branches: string[]; current: string }>(`/api/projects/${id}/git/branches`)
}

export function gitCheckout(id: string, name: string): Promise<string> {
  return request<{ output: string }>(`/api/projects/${id}/git/checkout`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  }).then((r) => r.output)
}

export function gitPull(id: string): Promise<string> {
  return request<{ output: string }>(`/api/projects/${id}/git/pull`, { method: 'POST' }).then((r) => r.output)
}

export function gitPush(id: string): Promise<string> {
  return request<{ output: string }>(`/api/projects/${id}/git/push`, { method: 'POST' }).then((r) => r.output)
}

/** Asks Claude for a one-line commit message describing the uncommitted diff. */
export function generateCommitMessage(id: string, signal?: AbortSignal): Promise<string> {
  return request<{ message: string }>(`/api/projects/${id}/commit-message`, {
    method: 'POST',
    signal,
  }).then((r) => r.message)
}

export function fetchEvents(): Promise<ClaudeEvent[]> {
  return request<{ events: ClaudeEvent[] }>('/api/system/events').then((r) => r.events)
}

export function updateClaude(): Promise<string> {
  return request<{ version: string }>('/api/system/update-claude', { method: 'POST' }).then((r) => r.version)
}

export function saveGitCredentials(host: string, username: string, token: string): Promise<void> {
  return request<void>('/api/system/git-credentials', {
    method: 'POST',
    body: JSON.stringify({ host, username, token }),
  })
}

export function fetchContainerLogs(name: string): Promise<string> {
  return request<{ logs: string }>(`/api/system/logs/${name}`).then((r) => r.logs)
}

export function restartContainer(name: string): Promise<void> {
  return request<void>(`/api/system/restart/${name}`, { method: 'POST' })
}

export type FsAction = 'create-file' | 'mkdir' | 'rename' | 'delete'

export function fsAction(id: string, action: FsAction, relPath: string, newPath?: string): Promise<void> {
  return request<void>(`/api/projects/${id}/fs`, {
    method: 'POST',
    body: JSON.stringify({ action, path: relPath, newPath }),
  })
}

export function archiveUrl(id: string): string {
  return `/api/projects/${id}/archive`
}

export interface GeminiStatus {
  configured: boolean
  model: string
  models: string[]
  viaProxy: boolean
}

export interface GeminiMessage {
  role: 'user' | 'model'
  text: string
}

export function fetchGeminiStatus(): Promise<GeminiStatus> {
  return request<GeminiStatus>('/api/gemini/status')
}

/** Reads an SSE response of {text|error|done} frames, invoking onText per chunk. */
async function consumeTextStream(res: Response, onText: (chunk: string) => void): Promise<void> {
  if (!res.ok || !res.body) {
    const raw = await res.text().catch(() => res.statusText)
    let message = raw
    try {
      message = JSON.parse(raw).error ?? raw
    } catch {
      // non-JSON error body — show it as-is
    }
    throw new Error(message || `HTTP ${res.status}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload) continue

      const event = JSON.parse(payload) as { text?: string; error?: string; done?: boolean }
      if (event.error) throw new Error(event.error)
      if (event.text) onText(event.text)
    }
  }
}

/** Streams the reply, invoking onText for each chunk. Resolves when complete. */
export async function streamGeminiChat(
  messages: GeminiMessage[],
  model: string,
  onText: (chunk: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch('/api/gemini/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, model }),
    signal,
  })
  await consumeTextStream(res, onText)
}

/** "what" describes the selection alone; "how" lets Claude read the project. */
export type ExplainMode = 'what' | 'how'

export interface ExplainRequest {
  mode: ExplainMode
  code: string
  file?: string
  hunk?: string
}

/** Asks Claude, running inside the project directory, about a diff selection. */
export async function streamExplain(
  projectId: string,
  body: ExplainRequest,
  onText: (chunk: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/explain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  await consumeTextStream(res, onText)
}

/** Streams Claude's review of the uncommitted diff. The backend reads the diff itself. */
export async function streamReview(
  projectId: string,
  onText: (chunk: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
  })
  await consumeTextStream(res, onText)
}

// ============ Loop-manager ============

export type LoopPhase =
  | 'idle'
  | 'analyzing'
  | 'awaiting_approval'
  | 'implementing'
  | 'verifying'
  | 'aggregating'
  | 'done'
  | 'failed'
  | 'stopped'

export type LoopTier = 'trivial' | 'medium' | 'hard'
export type LoopEngineId = 'claude' | 'opencode' | 'gemini'
export type LoopRole = 'manager' | 'analyst' | 'executor' | 'tester' | 'reviewer'

export interface LoopExecutorRef {
  engine: LoopEngineId
  model: string
}

export interface LoopReviewNote {
  severity: 'BUG' | 'RISK' | 'NIT'
  file: string
  line: number
  msg: string
}

export interface LoopTestResult {
  command: string
  passed: boolean
  failed: string[]
  logPath: string
}

export interface LoopIteration {
  n: number
  role: LoopRole
  phase: LoopPhase
  engine?: LoopExecutorRef
  summary: string
  artifactPath?: string
  tokens?: { in: number; out: number; cacheRead: number }
  ts: string
}

export interface LoopDecision {
  action: 'analyze' | 'implement' | 'test' | 'review' | 'done' | 'ask_human'
  task: string
  scope: string
  non_goals: string
  constraints: string
  complexity: LoopTier
  executor: LoopExecutorRef
  rationale: string
  done_criteria: string
  open_questions: string[]
}

export interface LoopGatePayload {
  task: string
  complexity: LoopTier
  executor: LoopExecutorRef
  planPath: string
  openQuestions?: string[]
}

export interface LoopState {
  project: string
  goal: string
  taskSourceLine?: number
  status: LoopPhase
  tier: LoopTier
  executor: LoopExecutorRef
  sessionId: string | null
  planPath: string
  findingsSummary: string
  reviewNotes: LoopReviewNote[]
  testResults: LoopTestResult[]
  humanNotes: string[]
  currentDiffSha: string | null
  verifiedDiffSha: string | null
  checkpointSha: string | null
  pendingDecision: LoopDecision | null
  activeDecision: LoopDecision | null
  fixRounds: number
  consecutiveFailsAtTier: number
  lastFailureNote: string | null
  budget: { maxIterations: number; maxFixRounds: number; deadlineMs: number }
  budgetResumedAt?: string
  iterations: LoopIteration[]
  createdAt: string
  updatedAt: string
}

export type LoopStreamEvent =
  | { type: 'turn'; it: LoopIteration }
  | { type: 'text'; text: string }
  | { type: 'gate'; gate: LoopGatePayload }
  | { type: 'phase'; status: LoopPhase }
  | { type: 'note'; note: string }
  | { type: 'done' }
  | { type: 'error'; error: string }

export function startLoop(id: string, goal: string, taskSourceLine?: number): Promise<LoopState> {
  return request<LoopState>(`/api/projects/${id}/loop`, {
    method: 'POST',
    body: JSON.stringify({ goal, taskSourceLine }),
  })
}

/** Null when the project has no loop yet (including one that never started), same convention as fetchChecklistFile. */
export async function fetchLoop(id: string): Promise<LoopState | null> {
  const res = await fetch(`/api/projects/${id}/loop`)
  if (res.status === 404) return null
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`HTTP ${res.status}: ${text}`)
  }
  return res.json()
}

export function postLoopMessage(id: string, note: string): Promise<void> {
  return request<void>(`/api/projects/${id}/loop/message`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  })
}

export interface LoopGateDecision {
  approve: boolean
  edit?: Partial<Pick<LoopDecision, 'task' | 'scope' | 'non_goals' | 'constraints' | 'complexity'>> & {
    executor?: LoopExecutorRef
  }
  note?: string
}

export function resolveLoopGate(id: string, decision: LoopGateDecision): Promise<void> {
  return request<void>(`/api/projects/${id}/loop/gate`, {
    method: 'POST',
    body: JSON.stringify(decision),
  })
}

export function stopLoopRun(id: string): Promise<void> {
  return request<void>(`/api/projects/${id}/loop/stop`, { method: 'POST' })
}

/**
 * The loop's feed is a GET SSE stream (no request body needed), so plain
 * EventSource does the job — unlike the POST-based explain/review/commit
 * streams, which need `consumeTextStream`'s fetch+reader parsing instead.
 */
export function streamLoop(id: string, onEvent: (e: LoopStreamEvent) => void): () => void {
  const es = new EventSource(`/api/projects/${id}/loop/stream`)
  es.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data) as LoopStreamEvent)
    } catch {
      // an unparsable frame is not worth dropping the connection over
    }
  }
  return () => es.close()
}

export async function uploadFiles(id: string, dir: string, files: File[]): Promise<void> {
  const fd = new FormData()
  files.forEach((f) => fd.append('files', f))
  const res = await fetch(`/api/projects/${id}/upload?dir=${encodeURIComponent(dir)}`, {
    method: 'POST',
    body: fd,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`HTTP ${res.status}: ${text}`)
  }
}
