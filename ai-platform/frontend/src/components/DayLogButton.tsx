import { useState } from 'react'
import Modal from './Modal'
import { streamDayLog } from '../services/api'

/** Header button: on click, summarises today's git commits into a small modal. */
export default function DayLogButton() {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function openReport() {
    setOpen(true)
    setText('')
    setError(null)
    setLoading(true)
    try {
      await streamDayLog((chunk) => setText((prev) => prev + chunk))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось собрать отчёт')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button type="button" className="nav-link" onClick={openReport}>
        Трудозатраты за день
      </button>
      {open && (
        <Modal title="Трудозатраты за день" onClose={() => setOpen(false)}>
          {error ? (
            <div className="error">{error}</div>
          ) : (
            <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
              {text || (loading ? 'Собираю коммиты…' : '')}
            </p>
          )}
        </Modal>
      )}
    </>
  )
}
