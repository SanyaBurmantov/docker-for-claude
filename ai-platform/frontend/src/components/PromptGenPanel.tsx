import { useEffect, useRef, useState } from 'react'
import {
  streamPromptGen,
  startLoop,
  PromptGenSettings,
  PromptGenCost,
  DEFAULT_PROMPTGEN_SETTINGS,
} from '../services/api'

interface Props {
  projectId: string
}

const TARGET_OPTIONS: { value: PromptGenSettings['target']; label: string }[] = [
  { value: 'auto', label: 'Авто' },
  { value: 'coding-agent', label: 'Кодовый агент' },
  { value: 'system-prompt', label: 'Системный промт' },
  { value: 'llm-task', label: 'Разовая задача LLM' },
  { value: 'creative', label: 'Творческая' },
]

const ENGINE_OPTIONS: { value: PromptGenSettings['engine']; label: string }[] = [
  { value: 'any', label: 'Любой' },
  { value: 'claude', label: 'Claude' },
  { value: 'opencode', label: 'opencode' },
  { value: 'gemini', label: 'Gemini' },
]

const GROUNDING_OPTIONS: { value: PromptGenSettings['grounding']; label: string }[] = [
  { value: 'off', label: 'Выкл' },
  { value: 'auto', label: 'Авто' },
  { value: 'deep', label: 'Глубокий' },
]

const DETAIL_OPTIONS: { value: PromptGenSettings['detail']; label: string }[] = [
  { value: 'concise', label: 'Кратко' },
  { value: 'standard', label: 'Стандарт' },
  { value: 'verbose', label: 'Подробно' },
]

const SELF_CRITIQUE_OPTIONS: { value: PromptGenSettings['selfCritique']; label: string }[] = [
  { value: 'off', label: 'Выкл' },
  { value: 'auto-fix', label: 'Автодополнение' },
  { value: 'annotate', label: 'Пометки' },
]

const LANG_OPTIONS: { value: PromptGenSettings['lang']; label: string }[] = [
  { value: 'input', label: 'Как во вводе' },
  { value: 'ru', label: 'Русский' },
  { value: 'en', label: 'English' },
]

export default function PromptGenPanel({ projectId }: Props) {
  const [open, setOpen] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [settings, setSettings] = useState<PromptGenSettings>(DEFAULT_PROMPTGEN_SETTINGS)
  const [rough, setRough] = useState('')
  const [result, setResult] = useState('')
  const [notes, setNotes] = useState<string[]>([])
  const [cost, setCost] = useState<PromptGenCost | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [handoff, setHandoff] = useState<'idle' | 'sending' | 'sent'>('idle')

  const abortRef = useRef<AbortController | null>(null)
  const outputRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && open) setOpen(false)
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight })
  }, [result])

  useEffect(() => () => abortRef.current?.abort(), [])

  async function generate() {
    const text = rough.trim()
    if (!text || streaming) return

    setResult('')
    setNotes([])
    setCost(null)
    setError('')
    setCopied(false)
    setHandoff('idle')
    setStreaming(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      await streamPromptGen(
        projectId,
        text,
        settings,
        {
          onText: (chunk) => setResult((prev) => prev + chunk),
          onNote: (note) => setNotes((prev) => [...prev, note]),
          onReset: () => setResult(''),
          onCost: (c) => setCost(c),
        },
        controller.signal
      )
    } catch (err) {
      if (controller.signal.aborted) return
      setError((err as Error).message)
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }

  function stop() {
    abortRef.current?.abort()
    setStreaming(false)
  }

  async function copyResult() {
    if (!result) return
    await navigator.clipboard.writeText(result)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  async function sendToManager() {
    if (!result || handoff === 'sending') return
    setHandoff('sending')
    setError('')
    try {
      await startLoop(projectId, result)
      setHandoff('sent')
    } catch (err) {
      setError((err as Error).message)
      setHandoff('idle')
    }
  }

  return (
    <>
      <button
        className={`promptgen-tab ${open ? 'promptgen-tab-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="PromptGen (Ctrl+Shift+P)"
        aria-label="Toggle PromptGen panel"
      >
        <span className="promptgen-tab-label">PROMPTGEN</span>
      </button>

      {open && <div className="promptgen-scrim" onClick={() => setOpen(false)} />}

      <aside className={`promptgen-panel ${open ? 'promptgen-panel-open' : ''}`} aria-hidden={!open}>
        <header className="promptgen-header">
          <h3>PROMPTGEN</h3>
          <div className="promptgen-header-actions">
            <button
              className="promptgen-icon-btn"
              onClick={() => setShowSettings((v) => !v)}
              aria-pressed={showSettings}
              title="Настройки генерации"
            >
              ⚙
            </button>
            <button className="promptgen-icon-btn" onClick={() => setOpen(false)} aria-label="Close">
              ×
            </button>
          </div>
        </header>

        {showSettings && (
          <div className="promptgen-settings">
            <label>
              Тип промта
              <select
                value={settings.target}
                onChange={(e) => setSettings({ ...settings, target: e.target.value as PromptGenSettings['target'] })}
              >
                {TARGET_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label>
              Движок
              <select
                value={settings.engine}
                onChange={(e) => setSettings({ ...settings, engine: e.target.value as PromptGenSettings['engine'] })}
              >
                {ENGINE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label>
              Grounding
              <select
                value={settings.grounding}
                onChange={(e) => setSettings({ ...settings, grounding: e.target.value as PromptGenSettings['grounding'] })}
              >
                {GROUNDING_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label>
              Детализация
              <select
                value={settings.detail}
                onChange={(e) => setSettings({ ...settings, detail: e.target.value as PromptGenSettings['detail'] })}
              >
                {DETAIL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label>
              Само-критика
              <select
                value={settings.selfCritique}
                onChange={(e) => setSettings({ ...settings, selfCritique: e.target.value as PromptGenSettings['selfCritique'] })}
              >
                {SELF_CRITIQUE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label>
              Язык
              <select
                value={settings.lang}
                onChange={(e) => setSettings({ ...settings, lang: e.target.value as PromptGenSettings['lang'] })}
              >
                {LANG_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="promptgen-checkbox">
              <input
                type="checkbox"
                checked={settings.fewShot}
                onChange={(e) => setSettings({ ...settings, fewShot: e.target.checked })}
              />
              Few-shot примеры
            </label>
            <label className="promptgen-checkbox">
              <input
                type="checkbox"
                checked={settings.reasoning}
                onChange={(e) => setSettings({ ...settings, reasoning: e.target.checked })}
              />
              Блок рассуждения
            </label>
            <label className="promptgen-checkbox">
              <input
                type="checkbox"
                checked={settings.choiceValidation}
                onChange={(e) => setSettings({ ...settings, choiceValidation: e.target.checked })}
              />
              Кросс-критика Gemini
            </label>
          </div>
        )}

        <div className="promptgen-composer">
          <textarea
            className="promptgen-input"
            value={rough}
            onChange={(e) => setRough(e.target.value)}
            placeholder="Опиши что надо промту делать…"
            rows={4}
            disabled={streaming}
          />
          {streaming ? (
            <button className="btn btn-danger btn-sm" onClick={stop}>Stop</button>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={generate} disabled={!rough.trim()}>
              Сгенерировать
            </button>
          )}
        </div>

        {error && <div className="promptgen-warning">{error}</div>}

        <div className="promptgen-output" ref={outputRef}>
          {!result && !streaming && !error && (
            <p className="promptgen-empty">Результат появится здесь.</p>
          )}
          {result && <pre className="promptgen-result">{result}</pre>}
          {notes.length > 0 && (
            <div className="promptgen-notes">
              {notes.map((note, i) => (
                <pre key={i} className="promptgen-note">{note}</pre>
              ))}
            </div>
          )}
          {cost && (
            <div className="promptgen-cost">
              ≈{cost.chars} символов / ≈{cost.tokensApprox} токов входа, по {cost.model}: ${cost.estimateInUsd.toFixed(4)} вход
            </div>
          )}
        </div>

        <div className="promptgen-actions">
          <button className="btn btn-sm" onClick={copyResult} disabled={!result}>
            {copied ? 'Скопировано' : 'Скопировать'}
          </button>
          <button className="btn btn-sm" onClick={sendToManager} disabled={!result || handoff === 'sending'}>
            {handoff === 'sent' ? 'Отправлено' : handoff === 'sending' ? 'Отправка…' : 'Передать менеджеру'}
          </button>
        </div>
      </aside>
    </>
  )
}
