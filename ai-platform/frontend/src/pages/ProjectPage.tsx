import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  getProject, getSessionStatus, startSession, stopSession,
  getGitStatus, getGitDiff, getGitLog,
  gitCommit, gitBranch, gitRollback,
  Project,
} from '../services/api'
import TerminalComponent from '../components/Terminal'
import DiffViewer from '../components/DiffViewer'
import FileExplorer from '../components/FileExplorer'

type Tab = 'terminal' | 'diff' | 'files' | 'git'

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>()
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('terminal')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessionRunning, setSessionRunning] = useState(false)
  const [gitStatus, setGitStatus] = useState('')
  const [gitDiff, setGitDiff] = useState('')
  const [gitLog, setGitLog] = useState('')
  const [commitMessage, setCommitMessage] = useState('')
  const [branchName, setBranchName] = useState('')
  const [gitLoading, setGitLoading] = useState(false)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    setError(null)
    Promise.all([
      getProject(id).then(setProject),
      getSessionStatus(id).then((s) => {
        setSessionRunning(s.running)
        if (s.sessionId) setSessionId(s.sessionId)
      }),
    ])
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load project'))
      .finally(() => setLoading(false))
  }, [id])

  const loadGitData = useCallback(async () => {
    if (!id) return
    setGitLoading(true)
    try {
      const [status, diff, log] = await Promise.all([
        getGitStatus(id),
        getGitDiff(id),
        getGitLog(id),
      ])
      setGitStatus(status)
      setGitDiff(diff)
      setGitLog(log)
    } catch {
      setGitStatus('Failed to load git data')
      setGitDiff('')
      setGitLog('')
    } finally {
      setGitLoading(false)
    }
  }, [id])

  useEffect(() => {
    if (activeTab === 'git' || activeTab === 'diff') {
      loadGitData()
    }
  }, [activeTab, loadGitData])

  async function handleStartSession() {
    if (!id) return
    try {
      const result = await startSession(id)
      setSessionId(result.sessionId)
      setSessionRunning(true)
    } catch (e) {
      alert(`Failed to start session: ${e instanceof Error ? e.message : 'Unknown error'}`)
    }
  }

  async function handleStopSession() {
    if (!id) return
    try {
      await stopSession(id)
      setSessionRunning(false)
      setSessionId(null)
    } catch (e) {
      alert(`Failed to stop session: ${e instanceof Error ? e.message : 'Unknown error'}`)
    }
  }

  async function handleCommit() {
    if (!id || !commitMessage.trim()) return
    try {
      await gitCommit(id, commitMessage.trim())
      setCommitMessage('')
      await loadGitData()
    } catch (e) {
      alert(`Commit failed: ${e instanceof Error ? e.message : 'Unknown error'}`)
    }
  }

  async function handleBranch() {
    if (!id || !branchName.trim()) return
    try {
      await gitBranch(id, branchName.trim())
      setBranchName('')
    } catch (e) {
      alert(`Branch failed: ${e instanceof Error ? e.message : 'Unknown error'}`)
    }
  }

  async function handleRollback() {
    if (!id) return
    if (!confirm('Are you sure you want to rollback the last commit?')) return
    try {
      await gitRollback(id)
      await loadGitData()
    } catch (e) {
      alert(`Rollback failed: ${e instanceof Error ? e.message : 'Unknown error'}`)
    }
  }

  if (loading) {
    return <div className="loading">Loading project...</div>
  }

  if (error || !project) {
    return (
      <div>
        <div className="error">{error || 'Project not found'}</div>
        <Link to="/" className="btn btn-secondary" style={{ marginTop: 16, display: 'inline-block' }}>
          Back to Projects
        </Link>
      </div>
    )
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'terminal', label: 'Terminal' },
    { key: 'diff', label: 'Diff' },
    { key: 'files', label: 'Files' },
    { key: 'git', label: 'Git' },
  ]

  return (
    <div className="project-page">
      <div className="project-toolbar">
        <div className="project-toolbar-left">
          <Link to="/" className="btn btn-secondary btn-sm">← Back</Link>
          <h2 style={{ fontSize: '1.3rem' }}>{project.name}</h2>
          <span className={sessionRunning ? 'badge badge-running' : 'badge badge-offline'}>
            <span className={`status-indicator ${sessionRunning ? 'running' : 'offline'}`} />
            {sessionRunning ? 'Running' : 'Offline'}
          </span>
          {sessionRunning && (
            <button className="btn btn-danger btn-sm" onClick={handleStopSession}>
              Stop Claude
            </button>
          )}
          {!sessionRunning && (
            <button className="btn btn-success btn-sm" onClick={handleStartSession}>
              Start Claude
            </button>
          )}
        </div>
        <div className="project-toolbar-right">
          <a
            href="http://localhost:6080"
            className="btn btn-secondary btn-sm"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open noVNC
          </a>
        </div>
      </div>

      <div className="tabs">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={`tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="tab-content">
        {activeTab === 'terminal' && (
          <div>
            <TerminalComponent sessionId={sessionId} />
          </div>
        )}

        {activeTab === 'diff' && (
          <div>
            <div className="diff-controls">
              <button className="btn btn-secondary btn-sm" onClick={loadGitData}>
                Refresh Diff
              </button>
            </div>
            <DiffViewer
              original={gitDiff}
              modified=""
              language="diff"
            />
          </div>
        )}

        {activeTab === 'files' && id && (
          <FileExplorer projectId={id} />
        )}

        {activeTab === 'git' && (
          <div className="git-section">
            <div className="git-controls">
              <button className="btn btn-secondary btn-sm" onClick={loadGitData} disabled={gitLoading}>
                Refresh
              </button>
            </div>

            <div>
              <h3 style={{ marginBottom: 8, fontSize: '1rem', color: '#888' }}>Status</h3>
              <div className="git-output">{gitStatus || 'No changes'}</div>
            </div>

            <div>
              <h3 style={{ marginBottom: 8, fontSize: '1rem', color: '#888' }}>Diff</h3>
              {gitDiff ? (
                <DiffViewer original={gitDiff} modified="" language="diff" />
              ) : (
                <div className="no-changes">No changes to show</div>
              )}
            </div>

            <div>
              <h3 style={{ marginBottom: 8, fontSize: '1rem', color: '#888' }}>Actions</h3>
              <div className="git-controls">
                <input
                  type="text"
                  placeholder="Commit message..."
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCommit()}
                />
                <button className="btn btn-primary btn-sm" onClick={handleCommit}>
                  Commit
                </button>
              </div>
              <div className="git-controls" style={{ marginTop: 8 }}>
                <input
                  type="text"
                  placeholder="Branch name..."
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleBranch()}
                />
                <button className="btn btn-warning btn-sm" onClick={handleBranch}>
                  Create Branch
                </button>
                <button className="btn btn-danger btn-sm" onClick={handleRollback}>
                  Rollback
                </button>
              </div>
            </div>

            <div>
              <h3 style={{ marginBottom: 8, fontSize: '1rem', color: '#888' }}>Log</h3>
              <div className="git-output">{gitLog || 'No commits yet'}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
