import { useCallback, useEffect, useState } from 'react'
import { fetchChecklistFile, saveChecklistFile } from '../services/api'
import {
  Task, TASK_RE, parseTasks, serialize,
  withTaskAdded, withTaskRemoved, withTaskToggled,
} from '../services/checklist'
import { useToast } from './Toast'
import { useLanguage } from '../i18n'

/** Every string the panel shows, so one component can back both checklists. */
export interface ChecklistCopy {
  /** Markdown heading written when the file does not exist yet. */
  heading: string
  kind: 'tasks' | 'fixes'
}

interface ChecklistPanelProps {
  projectId: string
  file: string
  copy: ChecklistCopy
  onDiscuss: (text: string) => void
}

export default function ChecklistPanel({ projectId, file, copy, onDiscuss }: ChecklistPanelProps) {
  const toast = useToast()
  const { t } = useLanguage()
  const [lines, setLines] = useState<string[] | null>(null)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const content = await fetchChecklistFile(projectId, file)
      // CRLF line endings (common on a Windows checkout) leave a trailing \r on
      // every line after this split; TASK_RE's `$` can't match past it, so a
      // CRLF task silently disappears from the list. Normalize once, here.
      setLines(content === null ? [] : content.replace(/\r\n/g, '\n').split('\n'))
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : t(`${copy.kind}.loadError`))
    }
  }, [projectId, file, copy.kind, t])

  // A tab switch remounts the panel, so the file is re-read on every open.
  useEffect(() => {
    setLines(null)
    load()
  }, [load])

  async function commit(next: string[]) {
    const previous = lines
    setLines(next)
    setSaving(true)
    try {
      await saveChecklistFile(projectId, file, serialize(next))
    } catch (e) {
      setLines(previous)
      toast('error', t('checklist.saveFailed', { error: e instanceof Error ? e.message : t('common.unknownError') }))
    } finally {
      setSaving(false)
    }
  }

  function handleAdd() {
    // A pasted "- [ ] foo" would otherwise become "- [ ] - [ ] foo"
    const text = draft.trim().replace(TASK_RE, '$2').trim()
    if (!text || !lines) return
    setDraft('')
    commit(withTaskAdded(lines, text, copy.heading))
  }

  if (error) {
    return (
      <div className="git-output review-error">
        {error}
        <div style={{ marginTop: 12 }}>
          <button className="btn btn-secondary btn-sm" onClick={load}>
            {t('checklist.retry')}
          </button>
        </div>
      </div>
    )
  }

  if (!lines) return <div className="no-changes">{t(`${copy.kind}.loading`)}</div>

  const tasks = parseTasks(lines)
  const active = tasks.filter((t) => !t.done)
  const done = tasks.filter((t) => t.done)

  const row = (task: Task) => (
    <div key={task.line} className={`task-row ${task.done ? 'task-done' : ''}`}>
      <button
        className="task-check"
        onClick={() => commit(withTaskToggled(lines, task))}
        disabled={saving}
        title={task.done ? t('checklist.returnToWork') : t('checklist.done')}
        aria-label={task.done ? t('checklist.returnToWork') : t('checklist.done')}
      >
        {task.done ? '☑' : '☐'}
      </button>

      <span className="task-text">{task.text}</span>

      <button className="btn btn-secondary btn-sm" onClick={() => onDiscuss(task.text)} title={t(`${copy.kind}.discussTitle`)}>
        {t('common.discuss')}
      </button>
      <button
        className="btn btn-danger btn-sm"
        onClick={() => commit(withTaskRemoved(lines, task))}
        disabled={saving}
        title={t('checklist.delete')}
      >
        {t('checklist.delete')}
      </button>
    </div>
  )

  return (
    <div className="tasks-panel">
      <div className="git-controls">
        <input
          type="text"
          placeholder={t(`${copy.kind}.placeholder`)}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <button className="btn btn-primary btn-sm" onClick={handleAdd} disabled={!draft.trim() || saving}>
          {t('checklist.add')}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={load} disabled={saving}>
          {t('checklist.refresh')}
        </button>
      </div>

      {tasks.length === 0 ? (
        <div className="no-changes">
          {t(`${copy.kind}.empty`)} {t('checklist.fileHint', { file })}
        </div>
      ) : (
        <>
          <div className="tasks-list">
            {active.length > 0 ? active.map(row) : <div className="no-changes">{t(`${copy.kind}.allDone`)}</div>}
          </div>

          {done.length > 0 && (
            <div>
              <h3 className="section-title">{t('checklist.completed')}</h3>
              <div className="tasks-list">{done.map(row)}</div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export const TASKS_COPY: ChecklistCopy = {
  heading: 'Tasks',
  kind: 'tasks',
}

export const FIXES_COPY: ChecklistCopy = {
  heading: 'Fixes',
  kind: 'fixes',
}
