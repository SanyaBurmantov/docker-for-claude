import { useCallback, useEffect, useState } from 'react'
import { fetchChecklistFile, saveChecklistFile } from '../services/api'
import {
  Task, TASK_RE, parseTasks, serialize,
  withTaskAdded, withTaskRemoved, withTaskToggled,
} from '../services/checklist'
import { useToast } from './Toast'

/** Every string the panel shows, so one component can back both checklists. */
export interface ChecklistCopy {
  /** Markdown heading written when the file does not exist yet. */
  heading: string
  addPlaceholder: string
  loading: string
  loadError: string
  empty: string
  allDone: string
  discussTitle: string
}

interface ChecklistPanelProps {
  projectId: string
  file: string
  copy: ChecklistCopy
  onDiscuss: (text: string) => void
}

export default function ChecklistPanel({ projectId, file, copy, onDiscuss }: ChecklistPanelProps) {
  const toast = useToast()
  const [lines, setLines] = useState<string[] | null>(null)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const content = await fetchChecklistFile(projectId, file)
      setLines(content === null ? [] : content.split('\n'))
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : copy.loadError)
    }
  }, [projectId, file, copy.loadError])

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
      toast('error', `Не сохранилось: ${e instanceof Error ? e.message : 'Unknown error'}`)
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
            Повторить
          </button>
        </div>
      </div>
    )
  }

  if (!lines) return <div className="no-changes">{copy.loading}</div>

  const tasks = parseTasks(lines)
  const active = tasks.filter((t) => !t.done)
  const done = tasks.filter((t) => t.done)

  const row = (task: Task) => (
    <div key={task.line} className={`task-row ${task.done ? 'task-done' : ''}`}>
      <button
        className="task-check"
        onClick={() => commit(withTaskToggled(lines, task))}
        disabled={saving}
        title={task.done ? 'Вернуть в работу' : 'Выполнено'}
        aria-label={task.done ? 'Вернуть в работу' : 'Выполнено'}
      >
        {task.done ? '☑' : '☐'}
      </button>

      <span className="task-text">{task.text}</span>

      <button className="btn btn-secondary btn-sm" onClick={() => onDiscuss(task.text)} title={copy.discussTitle}>
        Обсудить
      </button>
      <button
        className="btn btn-danger btn-sm"
        onClick={() => commit(withTaskRemoved(lines, task))}
        disabled={saving}
        title="Удалить"
      >
        Удалить
      </button>
    </div>
  )

  return (
    <div className="tasks-panel">
      <div className="git-controls">
        <input
          type="text"
          placeholder={copy.addPlaceholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <button className="btn btn-primary btn-sm" onClick={handleAdd} disabled={!draft.trim() || saving}>
          Добавить
        </button>
        <button className="btn btn-secondary btn-sm" onClick={load} disabled={saving}>
          Обновить
        </button>
      </div>

      {tasks.length === 0 ? (
        <div className="no-changes">
          {copy.empty} Лягут в <code>{file}</code> в корне проекта — Claude их тоже видит.
        </div>
      ) : (
        <>
          <div className="tasks-list">
            {active.length > 0 ? active.map(row) : <div className="no-changes">{copy.allDone}</div>}
          </div>

          {done.length > 0 && (
            <div>
              <h3 className="section-title">Выполнено</h3>
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
  addPlaceholder: 'Новая задача…',
  loading: 'Загрузка задач…',
  loadError: 'Не удалось загрузить задачи',
  empty: 'Задач пока нет.',
  allDone: 'Всё сделано',
  discussTitle: 'Запустить Claude с этой задачей',
}

export const FIXES_COPY: ChecklistCopy = {
  heading: 'Fixes',
  addPlaceholder: 'Новая доработка…',
  loading: 'Загрузка доработок…',
  loadError: 'Не удалось загрузить доработки',
  empty: 'Доработок пока нет. Их сюда складывает код-ревью на вкладке Git.',
  allDone: 'Всё исправлено',
  discussTitle: 'Запустить Claude с этой доработкой',
}
