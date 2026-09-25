import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import type { AgentId, AgentInfo, AiProvider } from '../services/api'
import { useLanguage } from '../i18n'

interface Props {
  value: AiProvider
  agents: AgentInfo[]
  running: Partial<Record<AgentId, boolean>>
  disabled?: boolean
  onChange: (provider: AiProvider) => void
}

interface ProviderPresentation {
  label: string
  maker: string
  glyph: string
}

export const AI_PROVIDER_PRESENTATION: Record<AiProvider, ProviderPresentation> = {
  claude: { label: 'Claude Code', maker: 'Anthropic', glyph: 'CL' },
  opencode: { label: 'OpenCode', maker: 'Open source', glyph: 'OC' },
  codex: { label: 'Codex', maker: 'OpenAI', glyph: 'CX' },
  gemini: { label: 'Gemini', maker: 'Google', glyph: 'GM' },
}

/**
 * A real button/listbox instead of a native select: the latter cannot inherit
 * the platform theme consistently, especially in Chromium on Linux.
 */
export default function AiProviderPicker({ value, agents, running, disabled, onChange }: Props) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const listboxId = useId()
  const current = AI_PROVIDER_PRESENTATION[value]

  useEffect(() => {
    if (!open) return

    const closeFromOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeFromEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }

    document.addEventListener('mousedown', closeFromOutside)
    document.addEventListener('keydown', closeFromEscape)
    requestAnimationFrame(() => {
      const selected = agents.findIndex((agent) => agent.id === value)
      optionRefs.current[Math.max(0, selected)]?.focus()
    })
    return () => {
      document.removeEventListener('mousedown', closeFromOutside)
      document.removeEventListener('keydown', closeFromEscape)
    }
  }, [agents, open, value])

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  function choose(provider: AiProvider) {
    onChange(provider)
    setOpen(false)
    triggerRef.current?.focus()
  }

  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const last = agents.length - 1
    const focused = optionRefs.current.findIndex((node) => node === document.activeElement)
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? last
        : event.key === 'ArrowDown'
          ? focused >= last ? 0 : focused + 1
          : focused <= 0 ? last : focused - 1
    optionRefs.current[next]?.focus()
  }

  return (
    <div className="ai-picker" data-provider={value} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`ai-picker-trigger ${open ? 'ai-picker-trigger-open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        disabled={disabled}
        onClick={() => setOpen((shown) => !shown)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          event.preventDefault()
          setOpen(true)
        }}
        title={t('aiPicker.title')}
      >
        <span className="ai-picker-glyph" aria-hidden="true">{current.glyph}</span>
        <span className="ai-picker-copy">
          <strong>{current.label}</strong>
        </span>
        {running[value] && <span className="ai-picker-live" title={t('aiPicker.running')} />}
        <span className="ai-picker-chevron" aria-hidden="true" />
      </button>

      {open && (
        <div
          id={listboxId}
          className="ai-picker-menu"
          role="listbox"
          aria-label={t('aiPicker.aria')}
          onKeyDown={moveFocus}
        >
          <div className="ai-picker-menu-label">{t('aiPicker.available')}</div>
          {agents.map((agent, index) => {
            const presentation = AI_PROVIDER_PRESENTATION[agent.id]
            const selected = agent.id === value
            return (
              <button
                key={agent.id}
                ref={(node) => { optionRefs.current[index] = node }}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={-1}
                className={`ai-picker-option ${selected ? 'ai-picker-option-selected' : ''}`}
                data-provider={agent.id}
                onClick={() => choose(agent.id)}
              >
                <span className="ai-picker-glyph" aria-hidden="true">{presentation.glyph}</span>
                <span className="ai-picker-option-copy">
                  <strong>{presentation.label}</strong>
                  <span>{agent.id === 'opencode' ? t('aiPicker.openSource') : presentation.maker}</span>
                </span>
                {running[agent.id] && <span className="ai-picker-live" title={t('aiPicker.running')} />}
                <span className="ai-picker-check" aria-hidden="true">{selected ? '✓' : ''}</span>
              </button>
            )
          })}
          <div className="ai-picker-menu-hint">{t('aiPicker.hint')}</div>
        </div>
      )}
    </div>
  )
}
