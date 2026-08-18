import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import {
  getProject, getSessionStatus, startSession, stopSession, markProjectOpened,
  getGitStatus, getGitDiff, getGitLog, getGitShow, getGitBranches,
  gitCommit, gitBranch, gitCheckout, gitPull, gitPush, gitRollback,
  saveGitCredentials, archiveUrl, streamReview, streamDayLog, generateCommitMessage,
  fetchChecklistFile, saveChecklistFile, TASKS_FILE, FIXES_FILE,
  fetchAgents, isAgentId, AgentId, AgentInfo, pasteIntoSession,
  Project, novncUrl, StartSessionOptions,
} from '../services/api'
import { parseTasks, serialize, withTasksAdded } from '../services/checklist'
import TerminalComponent from '../components/Terminal'
import DiffViewer from '../components/DiffViewer'
import FileExplorer from '../components/FileExplorer'
import ChecklistPanel, { TASKS_COPY, FIXES_COPY } from '../components/ChecklistPanel'
import AutoGrowTextarea from '../components/AutoGrowTextarea'
import ScreenshotPanel from '../components/ScreenshotPanel'
import ChatPanel from '../components/ChatPanel'
import MicButton, { appendTo } from '../components/MicButton'
import Modal, { ConfirmDialog } from '../components/Modal'
import { useToast } from '../components/Toast'

/** Вкладка — это либо агент со своей сессией, либо один из остальных разделов. */
type Tab = AgentId | 'shell' | 'tasks' | 'fixes' | 'diff' | 'files' | 'git'

const STATIC_TABS: Tab[] = ['shell', 'diff', 'files', 'git', 'tasks', 'fixes']

function isTab(value: unknown): value is Tab {
  return isAgentId(value) || STATIC_TABS.includes(value as Tab)
}

/**
 * Findings come back as "- [BUG] file:line — ...", but the model sometimes drops
 * the brackets and writes "- BUG: ...", so both spellings match.
 */
const FINDING_RE = /^\s*[-*]?\s*(?:\[(BUG|RISK|NIT)\]|(BUG|RISK|NIT)\s*[:—-])/i

function findingSeverity(line: string): string | undefined {
  const match = line.match(FINDING_RE)
  return (match?.[1] ?? match?.[2])?.toUpperCase()
}

function reviewLineClass(line: string): string {
  const severity = findingSeverity(line)
  return severity ? `review-line review-${severity.toLowerCase()}` : 'review-line'
}

/** A finding becomes a task verbatim, minus the markdown bullet. */
function parseFindings(review: string): string[] {
  return review
    .split('\n')
    .filter((line) => findingSeverity(line))
    .map((line) => line.trim().replace(/^[-*]\s*/, ''))
}

/** Готовая задача для кнопки «Улучшить последнее» в модалке «With task…». */
const POLISH_LAST_PROMPT =
  'Посмотри последние 10 коммитов, нужно провести ревью и сделать всё человекочитаемым, ' +
  'лаконичным, по принципам DRY, KISS, YAGNI.'

const DEFAULT_AGENT: AgentId = 'claude'

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const saved = localStorage.getItem(`active-tab-${window.location.pathname}`)
    return isTab(saved) ? saved : DEFAULT_AGENT
  })
  const [agents, setAgents] = useState<AgentInfo[]>([])
  /** Какие агенты этого проекта сейчас запущены — по сессии на каждого. */
  const [running, setRunning] = useState<Partial<Record<AgentId, boolean>>>({})
  /** Последняя открытая вкладка агента: к ней относятся скриншоты и «обсудить» из чеклистов. */
  const [lastAgent, setLastAgent] = useState<AgentId>(DEFAULT_AGENT)
  const [generatingMessage, setGeneratingMessage] = useState(false)
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
  /** Агент, для которого открыта модалка «With task…»; null — она закрыта. */
  const [taskModalAgent, setTaskModalAgent] = useState<AgentId | null>(null)
  const [taskPrompt, setTaskPrompt] = useState('')
  const [taskContinue, setTaskContinue] = useState(false)
  /** Агент, который сейчас стартует — кнопки блокируются только у него. */
  const [startingAgent, setStartingAgent] = useState<AgentId | null>(null)
  const [commitView, setCommitView] = useState<{ hash: string; diff: string } | null>(null)
  const [showCredsModal, setShowCredsModal] = useState(false)
  const [pendingRestart, setPendingRestart] = useState<{ agent: AgentId; prompt?: string } | null>(null)
  const [review, setReview] = useState('')
  const [reviewError, setReviewError] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [savingFindings, setSavingFindings] = useState(false)
  const reviewAbortRef = useRef<AbortController | null>(null)
  const [dayLog, setDayLog] = useState('')
  const [dayLogError, setDayLogError] = useState('')
  const [dayLogLoading, setDayLogLoading] = useState(false)
  const [credHost, setCredHost] = useState('github.com')
  const [credUser, setCredUser] = useState('')
  const [credToken, setCredToken] = useState('')
  const toast = useToast()

  /** Вкладка агента или один из остальных разделов. */
  const agentTab = isAgentId(activeTab) ? activeTab : null
  const specOf = (a: AgentId) => agents.find((x) => x.id === a)
  const labelOf = (a: AgentId) => specOf(a)?.label ?? a
  const isRunning = (a: AgentId) => running[a] === true
  const anyRunning = agents.some((a) => isRunning(a.id))
  // Пока список агентов не приехал, считаем, что задачу передать можно: сервер
  // всё равно откажет, а блокировать кнопку на каждой загрузке — хуже.
  const supportsPrompt = (a: AgentId) => specOf(a)?.supportsPrompt ?? true
  // У Gemini нет resume — он всегда начинает разговор заново.
  const supportsContinue = (a: AgentId) => specOf(a)?.supportsContinue ?? true

  useEffect(() => {
    if (id) localStorage.setItem(`active-tab-/project/${id}`, activeTab)
  }, [activeTab, id])

  // Скриншоты и «обсудить» из чеклистов адресуются агенту, у которого человек был.
  useEffect(() => {
    if (agentTab) setLastAgent(agentTab)
  }, [agentTab])

  // An agent missing from the container is not offered; an empty list means the
  // container is down, and the toolbar falls back to the Claude-only layout.
  useEffect(() => {
    fetchAgents().then(setAgents).catch(() => setAgents([]))
  }, [])

  const refreshSessions = useCallback(async () => {
    if (!id) return
    try {
      const status = await getSessionStatus(id)
      setRunning(Object.fromEntries(status.sessions.map((x) => [x.agent, x.running])))
    } catch {
      // Контейнер недоступен — пусть на вкладках останется последнее известное
    }
  }, [id])

  // Агент мог завершиться сам, пока вкладка была в фоне.
  useEffect(() => {
    window.addEventListener('focus', refreshSessions)
    return () => window.removeEventListener('focus', refreshSessions)
  }, [refreshSessions])

  // The dashboard orders projects by this, so record the visit, not the click.
  useEffect(() => {
    if (id) markProjectOpened(id).catch(() => {})
  }, [id])

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
      getSessionStatus(id).then((status) => {
        setRunning(Object.fromEntries(status.sessions.map((x) => [x.agent, x.running])))
        setLastAgent(status.lastAgent)

        // «Open» с дашборда передаёт ?open=1: открываем первую вкладку и ничего не запускаем.
        if (searchParams.get('open')) {
          setActiveTab(DEFAULT_AGENT)
          setSearchParams({}, { replace: true })
        }
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

  async function handleStartSession(agent: AgentId, opts: StartSessionOptions = {}) {
    if (!id) return
    setStartingAgent(agent)
    try {
      await startSession(id, { agent, ...opts })
      setRunning((prev) => ({ ...prev, [agent]: true }))
      setActiveTab(agent)
    } catch (e) {
      toast('error', `Не удалось запустить ${labelOf(agent)}: ${e instanceof Error ? e.message : 'Unknown error'}`)
    } finally {
      setStartingAgent(null)
    }
  }

  async function handleStartWithTask() {
    const agent = taskModalAgent
    if (!agent) return
    if (!taskPrompt.trim()) {
      toast('error', 'Task text is required')
      return
    }
    setTaskModalAgent(null)
    await handleStartSession(agent, {
      prompt: taskPrompt.trim(),
      ...(taskContinue ? { mode: 'continue' as const } : {}),
    })
    setTaskPrompt('')
  }

  /**
   * Context lives in the tmux session, so a clean slate means killing it and
   * launching the agent again without --continue.
   */
  async function restartSession(agent: AgentId, prompt?: string) {
    if (!id) return
    setStartingAgent(agent)
    try {
      if (isRunning(agent)) await stopSession(id, agent).catch(() => {})
      // Сокет отпускаем раньше, чем умрёт старый pty, иначе терминал переподключится
      // к трупу прежней сессии вместо новой.
      setRunning((prev) => ({ ...prev, [agent]: false }))
      await startSession(id, { agent, ...(prompt ? { prompt } : {}) })
      setRunning((prev) => ({ ...prev, [agent]: true }))
      setActiveTab(agent)
    } catch (e) {
      toast('error', `Не удалось перезапустить ${labelOf(agent)}: ${e instanceof Error ? e.message : 'Unknown error'}`)
    } finally {
      setStartingAgent(null)
    }
  }

  function requestRestart(agent: AgentId, prompt?: string) {
    // Refused up front: restarting kills the running session first, and an agent
    // that takes no task on the command line would leave the project with none.
    if (prompt && !supportsPrompt(agent)) {
      toast('error', `${labelOf(agent)} нельзя запустить сразу с задачей`)
      return
    }
    if (isRunning(agent)) setPendingRestart({ agent, prompt })
    else restartSession(agent, prompt)
  }

  async function handleStopSession(agent: AgentId) {
    if (!id) return
    try {
      await stopSession(id, agent)
      setRunning((prev) => ({ ...prev, [agent]: false }))
    } catch (e) {
      toast('error', `Не удалось остановить ${labelOf(agent)}: ${e instanceof Error ? e.message : 'Unknown error'}`)
    }
  }

  /** Dictation goes where the user's typing would: into the agent's prompt, unsubmitted. */
  async function handleDictateToSession(agent: AgentId, text: string) {
    if (!id) return
    try {
      await pasteIntoSession(id, `${text} `, agent)
    } catch (e) {
      toast('error', `Не удалось вставить в сессию: ${e instanceof Error ? e.message : 'Unknown error'}`)
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

  /** Fills the input rather than committing: the message is a draft to edit. */
  async function handleGenerateCommitMessage() {
    if (!id || generatingMessage) return
    setGeneratingMessage(true)
    try {
      setCommitMessage(await generateCommitMessage(id))
    } catch (e) {
      toast('error', `Не получилось составить сообщение: ${e instanceof Error ? e.message : 'Unknown error'}`)
    } finally {
      setGeneratingMessage(false)
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

  async function handleReview() {
    if (!id || reviewing) return

    setReview('')
    setReviewError('')
    setReviewing(true)

    const controller = new AbortController()
    reviewAbortRef.current = controller

    try {
      await streamReview(id, (chunk) => setReview((prev) => prev + chunk), controller.signal)
    } catch (e) {
      if (controller.signal.aborted) return
      setReviewError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      if (!controller.signal.aborted) {
        setReviewing(false)
        reviewAbortRef.current = null
      }
    }
  }

  function stopReview() {
    reviewAbortRef.current?.abort()
    reviewAbortRef.current = null
    setReviewing(false)
  }

  async function handleDayLog() {
    if (!id || dayLogLoading) return
    setDayLog('')
    setDayLogError('')
    setDayLogLoading(true)
    try {
      await streamDayLog(id, (chunk) => setDayLog((prev) => prev + chunk))
    } catch (e) {
      setDayLogError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setDayLogLoading(false)
    }
  }

  /**
   * Re-reviewing the same diff yields the same findings, so anything already in
   * FIXES.md — done or not — is skipped instead of piling up duplicates.
   */
  async function handleFindingsToFixes() {
    if (!id || savingFindings) return

    const findings = parseFindings(review)
    if (findings.length === 0) return

    setSavingFindings(true)
    try {
      const content = await fetchChecklistFile(id, FIXES_FILE)
      const lines = content === null ? [] : content.split('\n')

      const existing = new Set(parseTasks(lines).map((t) => t.text.toLowerCase()))
      const fresh = findings.filter((text) => !existing.has(text.toLowerCase()))

      if (fresh.length === 0) {
        toast('info', 'Все замечания уже в доработках')
        return
      }

      await saveChecklistFile(id, FIXES_FILE, serialize(withTasksAdded(lines, fresh, FIXES_COPY.heading)))
      const skipped = findings.length - fresh.length
      toast('success', `В доработки: ${fresh.length}${skipped > 0 ? ` (${skipped} уже были)` : ''}`)
    } catch (e) {
      toast('error', `Не сохранилось: ${e instanceof Error ? e.message : 'Unknown error'}`)
    } finally {
      setSavingFindings(false)
    }
  }

  useEffect(() => () => reviewAbortRef.current?.abort(), [])

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

  const findings = parseFindings(review)

  // Агент, которого нет в контейнере, вкладки не получает; пустой список — контейнер
  // лежит, и тогда остаётся одна вкладка Claude, как было раньше.
  const agentTabs: { key: Tab; label: string; running: boolean }[] = (
    agents.length ? agents : [{ id: DEFAULT_AGENT, label: 'Claude Code' } as AgentInfo]
  ).map((a) => ({ key: a.id, label: a.label, running: isRunning(a.id) }))

  const tabs: { key: Tab; label: string; running?: boolean }[] = [
    ...agentTabs,
    { key: 'shell', label: 'Shell' },
    { key: 'diff', label: 'Diff' },
    { key: 'files', label: 'Files' },
    { key: 'git', label: 'Git' },
    { key: 'tasks', label: 'Tasks' },
    { key: 'fixes', label: 'Fixes' },
  ]

  // Тот же тулбар показывается и внутри полноэкранного терминала — оверлей перекрывает страницу,
  // а Start/Stop/Resume и остальное должны оставаться под рукой.
  const projectToolbar = (
    <div className="project-toolbar">
      <div className="project-toolbar-left">
        <Link to="/" className="btn btn-secondary btn-sm">← Back</Link>
        <h2>{project.name}</h2>
        {currentBranch && <span className="badge badge-git" title="Current branch">⎇ {currentBranch}</span>}
        {/* Запуском и остановкой заведует вкладка самого агента — здесь только сводка. */}
        <span className={anyRunning ? 'badge badge-running' : 'badge badge-offline'}>
          <span className={`status-indicator ${anyRunning ? 'running' : 'offline'}`} />
          {anyRunning
            ? agents.filter((a) => isRunning(a.id)).map((a) => a.label).join(', ')
            : 'Offline'}
        </span>
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
  )

  return (
    <div className="project-page">
      {projectToolbar}

      <div className="tabs">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={`tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.running && <span className="status-indicator running" title="Сессия запущена" />}
            {tab.label}
          </button>
        ))}
      </div>

      <div className="tab-content">
        {/* Terminal/Shell stay mounted across tab switches — unmounting would throw away xterm's
            scrollback and reconnect to a fresh pty attach, which only redraws the current tmux
            screen, not its history. CSS hides them instead; `visible` tells xterm to refit. */}
        {agentTabs.map(({ key, label }) => {
          const agent = key as AgentId
          const live = isRunning(agent)
          const busy = startingAgent === agent
          return (
            <div key={agent} style={{ display: activeTab === agent ? undefined : 'none' }}>
              <TerminalComponent
                sessionId={live && id ? `${agent}-${id}` : null}
                projectId={id}
                label={label}
                visible={activeTab === agent}
                fullscreenExtra={projectToolbar}
                searchExtra={
                  <div className="terminal-session-controls">
                    {live ? (
                      <>
                        {/* Надиктованное уходит в промпт агента, поэтому кнопка живёт у его терминала. */}
                        <MicButton
                          onText={(text) => handleDictateToSession(agent, text)}
                          title={`Надиктовать в ${label}`}
                        />
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => requestRestart(agent)}
                          disabled={busy}
                          title={`Перезапустить ${label} с чистым контекстом — закрывает диалог и открывает заново`}
                        >
                          ✦ Новая задача
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleStopSession(agent)}>
                          Stop
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="btn btn-success btn-sm"
                          onClick={() => handleStartSession(agent)}
                          disabled={busy}
                        >
                          {busy ? 'Starting…' : `Start ${label}`}
                        </button>
                        {supportsPrompt(agent) && (
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => setTaskModalAgent(agent)}
                            disabled={busy}
                          >
                            With task…
                          </button>
                        )}
                      </>
                    )}
                  </div>
                }
              />
            </div>
          )
        })}

        {id && (
          <div style={{ display: activeTab === 'shell' ? undefined : 'none' }}>
            <TerminalComponent sessionId={`shell-${id}`} projectId={id} label="Shell" visible={activeTab === 'shell'} />
          </div>
        )}

        {activeTab === 'tasks' && id && (
          <ChecklistPanel
            projectId={id}
            file={TASKS_FILE}
            copy={TASKS_COPY}
            onDiscuss={(text) =>
              requestRestart(lastAgent, `Давай обсудим задачу, пока ничего не меняя в коде: ${text}`)
            }
          />
        )}

        {activeTab === 'fixes' && id && (
          <ChecklistPanel
            projectId={id}
            file={FIXES_FILE}
            copy={FIXES_COPY}
            onDiscuss={(text) =>
              requestRestart(lastAgent, `Давай обсудим замечание код-ревью, пока ничего не меняя в коде: ${text}`)
            }
          />
        )}

        {activeTab === 'diff' && (
          <div>
            <div className="diff-controls">
              <button className="btn btn-secondary btn-sm" onClick={loadGitData}>
                Refresh Diff
              </button>
            </div>
            <DiffViewer diff={gitDiff} projectId={id} />
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
              <h3 className="section-title">Коммит</h3>
              <div className="git-controls">
                <AutoGrowTextarea
                  placeholder="Commit message..."
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleCommit()
                    }
                  }}
                  disabled={generatingMessage}
                />
                <MicButton
                  onText={appendTo(setCommitMessage)}
                  disabled={generatingMessage}
                />
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={handleGenerateCommitMessage}
                  disabled={generatingMessage || !gitDiff}
                  title={gitDiff ? 'Claude напишет сообщение по диффу' : 'Нет изменений'}
                >
                  {generatingMessage ? 'Пишет…' : '✦ Создать сообщение'}
                </button>
                <button className="btn btn-primary btn-sm" onClick={handleCommit} disabled={generatingMessage}>
                  Commit
                </button>
              </div>
            </div>

            <div>
              <h3 className="section-title">Трудозатраты за день</h3>
              <div className="git-controls">
                <AutoGrowTextarea
                  placeholder="Отчёт о трудозатратах за день…"
                  value={dayLog}
                  onChange={(e) => setDayLog(e.target.value)}
                  disabled={dayLogLoading}
                />
                <button className="btn btn-secondary btn-sm" onClick={handleDayLog} disabled={dayLogLoading}>
                  {dayLogLoading ? 'Собираю…' : '✦ Сформировать'}
                </button>
              </div>
              {dayLogError && <div className="git-output review-error">{dayLogError}</div>}
            </div>

            <div>
              <div className="review-header">
                <h3 className="section-title">Review</h3>
                {!reviewing && findings.length > 0 && (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleFindingsToFixes}
                    disabled={savingFindings}
                    title={`Записать в ${FIXES_FILE}`}
                  >
                    ➜ В доработки ({findings.length})
                  </button>
                )}
                {reviewing ? (
                  <button className="btn btn-danger btn-sm" onClick={stopReview}>
                    Stop
                  </button>
                ) : (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={handleReview}
                    disabled={!gitDiff}
                    title={gitDiff ? 'Claude проверит дифф' : 'Нет изменений'}
                  >
                    🔍 Проверить дифф
                  </button>
                )}
              </div>

              {reviewError ? (
                <div className="git-output review-error">{reviewError}</div>
              ) : review ? (
                <div className="review-output">
                  {review.split('\n').map((line, i) => (
                    <div key={i} className={reviewLineClass(line)}>
                      {line || ' '}
                    </div>
                  ))}
                  {reviewing && <span className="chat-caret" />}
                </div>
              ) : reviewing ? (
                <div className="git-output review-waiting">Claude читает дифф и файлы проекта…</div>
              ) : (
                <div className="no-changes">
                  Claude просмотрит незакоммиченные изменения и назовёт проблемы
                </div>
              )}
            </div>

            <div>
              <h3 className="section-title">Diff</h3>
              {gitDiff ? (
                <DiffViewer diff={gitDiff} projectId={id} />
              ) : (
                <div className="no-changes">No changes to show</div>
              )}
            </div>

            <div>
              <h3 className="section-title">Ветки</h3>
              <div className="git-controls">
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

            <div>
              <h3 className="section-title">Status</h3>
              <div className="git-output">{gitStatus || 'No changes'}</div>
            </div>
          </div>
        )}
      </div>

      {id && <ScreenshotPanel projectId={id} agent={lastAgent} sessionRunning={isRunning(lastAgent)} />}
      {id && <ChatPanel projectId={id} />}

      {pendingRestart && (
        <ConfirmDialog
          title="Сбросить контекст?"
          message={
            pendingRestart.prompt
              ? `Текущая сессия ${labelOf(pendingRestart.agent)} будет закрыта, и он начнёт заново с этой задачей.`
              : `Текущая сессия ${labelOf(pendingRestart.agent)} будет закрыта, и он откроется с чистым контекстом.`
          }
          confirmLabel="Перезапустить"
          onConfirm={() => {
            const { agent, prompt } = pendingRestart
            setPendingRestart(null)
            restartSession(agent, prompt)
          }}
          onCancel={() => setPendingRestart(null)}
        />
      )}

      {showRollbackConfirm && (
        <ConfirmDialog
          title="Rollback changes"
          message="Discard all uncommitted changes in tracked files? Untracked files are kept."
          confirmLabel="Discard"
          onConfirm={handleRollback}
          onCancel={() => setShowRollbackConfirm(false)}
        />
      )}

      {taskModalAgent && (
        <Modal
          title={`Start ${labelOf(taskModalAgent)} with a task`}
          onClose={() => setTaskModalAgent(null)}
        >
          <div className="form-field">
            <label>Task for {labelOf(taskModalAgent)}</label>
            <textarea
              className="task-textarea"
              value={taskPrompt}
              autoFocus
              rows={5}
              placeholder="Опиши задачу — агент начнёт работать сразу после запуска…"
              onChange={(e) => setTaskPrompt(e.target.value)}
            />
            <MicButton onText={appendTo(setTaskPrompt)} />
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setTaskPrompt(POLISH_LAST_PROMPT)}
              title="Подставить готовую задачу на ревью последних коммитов"
            >
              Улучшить последнее
            </button>
          </div>
          {supportsContinue(taskModalAgent) && (
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={taskContinue}
                onChange={(e) => setTaskContinue(e.target.checked)}
              />
              Continue previous conversation (--continue)
            </label>
          )}
          <div className="modal-actions">
            <button className="btn btn-secondary btn-sm" onClick={() => setTaskModalAgent(null)}>Cancel</button>
            <button className="btn btn-success btn-sm" onClick={handleStartWithTask}>Start</button>
          </div>
        </Modal>
      )}

      {commitView && (
        <Modal title={`Commit ${commitView.hash}`} onClose={() => setCommitView(null)} wide>
          <div className="modal-wide-body">
            <DiffViewer diff={commitView.diff} projectId={id} />
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
