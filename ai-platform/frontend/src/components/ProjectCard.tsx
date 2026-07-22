import { Project } from '../services/api'

interface ProjectCardProps {
  project: Project
  sessionRunning: boolean
  attention?: 'waiting' | 'done'
  onOpen: () => void
  /** Same as onOpen, but starts the session behind the Headroom compression proxy. */
  onOpenHr: () => void
  onDelete: () => void
  onToggleFavorite: () => void
}

export default function ProjectCard({ project, sessionRunning, attention, onOpen, onOpenHr, onDelete, onToggleFavorite }: ProjectCardProps) {
  return (
    <div className="project-card">
      <div className="project-card-head">
        <h3>{project.name}</h3>
        <button
          className={`favorite-toggle ${project.favorite ? 'is-favorite' : ''}`}
          onClick={onToggleFavorite}
          title={project.favorite ? 'Убрать из избранного' : 'В избранное'}
          aria-pressed={project.favorite}
        >
          {project.favorite ? '★' : '☆'}
        </button>
      </div>
      <div className="project-path">{project.path}</div>
      <div className="project-meta">
        <span>{project.size}</span>
        <span className={project.hasGit ? 'badge badge-git' : 'badge badge-no-git'}>
          {project.hasGit ? 'git' : 'no git'}
        </span>
        <span className={sessionRunning ? 'badge badge-running' : 'badge badge-offline'}>
          <span className={`status-indicator ${sessionRunning ? 'running' : 'offline'}`} />
          {sessionRunning ? 'Running' : 'Offline'}
        </span>
        {sessionRunning && attention === 'waiting' && (
          <span className="badge badge-waiting">⏳ Claude ждёт</span>
        )}
        {project.lastOpened ? (
          <span className="muted" title="Последнее открытие в платформе">
            Открыт: {new Date(project.lastOpened).toLocaleString()}
          </span>
        ) : (
          project.lastActivity && (
            <span className="muted" title="Последнее изменение папки проекта">
              Изменён: {new Date(project.lastActivity).toLocaleString()}
            </span>
          )
        )}
      </div>
      <div className="project-actions">
        <button className="btn btn-primary btn-sm" onClick={onOpen}>
          Open with Claude
        </button>
        <button
          className="btn btn-secondary btn-sm"
          onClick={onOpenHr}
          title="Запустить Claude Code за прокси Headroom (сжатие контекста)"
        >
          Open with Claude HR
        </button>
        <button className="btn btn-danger btn-sm" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  )
}
