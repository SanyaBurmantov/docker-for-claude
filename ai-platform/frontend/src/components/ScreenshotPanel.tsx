import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchScreenshots,
  uploadScreenshots,
  deleteScreenshot,
  attachScreenshots,
  screenshotUrl,
  Screenshot,
} from '../services/api'
import { copyText } from '../services/clipboard'
import { useToast } from './Toast'

interface ScreenshotPanelProps {
  projectId: string
  /** Whether an agent session is running — nothing to paste into if it is not. */
  sessionRunning: boolean
}

function humanSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * The screenshot shelf: paste a mockup or a broken screen here instead of saving it
 * into the project root, then hand its path to the running agent in one click.
 */
export default function ScreenshotPanel({ projectId, sessionRunning }: ScreenshotPanelProps) {
  const [open, setOpen] = useState(false)
  const [shots, setShots] = useState<Screenshot[]>([])
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [preview, setPreview] = useState<Screenshot | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const toast = useToast()

  const reload = useCallback(() => {
    fetchScreenshots(projectId)
      .then(setShots)
      .catch(() => setShots([]))
  }, [projectId])

  useEffect(() => {
    if (open) reload()
  }, [open, reload])

  const upload = useCallback(
    async (files: File[]) => {
      const images = files.filter((f) => f.type.startsWith('image/'))
      if (images.length === 0) return
      setBusy(true)
      try {
        const saved = await uploadScreenshots(projectId, images)
        setShots((prev) => [...saved, ...prev])
        toast('success', `Загружено: ${saved.length}`)
      } catch (err) {
        toast('error', String(err))
      } finally {
        setBusy(false)
      }
    },
    [projectId, toast]
  )

  // Ctrl+Shift+S toggles from anywhere, including inside the terminal.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && open) {
        if (preview) setPreview(null)
        else setOpen(false)
      }
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, preview])

  // A screenshot normally arrives on the clipboard, never as a file on disk, so the
  // panel takes a paste from anywhere on the page while it is open — that is the
  // whole point of the feature.
  useEffect(() => {
    if (!open) return
    function onPaste(e: ClipboardEvent) {
      const files = Array.from(e.clipboardData?.files ?? [])
      if (files.length === 0) return
      e.preventDefault()
      upload(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [open, upload])

  async function attach(shot: Screenshot) {
    try {
      await attachScreenshots(projectId, [shot.name])
      toast('success', 'Путь вставлен в сессию')
    } catch (err) {
      toast('error', String(err))
    }
  }

  async function drop(shot: Screenshot) {
    try {
      await deleteScreenshot(projectId, shot.name)
      setShots((prev) => prev.filter((s) => s.name !== shot.name))
    } catch (err) {
      toast('error', String(err))
    }
  }

  return (
    <>
      <button
        className={`shots-tab ${open ? 'shots-tab-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Скриншоты (Ctrl+Shift+S)"
        aria-label="Toggle screenshots panel"
      >
        <span className="shots-tab-label">SHOTS</span>
      </button>

      {open && <div className="shots-scrim" onClick={() => setOpen(false)} />}

      <aside className={`shots-panel ${open ? 'shots-panel-open' : ''}`} aria-hidden={!open}>
        <header className="shots-header">
          <h3>SHOTS</h3>
          <div className="shots-header-actions">
            <button
              className="gemini-icon-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              title="Выбрать файлы"
            >
              +
            </button>
            <button className="gemini-icon-btn" onClick={() => setOpen(false)} aria-label="Close">
              ×
            </button>
          </div>
        </header>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            upload(Array.from(e.target.files ?? []))
            e.target.value = '' // same file twice in a row still fires onChange
          }}
        />

        <div
          className={`shots-body ${dragging ? 'shots-body-drag' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            upload(Array.from(e.dataTransfer.files))
          }}
        >
          {shots.length === 0 && (
            <p className="shots-empty">
              Ctrl+V — вставить скриншот из буфера.
              <br />
              Или перетащи файлы сюда.
            </p>
          )}

          <div className="shots-grid">
            {shots.map((shot) => (
              <figure className="shots-card" key={shot.name}>
                <img
                  className="shots-thumb"
                  src={screenshotUrl(projectId, shot.name)}
                  alt={shot.name}
                  loading="lazy"
                  onClick={() => setPreview(shot)}
                />
                <figcaption className="shots-name" title={shot.agentPath}>
                  {shot.name} · {humanSize(shot.size)}
                </figcaption>
                <div className="shots-actions">
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => attach(shot)}
                    disabled={!sessionRunning}
                    title={
                      sessionRunning
                        ? 'Вставить путь в промпт агента'
                        : 'Сессия не запущена'
                    }
                  >
                    → сессия
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      copyText(shot.agentPath)
                      toast('success', 'Путь скопирован')
                    }}
                    title={shot.agentPath}
                  >
                    путь
                  </button>
                  <button className="gemini-icon-btn" onClick={() => drop(shot)} title="Удалить">
                    ×
                  </button>
                </div>
              </figure>
            ))}
          </div>
        </div>
      </aside>

      {preview && (
        <div className="shots-lightbox" onClick={() => setPreview(null)}>
          <img src={screenshotUrl(projectId, preview.name)} alt={preview.name} />
        </div>
      )}
    </>
  )
}
