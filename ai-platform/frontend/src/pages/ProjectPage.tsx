import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import {
  getProject, getSessionStatus, startSession, stopSession,
  getGitStatus, getGitDiff, getGitLog, getGitShow, getGitBranches,
  gitCommit, gitBranch, gitCheckout, gitPull, gitPush, gitRollback,
  saveGitCredentials, archiveUrl,
  Project, novncUrl, StartSessionOptions,
} from '../services/api'
import TerminalComponent from '../components/Terminal'
import DiffViewer from '../components/DiffViewer'
import FileExplorer from '../components/FileExplorer'
import Modal, { ConfirmDialog } from '../components/Modal'
import { useToast } from '../components/Toast'

type Tab = 'terminal' | 'shell' | 'diff' | 'files' | 'git'

const TABS: Tab[] = ['terminal', 'shell', 'diff', 'files', 'git']

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const saved = localStorage.getItem(`active-tab-${window.location.pathname}`)
    return TABS.includes(saved as Tab) ? (saved as Tab) : 'terminal'
  })
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessionRunning, setSessionRunning] = useState(false)
  const [gitStatus, setGitStatus] = useState('')
  const [currentBranch, setCurrentBranch] = useState('')
  const [gitDiff, setGitDiff] = useState('')
  const [gitLog, setGitLog] = useState<string[]>([])
  const [branches, setBranches] = useState<string[]>([])
  const [checkoutTarget, setCheckoutTarget] = useState('')
  const [commitMessage, setCommitMessage] = useState('')
  const [branchName, setBranchName] = useState('')
  const [gitLoading, setGitLoading] = useState(false)
  const [gitBusy, setGitBusy] = useState(false)
  const [showRollbackConfirm, setShowRollbackConfirm] = useState(false)
  const [showTaskModal, setShowTaskModal] = useState(false)
  const [taskPrompt, setTaskPrompt] = useState('')
  const [taskContinue, setTaskContinue] = useState(false)
  const [starting, setStarting] = useState(false)
  const [commitView, setCommitView] = useState<{ hash: string; diff: string } | null>(null)
  const [showCredsModal, setShowCredsModal] = useState(false)
  const [credHost, setCredHost] = useState('github.com')
  const [credUser, setCredUser] = useState('')
  const [credToken, setCredToken] = useState('')
  const autoStarted = useRef(false)
  const toast = useToast()

  useEffect(() => {
    if (id) localStorage.setItem(`active-tab-/project/${id}`, activeTab)
  }, [activeTab, id])

  useEffect(() => {
    document.title = id ? `${id} — AI Platform` : 'AI Platform'
    return () => { document.title = 'AI Platform' }
  }, [id])

  useEffect(() => {
    if (!id) return
    setLoading(true)
    setError(null)
    Promise.all([
      getProject(id).then(setProject),
      getSessionStatus(id).then(async (s) => {
        let running = s.running
        if (s.sessionId) setSessionId(s.sessionId)
        // "Open with Claude" passes ?start=1 to start the session right away
        if (!running && searchParams.get('start') && !autoStarted.current) {
          autoStarted.current = true
          try {
            const result = await startSession(id)
            setSessionId(result.sessionId)
            running = true
          } catch {
            // surfaced via the Start Claude button if it keeps failing
          }
        }
        setSessionRunning(running)
        if (searchParams.get('start')) setSearchParams({}, { replace: true })
      }),
      getGitStatus(id).then((s) => setCurrentBranch(s.branch)).catch(() => {}),
    ])
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load project'))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const loadGitData = useCallback(async () => {
    if (!id) return
    setGitLoading(true)
    try {
      const [status, diff, log, branchInfo] = await Promise.all([
        getGitStatus(id),
        getGitDiff(id),
        getGitLog(id),
        getGitBranches(id).catch(() => ({ branches: [], current: '' })),
      ])
      setGitStatus(status.text)
      setCurrentBranch(status.branch)
      setGitDiff(diff)
      setGitLog(log)
      setBranches(branchInfo.branches)
      setCheckoutTarget(branchInfo.current)
    } catch {
      setGitStatus('Failed to load git data')
      setGitDiff('')
      setGitLog([])
    } finally {
      setGitLoading(false)
    }
  }, [id])

  useEffect(() => {
    if (activeTab === 'git' || activeTab === 'diff') {
      loadGitData()
    }
  }, [activeTab, loadGitData])

  async function handleStartSession(opts: StartSessionOptions = {}) {
    if (!id) return
    setStarting(true)
    try {
      const result = await startSession(id, opts)
      setSessionId(result.sessionId)
      setSessionRunning(true)
      setActiveTab('terminal')
    } catch (e) {
      toast('error', `Failed to start session: ${e instanceof Error ? e.message : 'Unknown error'}`)
    } finally {
      setStarting(false)
    }
  }

  async function handleStartWithTask() {
    if (!taskPrompt.trim()) {
      toast('error', 'Task text is required')
      return
    }
    setShowTaskModal(false)
    await handleStartSession({
      prompt: taskPrompt.trim(),
      ...(taskContinue ? { mode: 'continue' as const } : {}),
    })
    setTaskPrompt('')
  }

  async function handleStopSession() {
    if (!id) return
    try {
      await stopSession(id)
      setSessionRunning(false)
      setSessionId(null)
    } catch (e) {
      toast('error', `Failed to stop session: ${e instanceof Error ? e.message : 'Unknown error'}`)
    }
  }

  async function handleCommit() {
    if (!id || !commitMessage.trim()) return
    try {
      await gitCommit(id, commitMessage.trim())
      toast('success', 'Committed')
      setCommitMessage('')
      await loadGitData()
    } catch (e) {
      toast('error', `Commit failed: ${e instanceof Error ? e.message : 'Unknown error'}`)
    }
  }

  async function handleBranch() {
    if (!id || !branchName.trim()) return
    try {
      await gitBranch(id, branchName.trim())
      toast('success', `Switched to new branch ${branchName.trim()}`)
      setBranchName('')
      await loadGitData()
    } catch (e) {
      toast('error', `Branch failed: ${e instanceof Error ? e.message : 'Unknown error'}`)
    }
  }

  async function handleRollback() {
    if (!id) return
    setShowRollbackConfirm(false)
    try {
      await gitRollback(id)
      toast('success', 'Uncommitted changes discarded')
      await loadGitData()
    } catch (e) {
      toast('error', `Rollback failed: ${e instanceof Error ? e.message : 'Unknown error'}`)
    }
  }

  async function handleCheckout() {
    if (!id || !checkoutTarget || checkoutTarget === currentBranch) return
    setGitBusy(true)
    try {
      await gitCheckout(id, checkoutTarget)
      toast('success', `Switched to ${checkoutTarget}`)
      await loadGitData()
    } catch (e) {
      toast('error', `Checkout failed: ${e instanceof Error ? e.message : 'Unknown error'}`)
    } finally {
      setGitBusy(false)
    }
  }

  async function handlePull() {
    if (!id) return
    setGitBusy(true)
    try {
      const output = await gitPull(id)
      toast('success', output.split('\n').slice(-1)[0] || 'Pulled')
      await loadGitData()
    } catch (e) {
      toast('error', `Pull failed: ${e instanceof Error ? e.message : 'Unknown error'}`)
    } finally {
      setGitBusy(false)
    }
  }

  async function handlePush() {
    if (!id) return
    setGitBusy(true)
    try {
      const output = await gitPush(id)
      toast('success', output.split('\n').slice(-1)[0] || 'Pushed')
    } catch (e) {
      toast('error', `Push failed: ${e instanceof Error ? e.message : 'Unknown error'}`)
    } finally {
      setGitBusy(false)
    }
  }

  async function handleShowCommit(line: string) {
    if (!id) return
    const hash = line.split(' ')[0]
    if (!hash) return
    try {
      const diff = await getGitShow(id, hash)
      setCommitView({ hash, diff })
    } catch (e) {
      toast('error', `Failed to load commit: ${e instanceof Error ? e.message : 'Unknown error'}`)
    }
  }

  async function handleSaveCreds() {
    if (!credHost.trim() || !credUser.trim() || !credToken.trim()) {
      toast('error', 'All fields are required')
      return
    }
    try {
      await saveGitCredentials(credHost.trim(), credUser.trim(), credToken.trim())
      toast('success', `Credentials for ${credHost.trim()} saved`)
      setShowCredsModal(false)
      setCredToken('')
    } catch (e) {
      toast('error', `Failed to save: ${e instanceof Error ? e.message : 'Unknown error'}`)
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
    { key: 'terminal', label: 'Claude' },
    { key: 'shell', label: 'Shell' },
    { key: 'diff', label: 'Diff' },
    { key: 'files', label: 'Files' },
    { key: 'git', label: 'Git' },
  ]

  return (
    <div className="project-page">
      <div className="project-toolbar">
        <div className="project-toolbar-left">
          <Link to="/" className="btn btn-secondary btn-sm">← Back</Link>
          <h2>{project.name}</h2>
          {currentBranch && <span className="badge badge-git" title="Current branch">⎇ {currentBranch}</span>}
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
            <>
              <button className="btn btn-success btn-sm" onClick={() => handleStartSession()} disabled={starting}>
                {starting ? 'Starting…' : 'Start Claude'}
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => handleStartSession({ mode: 'continue' })}
                disabled={starting}
                title="claude --continue: продолжить последний диалог"
              >
                Resume
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setShowTaskModal(true)}
                disabled={starting}
              >
                With task…
              </button>
            </>
          )}
        </div>
        <div className="project-toolbar-right">
          {id && (
            <a href={archiveUrl(id)} className="btn btn-secondary btn-sm" title="Скачать проект (без node_modules и .git)">
              ⬇ .tar.gz
            </a>
          )}
          <a
            href={novncUrl()}
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

        {activeTab === 'shell' && id && (
          <div>
            <TerminalComponent sessionId={`shell-${id}`} />
          </div>
        )}

        {activeTab === 'diff' && (
          <div>
            <div className="diff-controls">
              <button className="btn btn-secondary btn-sm" onClick={loadGitData}>
                Refresh Diff
              </button>
            </div>
            <DiffViewer diff={gitDiff} />
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
              <button className="btn btn-secondary btn-sm" onClick={handlePull} disabled={gitBusy}>
                ⇣ Pull
              </button>
              <button className="btn btn-primary btn-sm" onClick={handlePush} disabled={gitBusy}>
                ⇡ Push
              </button>
              {branches.length > 0 && (
                <>
                  <select
                    className="git-branch-select"
                    value={checkoutTarget}
                    onChange={(e) => setCheckoutTarget(e.target.value)}
                  >
                    {branches.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={handleCheckout}
                    disabled={gitBusy || !checkoutTarget || checkoutTarget === currentBranch}
                  >
                    Checkout
                  </button>
                </>
              )}
              <button className="btn btn-secondary btn-sm" onClick={() => setShowCredsModal(true)}>
                🔑 Credentials
              </button>
            </div>

            <div>
              <h3 className="section-title">Status</h3>
              <div className="git-output">{gitStatus || 'No changes'}</div>
            </div>

            <div>
              <h3 className="section-title">Diff</h3>
              {gitDiff ? (
                <DiffViewer diff={gitDiff} />
              ) : (
                <div className="no-changes">No changes to show</div>
              )}
            </div>

            <div>
              <h3 className="section-title">Actions</h3>
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
                <button className="btn btn-danger btn-sm" onClick={() => setShowRollbackConfirm(true)}>
                  Rollback
                </button>
              </div>
            </div>

            <div>
              <h3 className="section-title">Log</h3>
              {gitLog.length === 0 ? (
                <div className="git-output">No commits yet</div>
              ) : (
                <div className="git-log">
                  {gitLog.map((line) => (
                    <button key={line} className="git-log-entry" onClick={() => handleShowCommit(line)} title="Show commit diff">
                      <span className="git-log-hash">{line.split(' ')[0]}</span>
                      <span>{line.slice(line.indexOf(' ') + 1)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {showRollbackConfirm && (
        <ConfirmDialog
          title="Rollback changes"
          message="Discard all uncommitted changes in tracked files? Untracked files are kept."
          confirmLabel="Discard"
          onConfirm={handleRollback}
          onCancel={() => setShowRollbackConfirm(false)}
        />
      )}

      {showTaskModal && (
        <Modal title="Start Claude with a task" onClose={() => setShowTaskModal(false)}>
          <div className="form-field">
            <label>Task for Claude</label>
            <textarea
              className="task-textarea"
              value={taskPrompt}
              autoFocus
              rows={5}
              placeholder="Опиши задачу — Claude начнёт работать сразу после запуска…"
              onChange={(e) => setTaskPrompt(e.target.value)}
            />
          </div>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={taskContinue}
              onChange={(e) => setTaskContinue(e.target.checked)}
            />
            Continue previous conversation (--continue)
          </label>
          <div className="modal-actions">
            <button className="btn btn-secondary btn-sm" onClick={() => setShowTaskModal(false)}>Cancel</button>
            <button className="btn btn-success btn-sm" onClick={handleStartWithTask}>Start</button>
          </div>
        </Modal>
      )}

      {commitView && (
        <Modal title={`Commit ${commitView.hash}`} onClose={() => setCommitView(null)} wide>
          <div className="modal-wide-body">
            <DiffViewer diff={commitView.diff} />
          </div>
        </Modal>
      )}

      {showCredsModal && (
        <Modal title="Git credentials (HTTPS)" onClose={() => setShowCredsModal(false)}>
          <p className="modal-hint">
            Токен сохраняется внутри контейнера (volume claude-auth) и используется для push/pull/clone.
          </p>
          <div className="form-field">
            <label>Host</label>
            <input type="text" value={credHost} onChange={(e) => setCredHost(e.target.value)} placeholder="github.com" />
          </div>
          <div className="form-field">
            <label>Username</label>
            <input type="text" value={credUser} onChange={(e) => setCredUser(e.target.value)} placeholder="your-login" />
          </div>
          <div className="form-field">
            <label>Token</label>
            <input type="password" value={credToken} onChange={(e) => setCredToken(e.target.value)} placeholder="ghp_…" />
          </div>
          <div className="modal-actions">
            <button className="btn btn-secondary btn-sm" onClick={() => setShowCredsModal(false)}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={handleSaveCreds}>Save</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
