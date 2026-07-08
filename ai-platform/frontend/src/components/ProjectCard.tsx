import { Project } from '../services/api'

interface ProjectCardProps {
  project: Project
  sessionRunning: boolean
  onOpen: () => void
  onDelete: () => void
}

export default function ProjectCard({ project, sessionRunning, onOpen, onDelete }: ProjectCardProps) {
  return (
    <div className="project-card">
      <h3>{project.name}</h3>
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
        {project.lastActivity && (
          <span style={{ color: '#666' }}>Last: {new Date(project.lastActivity).toLocaleString()}</span>
        )}
      </div>
      <div className="project-actions">
        <button className="btn btn-primary btn-sm" onClick={onOpen}>
          Open with Claude
        </button>
        <button className="btn btn-danger btn-sm" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  )
}
