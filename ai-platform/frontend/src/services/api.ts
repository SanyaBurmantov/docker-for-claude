export interface Project {
  name: string
  path: string
  size: string
  hasGit: boolean
  lastActivity: string | null
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

export function addProject(path: string): Promise<Project> {
  return request<Project>('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ name: path }),
  })
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

export function startSession(id: string): Promise<{ sessionId: string }> {
  return request<{ sessionId: string }>(`/api/projects/${id}/session/start`, { method: 'POST' })
}

export function stopSession(id: string): Promise<void> {
  return request<void>(`/api/projects/${id}/session/stop`, { method: 'POST' })
}

export function getSessionStatus(id: string): Promise<{ running: boolean; sessionId?: string }> {
  return request<{ running: boolean; sessionId?: string }>(`/api/projects/${id}/session/status`)
}

export function getGitStatus(id: string): Promise<string> {
  return request<string>(`/api/projects/${id}/git/status`)
}

export function getGitDiff(id: string): Promise<string> {
  return request<string>(`/api/projects/${id}/git/diff`)
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

export function getGitLog(id: string): Promise<string> {
  return request<string>(`/api/projects/${id}/git/log`)
}
