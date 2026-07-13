import { useEffect, useRef, useState } from 'react'
import {
  fetchLoop,
  startLoop,
  postLoopMessage,
  resolveLoopGate,
  stopLoopRun,
  streamLoop,
  LoopState,
  LoopGatePayload,
  LoopDecision,
  LoopIteration,
  LoopStreamEvent,
} from '../services/api'

interface Props {
  projectId: string
}

const PHASE_LABEL: Record<LoopState['status'], string> = {
  idle: 'Ожидание',
  analyzing: 'Анализ',
  awaiting_approval: 'Гейт',
  implementing: 'Правки',
  verifying: 'Проверка',
  aggregating: 'Итог',
  done: 'Готово',
  failed: 'Провал',
  stopped: 'Остановлен',
}

const ROLE_LABEL: Record<LoopIteration['role'], string> = {
  manager: 'Менеджер',
  analyst: 'Аналитик',
  executor: 'Исполнитель',
  tester: 'Тестировщик',
  reviewer: 'Ревьюер',
}

const ACTIVE_STATUSES: LoopState['status'][] = ['analyzing', 'implementing', 'verifying', 'aggregating']
const TERMINAL_STATUSES: LoopState['status'][] = ['idle', 'done', 'failed', 'stopped']

function gateFromDecision(d: LoopDecision, planPath: string): LoopGatePayload {
  return {
    task: d.task,
    complexity: d.complexity,
    executor: d.executor,
    planPath,
    ...(d.action === 'ask_human' ? { openQuestions: d.open_questions } : {}),
  }
}

export default function ManagerPanel({ projectId }: Props) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<LoopState | null>(null)
  const [gate, setGate] = useState<LoopGatePayload | null>(null)
  const [liveText, setLiveText] = useState('')
  const [goalInput, setGoalInput] = useState('')
  const [noteInput, setNoteInput] = useState('')
  const [editTask, setEditTask] = useState('')
  const [starting, setStarting] = useState(false)
  const [gateBusy, setGateBusy] = useState(false)
  const [error, setError] = useState('')

  const unsubRef = useRef<() => void>(() => {})
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false

    function onEvent(e: LoopStreamEvent) {
      switch (e.type) {
        case 'phase':
          setState((prev) => (prev ? { ...prev, status: e.status } : prev))
          if (e.status !== 'awaiting_approval') setGate(null)
          if (e.status === 'done' || e.status === 'failed' || e.status === 'stopped') {
            fetchLoop(projectId).then(setState).catch(() => {})
          }
          break
        case 'turn':
          setState((prev) => (prev ? { ...prev, iterations: [...prev.iterations, e.it] } : prev))
          setLiveText('')
          break
        case 'text':
          setLiveText((prev) => prev + e.text)
          break
        case 'gate':
          setGate(e.gate)
          setEditTask(e.gate.task)
          setState((prev) => (prev ? { ...prev, status: 'awaiting_approval' } : prev))
          setOpen(true)
          break
        case 'done':
          fetchLoop(projectId).then(setState).catch(() => {})
          break
        case 'error':
          setError(e.error)
          break
      }
    }

    fetchLoop(projectId)
      .then((s) => {
        if (cancelled) return
        setState(s)
        if (s?.status === 'awaiting_approval' && s.pendingDecision) {
          const g = gateFromDecision(s.pendingDecision, s.planPath)
          setGate(g)
          setEditTask(g.task)
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) unsubRef.current = streamLoop(projectId, onEvent)
      })

    return () => {
      cancelled = true
      unsubRef.current()
    }
  }, [projectId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [state?.iterations.length, liveText])

  async function handleStart() {
    const goal = goalInput.trim()
    if (!goal || starting) return
    setStarting(true)
    setError('')
    try {
      const s = await startLoop(projectId, goal)
      setState(s)
      setGoalInput('')
      setOpen(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось запустить loop')
    } finally {
      setStarting(false)
    }
  }

  async function handleGateResolve(approve: boolean) {
    if (!gate || gateBusy) return
    setGateBusy(true)
    setError('')
    try {
      const edit = approve && editTask.trim() && editTask.trim() !== gate.task ? { task: editTask.trim() } : undefined
      await resolveLoopGate(projectId, { approve, edit, note: noteInput.trim() || undefined })
      setNoteInput('')
      setGate(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Гейт не отработал')
    } finally {
      setGateBusy(false)
    }
  }

  async function handleSendNote() {
    const note = noteInput.trim()
    if (!note || !state) return
    setNoteInput('')
    try {
      await postLoopMessage(projectId, note)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Заметка не отправилась')
    }
  }

  async function handleStop() {
    try {
      await stopLoopRun(projectId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось остановить loop')
    }
  }

  const canStart = !state || TERMINAL_STATUSES.includes(state.status)
  const isActive = Boolean(state) && !canStart

  return (
    <>
      <button
        className={`manager-tab ${open ? 'manager-tab-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Loop-менеджер"
        aria-label="Toggle manager panel"
      >
        <span className="manager-tab-label">MANAGER</span>
      </button>

      {open && <div className="manager-scrim" onClick={() => setOpen(false)} />}

      <aside className={`manager-panel ${open ? 'manager-panel-open' : ''}`} aria-hidden={!open}>
        <header className="manager-header">
          <h3>MANAGER</h3>
          <div className="manager-header-actions">
            {state && <span className={`manager-phase manager-phase-${state.status}`}>{PHASE_LABEL[state.status]}</span>}
            {isActive && (
              <button className="btn btn-danger btn-sm" onClick={handleStop} title="Остановить loop">
                Stop
              </button>
            )}
            <button className="manager-icon-btn" onClick={() => setOpen(false)} aria-label="Close">
              ×
            </button>
          </div>
        </header>

        {error && <div className="manager-warning">{error}</div>}

        {canStart && (
          <div className="manager-starter">
            <textarea
              className="manager-input"
              value={goalInput}
              onChange={(e) => setGoalInput(e.target.value)}
              placeholder="Одна задача для loop-менеджера…"
              rows={3}
              disabled={starting}
            />
            <button className="btn btn-primary btn-sm" onClick={handleStart} disabled={!goalInput.trim() || starting}>
              {starting ? 'Запуск…' : '▶ Запустить loop'}
            </button>
          </div>
        )}

        {state && (
          <>
            <div className="manager-goal">{state.goal}</div>

            <div className="manager-feed" ref={scrollRef}>
              {state.iterations.length === 0 && !liveText && (
                <p className="manager-empty">Пока ни одного хода.</p>
              )}
              {state.iterations.map((it) => (
                <div key={it.n} className={`manager-turn manager-turn-${it.role}`}>
                  <div className="manager-turn-head">
                    <span className="manager-turn-role">{ROLE_LABEL[it.role]}</span>
                    {it.engine && <span className="manager-turn-engine">{it.engine.engine}/{it.engine.model}</span>}
                  </div>
                  <div className="manager-turn-summary">{it.summary}</div>
                </div>
              ))}
              {liveText && (
                <div className="manager-turn manager-turn-live">
                  <div className="manager-turn-head">
                    <span className="manager-turn-role">{PHASE_LABEL[state.status]}…</span>
                  </div>
                  <div className="manager-turn-summary">
                    {liveText}
                    <span className="gemini-caret" />
                  </div>
                </div>
              )}
            </div>

            {gate && (
              <div className="manager-gate">
                <div className="manager-gate-title">
                  {gate.openQuestions ? '❓ Менеджеру нужен ответ' : '⛔ Гейт перед правками'}
                </div>
                {gate.openQuestions ? (
                  <ul className="manager-gate-questions">
                    {gate.openQuestions.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                ) : (
                  <>
                    <textarea
                      className="manager-input"
                      value={editTask}
                      onChange={(e) => setEditTask(e.target.value)}
                      rows={3}
                    />
                    <div className="manager-gate-meta">
                      {gate.complexity} · {gate.executor.engine}/{gate.executor.model}
                    </div>
                  </>
                )}
                <input
                  type="text"
                  className="manager-note-input"
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  placeholder="Реплика менеджеру (необязательно)…"
                />
                <div className="manager-gate-actions">
                  {gate.openQuestions ? (
                    <button className="btn btn-primary btn-sm" onClick={() => handleGateResolve(true)} disabled={gateBusy}>
                      Продолжить
                    </button>
                  ) : (
                    <>
                      <button className="btn btn-danger btn-sm" onClick={() => handleGateResolve(false)} disabled={gateBusy}>
                        Отклонить
                      </button>
                      <button className="btn btn-success btn-sm" onClick={() => handleGateResolve(true)} disabled={gateBusy}>
                        ✓ Approve
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {!gate && isActive && (
              <div className="manager-composer">
                <input
                  type="text"
                  className="manager-note-input"
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendNote()}
                  placeholder="Реплика в чат менеджера…"
                />
                <button className="btn btn-secondary btn-sm" onClick={handleSendNote} disabled={!noteInput.trim()}>
                  Send
                </button>
              </div>
            )}
          </>
        )}
      </aside>
    </>
  )
}
