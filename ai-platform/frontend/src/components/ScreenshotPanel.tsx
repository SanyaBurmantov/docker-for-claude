import { useCallback, useEffect, useRef, useState } from 'react'
import Drawer from './Drawer'
import {
  fetchScreenshots,
  uploadScreenshots,
  deleteScreenshot,
  attachScreenshots,
  screenshotUrl,
  Screenshot,
  AgentId,
} from '../services/api'
import { copyText } from '../services/clipboard'
import { useToast } from './Toast'
import { useDrawer } from '../hooks/useDrawer'

interface ScreenshotPanelProps {
  projectId: string
  /** Whether an agent session is running — nothing to paste into if it is not. */
  sessionRunning: boolean
  /** Агент открытой вкладки — у каждого своя сессия, вставлять надо именно в неё. */
  agent: AgentId
}

function humanSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * The screenshot shelf: paste a mockup or a broken screen here instead of saving it
 * into the project root, then hand its path to the running agent in one click.
 */
export default function ScreenshotPanel({ projectId, sessionRunning, agent }: ScreenshotPanelProps) {
  const drawer = useDrawer('shots')
  const { open } = drawer
  const [shots, setShots] = useState<Screenshot[]>([])
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [preview, setPreview] = useState<Screenshot | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const toast = useToast()

  useEffect(() => {
    if (open) fetchScreenshots(projectId).then(setShots).catch(() => setShots([]))
  }, [open, projectId])

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
      await attachScreenshots(projectId, [shot.name], agent)
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
      <Drawer
        drawer={drawer}
        label="SHOTS"
        hotkey="s"
        side="right"
        // The lightbox opens on top of the panel, so Escape closes it first.
        onEscape={() => {
          if (!preview) return false
          setPreview(null)
          return true
        }}
        headerActions={
          <button
            className="drawer-icon-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            title="Выбрать файлы"
          >
            +
          </button>
        }
      >
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
                    title={sessionRunning ? 'Вставить путь в промпт агента' : 'Сессия не запущена'}
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
                  <button className="drawer-icon-btn" onClick={() => drop(shot)} title="Удалить">
                    ×
                  </button>
                </div>
              </figure>
            ))}
          </div>
        </div>
      </Drawer>

      {preview && (
        <div className="shots-lightbox" onClick={() => setPreview(null)}>
          <img src={screenshotUrl(projectId, preview.name)} alt={preview.name} />
        </div>
      )}
    </>
  )
}
