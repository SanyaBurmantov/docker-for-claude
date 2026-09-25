import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import {
  getProject, getSessionStatus, startSession, stopSession, markProjectOpened,
  getGitStatus, getGitDiff, getGitLog, getGitShow, getGitBranches,
  gitCommit, gitBranch, gitCheckout, gitPull, gitPush, gitRollback,
  saveGitCredentials, archiveUrl, streamReview, streamDayLog, generateCommitMessage,
  fetchChecklistFile, saveChecklistFile, TASKS_FILE, FIXES_FILE,
  fetchAgents, isAgentId, AgentId, AgentInfo, pasteIntoSession,
  Project, novncUrl, StartSessionOptions, AiProvider,
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
import AiProviderPicker, { AI_PROVIDER_PRESENTATION } from '../components/AiProviderPicker'
import { useLanguage } from '../i18n'

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

const DEFAULT_AGENT: AgentId = 'claude'
const FALLBACK_AGENT: AgentInfo = {
  id: DEFAULT_AGENT,
  label: 'Claude Code',
  version: '',
  supportsPrompt: true,
  supportsContinue: true,
}

function isAiProvider(value: unknown): value is AiProvider {
  return isAgentId(value)
}

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
  const [aiProvider, setAiProvider] = useState<AiProvider>(() => {
    if (isAiProvider(activeTab)) return activeTab
    const saved = localStorage.getItem('project-ai-provider') ?? localStorage.getItem('git-ai-provider')
    return isAiProvider(saved) ? saved : 'claude'
  })
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
  const { t } = useLanguage()

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
  const providerLabel = AI_PROVIDER_PRESENTATION[aiProvider].label

  useEffect(() => {
    if (id) localStorage.setItem(`active-tab-/project/${id}`, activeTab)
  }, [activeTab, id])

  useEffect(() => {
    localStorage.setItem('project-ai-provider', aiProvider)
  }, [aiProvider])

  // Скриншоты и «обсудить» из чеклистов адресуются агенту, у которого человек был.
  useEffect(() => {
    if (agentTab) setLastAgent(agentTab)
  }, [agentTab])

  // An agent missing from the container is not offered; an empty list means the
  // container is down, and the toolbar falls back to the Claude-only layout.
  useEffect(() => {
    fetchAgents()
      .then((next) => {
        setAgents(next)
        const available = next.length ? next : [FALLBACK_AGENT]
        const fallback = available[0].id
        const hasAgent = (agent: AgentId) => available.some((item) => item.id === agent)
        setAiProvider((current) => hasAgent(current) ? current : fallback)
        setActiveTab((current) => isAgentId(current) && !hasAgent(current) ? fallback : current)
      })
      .catch(() => {
        setAgents([])
        setAiProvider(DEFAULT_AGENT)
        setActiveTab((current) => isAgentId(current) ? DEFAULT_AGENT : current)
      })
  }, [])

  function selectAiProvider(provider: AiProvider) {
    setAiProvider(provider)
    setActiveTab(provider)
  }

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
          selectAiProvider(DEFAULT_AGENT)
          setSearchParams({}, { replace: true })
        }
      }),
      getGitStatus(id).then((s) => setCurrentBranch(s.branch)).catch(() => {}),
    ])
      .catch((e) => setError(e instanceof Error ? e.message : t('project.loadFailed')))
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
      setGitStatus(t('project.gitLoadFailed'))
      setGitDiff('')
      setGitLog([])
    } finally {
      setGitLoading(false)
    }
  }, [id, t])

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
      selectAiProvider(agent)
    } catch (e) {
      toast('error', t('project.startFailed', {
        agent: labelOf(agent),
        error: e instanceof Error ? e.message : t('common.unknownError'),
      }))
    } finally {
      setStartingAgent(null)
    }
  }

  async function handleStartWithTask() {
    const agent = taskModalAgent
    if (!agent) return
    if (!taskPrompt.trim()) {
      toast('error', t('project.taskRequired'))
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
      selectAiProvider(agent)
    } catch (e) {
      toast('error', t('project.restartFailed', {
        agent: labelOf(agent),
        error: e instanceof Error ? e.message : t('common.unknownError'),
      }))
    } finally {
      setStartingAgent(null)
    }
  }

  function requestRestart(agent: AgentId, prompt?: string) {
    // Refused up front: restarting kills the running session first, and an agent
    // that takes no task on the command line would leave the project with none.
    if (prompt && !supportsPrompt(agent)) {
      toast('error', t('project.promptUnsupported', { agent: labelOf(agent) }))
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
      toast('error', t('project.stopFailed', {
        agent: labelOf(agent),
        error: e instanceof Error ? e.message : t('common.unknownError'),
      }))
    }
  }

  /** Dictation goes where the user's typing would: into the agent's prompt, unsubmitted. */
  async function handleDictateToSession(agent: AgentId, text: string) {
    if (!id) return
    try {
      await pasteIntoSession(id, `${text} `, agent)
    } catch (e) {
      toast('error', t('project.pasteFailed', { error: e instanceof Error ? e.message : t('common.unknownError') }))
    }
  }

  async function handleCommit() {
    if (!id || !commitMessage.trim()) return
    try {
      await gitCommit(id, commitMessage.trim())
      toast('success', t('project.committed'))
      setCommitMessage('')
      await loadGitData()
    } catch (e) {
      toast('error', t('project.commitFailed', { error: e instanceof Error ? e.message : t('common.unknownError') }))
    }
  }

  /** Fills the input rather than committing: the message is a draft to edit. */
  async function handleGenerateCommitMessage() {
    if (!id || generatingMessage) return
    setGeneratingMessage(true)
    try {
      setCommitMessage(await generateCommitMessage(id, aiProvider))
    } catch (e) {
      toast('error', t('project.messageFailed', { error: e instanceof Error ? e.message : t('common.unknownError') }))
    } finally {
      setGeneratingMessage(false)
    }
  }

  async function handleBranch() {
    if (!id || !branchName.trim()) return
    try {
      await gitBranch(id, branchName.trim())
      toast('success', t('project.branchCreated', { branch: branchName.trim() }))
      setBranchName('')
      await loadGitData()
    } catch (e) {
      toast('error', t('project.branchFailed', { error: e instanceof Error ? e.message : t('common.unknownError') }))
    }
  }

  async function handleRollback() {
    if (!id) return
    setShowRollbackConfirm(false)
    try {
      await gitRollback(id)
      toast('success', t('project.rolledBack'))
      await loadGitData()
    } catch (e) {
      toast('error', t('project.rollbackFailed', { error: e instanceof Error ? e.message : t('common.unknownError') }))
    }
  }

  async function handleCheckout() {
    if (!id || !checkoutTarget || checkoutTarget === currentBranch) return
    setGitBusy(true)
    try {
      await gitCheckout(id, checkoutTarget)
      toast('success', t('project.switched', { branch: checkoutTarget }))
      await loadGitData()
    } catch (e) {
      toast('error', t('project.checkoutFailed', { error: e instanceof Error ? e.message : t('common.unknownError') }))
    } finally {
      setGitBusy(false)
    }
  }

  async function handlePull() {
    if (!id) return
    setGitBusy(true)
    try {
      const output = await gitPull(id)
      toast('success', output.split('\n').slice(-1)[0] || t('project.pulled'))
      await loadGitData()
    } catch (e) {
      toast('error', t('project.pullFailed', { error: e instanceof Error ? e.message : t('common.unknownError') }))
    } finally {
      setGitBusy(false)
    }
  }

  async function handlePush() {
    if (!id) return
    setGitBusy(true)
    try {
      const output = await gitPush(id)
      toast('success', output.split('\n').slice(-1)[0] || t('project.pushed'))
    } catch (e) {
      toast('error', t('project.pushFailed', { error: e instanceof Error ? e.message : t('common.unknownError') }))
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
      await streamReview(id, aiProvider, (chunk) => setReview((prev) => prev + chunk), controller.signal)
    } catch (e) {
      if (controller.signal.aborted) return
      setReviewError(e instanceof Error ? e.message : t('common.unknownError'))
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
      await streamDayLog(id, aiProvider, (chunk) => setDayLog((prev) => prev + chunk))
    } catch (e) {
      setDayLogError(e instanceof Error ? e.message : t('common.unknownError'))
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
        toast('info', t('project.findingsExist'))
        return
      }

      await saveChecklistFile(id, FIXES_FILE, serialize(withTasksAdded(lines, fresh, FIXES_COPY.heading)))
      const skipped = findings.length - fresh.length
      toast('success', t('project.findingsAdded', {
        count: fresh.length,
        skipped: skipped > 0 ? t('project.findingsSkipped', { count: skipped }) : '',
      }))
    } catch (e) {
      toast('error', t('project.saveFailed', { error: e instanceof Error ? e.message : t('common.unknownError') }))
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
      toast('error', t('project.commitLoadFailed', { error: e instanceof Error ? e.message : t('common.unknownError') }))
    }
  }

  async function handleSaveCreds() {
    if (!credHost.trim() || !credUser.trim() || !credToken.trim()) {
      toast('error', t('project.fieldsRequired'))
      return
    }
    try {
      await saveGitCredentials(credHost.trim(), credUser.trim(), credToken.trim())
      toast('success', t('project.credentialsSaved', { host: credHost.trim() }))
      setShowCredsModal(false)
      setCredToken('')
    } catch (e) {
      toast('error', t('project.credentialsSaveFailed', { error: e instanceof Error ? e.message : t('common.unknownError') }))
    }
  }

  if (loading) {
    return <div className="loading">{t('project.loading')}</div>
  }

  if (error || !project) {
    return (
      <div>
        <div className="error">{error || t('project.notFound')}</div>
        <Link to="/" className="btn btn-secondary" style={{ marginTop: 16, display: 'inline-block' }}>
          {t('project.backToProjects')}
        </Link>
      </div>
    )
  }

  const findings = parseFindings(review)

  // Агент, которого нет в контейнере, вкладки не получает; пустой список — контейнер
  // лежит, и тогда остаётся одна вкладка Claude, как было раньше.
  const availableAgents = agents.length ? agents : [FALLBACK_AGENT]
  const agentTabs: { key: Tab; label: string; running: boolean }[] = (
    availableAgents
  ).map((a) => ({ key: a.id, label: a.label, running: isRunning(a.id) }))
  const selectedAgentTab = agentTabs.find((tab) => tab.key === aiProvider) ?? agentTabs[0]

  const tabs: { key: Tab; label: string; running?: boolean }[] = [
    selectedAgentTab,
    { key: 'shell', label: t('project.tabs.shell') },
    { key: 'diff', label: t('project.tabs.diff') },
    { key: 'files', label: t('project.tabs.files') },
    { key: 'git', label: 'Git' },
    { key: 'tasks', label: t('project.tabs.tasks') },
    { key: 'fixes', label: t('project.tabs.fixes') },
  ]

  // Тот же тулбар показывается и внутри полноэкранного терминала — оверлей перекрывает страницу,
  // а Start/Stop/Resume и остальное должны оставаться под рукой.
  const projectToolbar = (
    <div className="project-toolbar">
      <div className="project-toolbar-left">
        <Link to="/" className="btn btn-secondary btn-sm">← {t('common.back')}</Link>
        <h2>{project.name}</h2>
        {currentBranch && <span className="badge badge-git" title={t('project.currentBranch')}>⎇ {currentBranch}</span>}
        {/* Запуском и остановкой заведует вкладка самого агента — здесь только сводка. */}
        <span className={anyRunning ? 'badge badge-running' : 'badge badge-offline'}>
          <span className={`status-indicator ${anyRunning ? 'running' : 'offline'}`} />
          {anyRunning
            ? agents.filter((a) => isRunning(a.id)).map((a) => a.label).join(', ')
            : t('common.offline')}
        </span>
        <AiProviderPicker
          value={aiProvider}
          agents={availableAgents}
          running={running}
          onChange={selectAiProvider}
          disabled={generatingMessage || reviewing || dayLogLoading}
        />
      </div>
      <div className="project-toolbar-right">
        {id && (
          <a href={archiveUrl(id)} className="btn btn-secondary btn-sm" title={t('project.download')}>
            ⬇ .tar.gz
          </a>
        )}
        <a
          href={novncUrl()}
          className="btn btn-secondary btn-sm"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('project.openNovnc')}
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
            onClick={() => isAgentId(tab.key) ? selectAiProvider(tab.key) : setActiveTab(tab.key)}
          >
            {tab.running && <span className="status-indicator running" title={t('aiPicker.running')} />}
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
                          title={t('project.dictateTo', { agent: label })}
                        />
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => requestRestart(agent)}
                          disabled={busy}
                          title={t('project.restartCleanTitle', { agent: label })}
                        >
                          {t('project.newTask')}
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleStopSession(agent)}>
                          {t('common.stop')}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="btn btn-success btn-sm"
                          onClick={() => handleStartSession(agent)}
                          disabled={busy}
                        >
                          {busy ? t('project.starting') : t('project.startAgent', { agent: label })}
                        </button>
                        {supportsPrompt(agent) && (
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => setTaskModalAgent(agent)}
                            disabled={busy}
                          >
                            {t('project.withTask')}
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
              requestRestart(lastAgent, t('project.discussTaskPrompt', { text }))
            }
          />
        )}

        {activeTab === 'fixes' && id && (
          <ChecklistPanel
            projectId={id}
            file={FIXES_FILE}
            copy={FIXES_COPY}
            onDiscuss={(text) =>
              requestRestart(lastAgent, t('project.discussFixPrompt', { text }))
            }
          />
        )}

        {activeTab === 'diff' && (
          <div>
            <div className="diff-controls">
              <button className="btn btn-secondary btn-sm" onClick={loadGitData}>
                {t('project.refreshDiff')}
              </button>
            </div>
            <DiffViewer diff={gitDiff} projectId={id} provider={aiProvider} />
          </div>
        )}

        {activeTab === 'files' && id && (
          <FileExplorer projectId={id} />
        )}

        {activeTab === 'git' && (
          <div className="git-section">
            <div className="git-controls">
              <button className="btn btn-secondary btn-sm" onClick={loadGitData} disabled={gitLoading}>
                {t('common.refresh')}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={handlePull} disabled={gitBusy}>
                {t('project.pull')}
              </button>
              <button className="btn btn-primary btn-sm" onClick={handlePush} disabled={gitBusy}>
                {t('project.push')}
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
                    {t('project.checkout')}
                  </button>
                </>
              )}
              <button className="btn btn-secondary btn-sm" onClick={() => setShowCredsModal(true)}>
                {t('project.credentials')}
              </button>
            </div>

            <div>
              <h3 className="section-title">{t('project.commit')}</h3>
              <div className="git-controls">
                <AutoGrowTextarea
                  placeholder={t('project.commitPlaceholder')}
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
                  title={gitDiff ? t('project.generateMessageTitle', { provider: providerLabel }) : t('common.noChanges')}
                >
                  {generatingMessage ? t('project.generatingMessage') : t('project.generateMessage')}
                </button>
                <button className="btn btn-primary btn-sm" onClick={handleCommit} disabled={generatingMessage}>
                  {t('project.commitAction')}
                </button>
              </div>
            </div>

            <div>
              <h3 className="section-title">{t('project.dayLog')}</h3>
              <div className="git-controls">
                <AutoGrowTextarea
                  placeholder={t('project.dayLogPlaceholder')}
                  value={dayLog}
                  onChange={(e) => setDayLog(e.target.value)}
                  disabled={dayLogLoading}
                />
                <button className="btn btn-secondary btn-sm" onClick={handleDayLog} disabled={dayLogLoading}>
                  {dayLogLoading ? t('project.dayLogLoading') : t('project.dayLogGenerate')}
                </button>
              </div>
              {dayLogError && <div className="git-output review-error">{dayLogError}</div>}
            </div>

            <div>
              <div className="review-header">
                <h3 className="section-title">{t('project.review')}</h3>
                {!reviewing && findings.length > 0 && (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleFindingsToFixes}
                    disabled={savingFindings}
                    title={t('project.saveToFile', { file: FIXES_FILE })}
                  >
                    {t('project.toFixes', { count: findings.length })}
                  </button>
                )}
                {reviewing ? (
                  <button className="btn btn-danger btn-sm" onClick={stopReview}>
                    {t('common.stop')}
                  </button>
                ) : (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={handleReview}
                    disabled={!gitDiff}
                    title={gitDiff ? t('project.reviewTitle', { provider: providerLabel }) : t('common.noChanges')}
                  >
                    {t('project.reviewDiff')}
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
                <div className="git-output review-waiting">{t('project.reviewing', { provider: providerLabel })}</div>
              ) : (
                <div className="no-changes">
                  {t('project.reviewEmpty')}
                </div>
              )}
            </div>

            <div>
              <h3 className="section-title">{t('project.diff')}</h3>
              {gitDiff ? (
                <DiffViewer diff={gitDiff} projectId={id} provider={aiProvider} />
              ) : (
                <div className="no-changes">{t('project.noChangesToShow')}</div>
              )}
            </div>

            <div>
              <h3 className="section-title">{t('project.branches')}</h3>
              <div className="git-controls">
                <input
                  type="text"
                  placeholder={t('project.branchPlaceholder')}
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleBranch()}
                />
                <button className="btn btn-warning btn-sm" onClick={handleBranch}>
                  {t('project.createBranch')}
                </button>
                <button className="btn btn-danger btn-sm" onClick={() => setShowRollbackConfirm(true)}>
                  {t('project.rollback')}
                </button>
              </div>
            </div>

            <div>
              <h3 className="section-title">{t('project.log')}</h3>
              {gitLog.length === 0 ? (
                <div className="git-output">{t('project.noCommits')}</div>
              ) : (
                <div className="git-log">
                  {gitLog.map((line) => (
                    <button key={line} className="git-log-entry" onClick={() => handleShowCommit(line)} title={t('project.showCommit')}>
                      <span className="git-log-hash">{line.split(' ')[0]}</span>
                      <span>{line.slice(line.indexOf(' ') + 1)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h3 className="section-title">{t('project.status')}</h3>
              <div className="git-output">{gitStatus || t('common.noChanges')}</div>
            </div>
          </div>
        )}
      </div>

      {id && <ScreenshotPanel projectId={id} agent={lastAgent} sessionRunning={isRunning(lastAgent)} />}
      {id && <ChatPanel key={aiProvider} projectId={id} provider={aiProvider} />}

      {pendingRestart && (
        <ConfirmDialog
          title={t('project.resetContextTitle')}
          message={
            pendingRestart.prompt
              ? t('project.resetContextTask', { agent: labelOf(pendingRestart.agent) })
              : t('project.resetContextClean', { agent: labelOf(pendingRestart.agent) })
          }
          confirmLabel={t('project.restart')}
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
          title={t('project.rollbackTitle')}
          message={t('project.rollbackMessage')}
          confirmLabel={t('project.discard')}
          onConfirm={handleRollback}
          onCancel={() => setShowRollbackConfirm(false)}
        />
      )}

      {taskModalAgent && (
        <Modal
          title={t('project.startWithTaskTitle', { agent: labelOf(taskModalAgent) })}
          onClose={() => setTaskModalAgent(null)}
        >
          <div className="form-field">
            <label>{t('project.taskFor', { agent: labelOf(taskModalAgent) })}</label>
            <textarea
              className="task-textarea"
              value={taskPrompt}
              autoFocus
              rows={5}
              placeholder={t('project.taskPlaceholder')}
              onChange={(e) => setTaskPrompt(e.target.value)}
            />
            <MicButton onText={appendTo(setTaskPrompt)} />
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setTaskPrompt(t('project.polishPrompt'))}
              title={t('project.polishTitle')}
            >
              {t('project.polish')}
            </button>
          </div>
          {supportsContinue(taskModalAgent) && (
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={taskContinue}
                onChange={(e) => setTaskContinue(e.target.checked)}
              />
              {t('project.continueConversation')}
            </label>
          )}
          <div className="modal-actions">
            <button className="btn btn-secondary btn-sm" onClick={() => setTaskModalAgent(null)}>{t('common.cancel')}</button>
            <button className="btn btn-success btn-sm" onClick={handleStartWithTask}>{t('common.start')}</button>
          </div>
        </Modal>
      )}

      {commitView && (
        <Modal title={t('project.commitTitle', { hash: commitView.hash })} onClose={() => setCommitView(null)} wide>
          <div className="modal-wide-body">
            <DiffViewer diff={commitView.diff} projectId={id} />
          </div>
        </Modal>
      )}

      {showCredsModal && (
        <Modal title={t('project.credentialsTitle')} onClose={() => setShowCredsModal(false)}>
          <p className="modal-hint">
            {t('project.credentialsHint')}
          </p>
          <div className="form-field">
            <label>{t('project.host')}</label>
            <input type="text" value={credHost} onChange={(e) => setCredHost(e.target.value)} placeholder="github.com" />
          </div>
          <div className="form-field">
            <label>{t('project.username')}</label>
            <input type="text" value={credUser} onChange={(e) => setCredUser(e.target.value)} placeholder="your-login" />
          </div>
          <div className="form-field">
            <label>{t('project.token')}</label>
            <input type="password" value={credToken} onChange={(e) => setCredToken(e.target.value)} placeholder="ghp_…" />
          </div>
          <div className="modal-actions">
            <button className="btn btn-secondary btn-sm" onClick={() => setShowCredsModal(false)}>{t('common.cancel')}</button>
            <button className="btn btn-primary btn-sm" onClick={handleSaveCreds}>{t('common.save')}</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
