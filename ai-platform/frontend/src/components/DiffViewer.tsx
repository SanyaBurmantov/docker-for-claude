import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { streamExplain, ExplainMode } from '../services/api'

interface DiffViewerProps {
  diff: string
  projectId?: string
}

interface Anchor {
  code: string
  file: string
  hunk: string
  top: number
  left: number
}

const POPUP_WIDTH = 380

const LABEL: Record<ExplainMode, string> = {
  what: 'Что делает',
  how: 'Как работает',
}

function lineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'diff-line diff-file'
  if (line.startsWith('diff ') || line.startsWith('index ')) return 'diff-line diff-meta'
  if (line.startsWith('@@')) return 'diff-line diff-hunk'
  if (line.startsWith('+')) return 'diff-line diff-add'
  if (line.startsWith('-')) return 'diff-line diff-del'
  return 'diff-line'
}

function lineElement(node: Node | null): HTMLElement | null {
  const el = node instanceof HTMLElement ? node : (node?.parentElement ?? null)
  return el?.closest<HTMLElement>('[data-line]') ?? null
}

/**
 * Walks up from a selected line to the headers that say which file it belongs
 * to. A deleted file has "+++ /dev/null", so that case falls through to the
 * "diff --git" line, which always carries the real name.
 */
function locate(lines: string[], from: number): { file: string; hunk: string } {
  let hunk = ''

  for (let i = from; i >= 0; i--) {
    const line = lines[i]

    if (!hunk && line.startsWith('@@')) hunk = line

    if (line.startsWith('+++ ')) {
      const path = line.slice(4).trim()
      if (path !== '/dev/null') return { file: path.replace(/^b\//, ''), hunk }
    }

    const git = line.match(/^diff --git a\/.+ b\/(.+)$/)
    if (git) return { file: git[1], hunk }
  }

  return { file: '', hunk }
}

export default function DiffViewer({ diff, projectId }: DiffViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const [mode, setMode] = useState<ExplainMode | null>(null)
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState('')
  const [streaming, setStreaming] = useState(false)

  const dismiss = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setAnchor(null)
    setMode(null)
    setAnswer('')
    setError('')
    setStreaming(false)
  }, [])

  // Line numbers in the anchor refer to the diff we captured them from.
  useEffect(() => {
    dismiss()
  }, [diff, dismiss])

  useEffect(() => () => abortRef.current?.abort(), [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dismiss])

  useEffect(() => {
    if (!anchor) return

    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node
      if (popupRef.current?.contains(target)) return
      // A click inside the diff is a new selection; onMouseUp decides its fate.
      if (containerRef.current?.contains(target)) return
      dismiss()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [anchor, dismiss])

  // Scrolling slides the code out from under the buttons, which are anchored to
  // a selection that is no longer where they point. An open answer stands alone,
  // so it survives the scroll.
  useEffect(() => {
    const root = containerRef.current
    if (!root || !anchor || mode !== null) return

    root.addEventListener('scroll', dismiss)
    return () => root.removeEventListener('scroll', dismiss)
  }, [anchor, mode, dismiss])

  if (!diff.trim()) {
    return <div className="no-changes">No changes detected</div>
  }

  const lines = diff.split('\n')

  function onMouseUp() {
    if (!projectId) return

    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      dismiss()
      return
    }

    const range = selection.getRangeAt(0)
    const root = containerRef.current
    if (!root?.contains(range.commonAncestorContainer)) return

    const startEl = lineElement(range.startContainer)
    const endEl = lineElement(range.endContainer) ?? startEl
    if (!startEl || !endEl) return

    const from = Number(startEl.dataset.line)
    const to = Number(endEl.dataset.line)
    const [first, last] = from <= to ? [from, to] : [to, from]

    // Whole lines, so a half-dragged line still reaches Claude as valid code.
    const code = lines.slice(first, last + 1).join('\n')
    if (!code.trim()) {
      dismiss()
      return
    }

    const rect = range.getBoundingClientRect()
    const { file, hunk } = locate(lines, first)

    abortRef.current?.abort()
    abortRef.current = null
    setMode(null)
    setAnswer('')
    setError('')
    setStreaming(false)
    setAnchor({
      code,
      file,
      hunk,
      top: rect.bottom + 8,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - POPUP_WIDTH - 8)),
    })
  }

  async function ask(next: ExplainMode) {
    if (!anchor || !projectId) return

    setMode(next)
    setAnswer('')
    setError('')
    setStreaming(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      await streamExplain(
        projectId,
        { mode: next, code: anchor.code, file: anchor.file, hunk: anchor.hunk },
        (chunk) => setAnswer((prev) => prev + chunk),
        controller.signal
      )
    } catch (err) {
      if (controller.signal.aborted) return
      setError((err as Error).message)
    } finally {
      if (!controller.signal.aborted) {
        setStreaming(false)
        abortRef.current = null
      }
    }
  }

  const popup = anchor && projectId && (
    <div
      ref={popupRef}
      className="diff-pop"
      style={{ top: anchor.top, left: anchor.left, width: POPUP_WIDTH }}
      // Keep the browser from collapsing the selection we are about to send.
      onMouseDown={(e) => e.preventDefault()}
    >
      {mode === null ? (
        <div className="diff-pop-actions">
          <button className="diff-pop-btn" onClick={() => ask('what')}>
            {LABEL.what}
          </button>
          <button className="diff-pop-btn" onClick={() => ask('how')}>
            {LABEL.how}
          </button>
        </div>
      ) : (
        <div className="diff-pop-card">
          <header className="diff-pop-head">
            <span className="diff-pop-title">{LABEL[mode]}</span>
            {anchor.file && <span className="diff-pop-file">{anchor.file}</span>}
            <button className="diff-pop-close" onClick={dismiss} aria-label="Закрыть">
              ×
            </button>
          </header>

          {error ? (
            <div className="diff-pop-body diff-pop-error">{error}</div>
          ) : answer ? (
            <div className="diff-pop-body">
              {answer}
              {streaming && <span className="gemini-caret" />}
            </div>
          ) : (
            <div className="diff-pop-body diff-pop-waiting">
              {mode === 'how' ? 'Claude читает проект…' : 'Claude думает…'}
            </div>
          )}
        </div>
      )}
    </div>
  )

  return (
    <div className="diff-container" ref={containerRef} onMouseUp={onMouseUp}>
      <pre className="diff-view">
        {lines.map((line, i) => (
          <div key={i} data-line={i} className={lineClass(line)}>
            {line || ' '}
          </div>
        ))}
      </pre>
      {/* The commit modal sets filter+clip-path, which would trap and clip a
          position:fixed child, so the popup renders outside it. */}
      {popup && createPortal(popup, document.body)}
    </div>
  )
}
