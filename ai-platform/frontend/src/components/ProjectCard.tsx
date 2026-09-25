import { Project } from '../services/api'
import { useLanguage } from '../i18n'

interface ProjectCardProps {
  project: Project
  sessionRunning: boolean
  attention?: 'waiting' | 'done'
  onOpen: () => void
  onDelete: () => void
  onToggleFavorite: () => void
}

export default function ProjectCard({ project, sessionRunning, attention, onOpen, onDelete, onToggleFavorite }: ProjectCardProps) {
  const { t, locale } = useLanguage()
  return (
    <div className="project-card">
      <div className="project-card-head">
        <h3>{project.name}</h3>
        <button
          className={`favorite-toggle ${project.favorite ? 'is-favorite' : ''}`}
          onClick={onToggleFavorite}
          title={project.favorite ? t('projectCard.favoriteRemove') : t('projectCard.favoriteAdd')}
          aria-pressed={project.favorite}
        >
          {project.favorite ? '★' : '☆'}
        </button>
      </div>
      <div className="project-path">{project.path}</div>
      <div className="project-meta">
        <span>{project.size}</span>
        <span className={project.hasGit ? 'badge badge-git' : 'badge badge-no-git'}>
          {project.hasGit ? 'git' : t('projectCard.noGit')}
        </span>
        <span className={sessionRunning ? 'badge badge-running' : 'badge badge-offline'}>
          <span className={`status-indicator ${sessionRunning ? 'running' : 'offline'}`} />
          {sessionRunning ? t('common.running') : t('common.offline')}
        </span>
        {sessionRunning && attention === 'waiting' && (
          <span className="badge badge-waiting">{t('projectCard.waiting')}</span>
        )}
        {project.lastOpened ? (
          <span className="muted" title={t('projectCard.lastOpenedTitle')}>
            {t('projectCard.lastOpened', { date: new Date(project.lastOpened).toLocaleString(locale) })}
          </span>
        ) : (
          project.lastActivity && (
            <span className="muted" title={t('projectCard.lastChangedTitle')}>
              {t('projectCard.lastChanged', { date: new Date(project.lastActivity).toLocaleString(locale) })}
            </span>
          )
        )}
      </div>
      <div className="project-actions">
        <button className="btn btn-primary btn-sm" onClick={onOpen}>
          {t('projectCard.open')}
        </button>
        <button className="btn btn-danger btn-sm" onClick={onDelete}>
          {t('common.delete')}
        </button>
      </div>
    </div>
  )
}
