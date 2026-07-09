export interface Project {
  name: string
  path: string
  size: string
  hasGit: boolean
  lastActivity: string | null
  running: boolean
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

export interface StartSessionOptions {
  mode?: 'continue'
  prompt?: string
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

export function getProject(id: string): Promise<Project> {
  return request<Project>(`/api/projects/${id}`)
}

export function deleteProject(id: string): Promise<void> {
  return request<void>(`/api/projects/${id}`, { method: 'DELETE' })
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

export function startSession(id: string, opts: StartSessionOptions = {}): Promise<{ sessionId: string }> {
  return request<{ sessionId: string }>(`/api/projects/${id}/session/start`, {
    method: 'POST',
    body: JSON.stringify(opts),
  })
}

export function stopSession(id: string): Promise<void> {
  return request<void>(`/api/projects/${id}/session/stop`, { method: 'POST' })
}

export function getSessionStatus(id: string): Promise<{ running: boolean; sessionId?: string }> {
  return request<{ running: boolean; sessionId?: string }>(`/api/projects/${id}/session/status`)
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
