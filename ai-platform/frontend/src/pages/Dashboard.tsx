import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchProjects, addProject, deleteProject, setProjectFavorite, Project } from '../services/api'
import ProjectCard from '../components/ProjectCard'
import SystemStatus from '../components/SystemStatus'
import Modal, { ConfirmDialog } from '../components/Modal'
import { useToast } from '../components/Toast'
import { useAttention } from '../components/ClaudeEvents'
import { useLanguage } from '../i18n'

/**
 * Recency of a project: when it was last opened here, or — for one never opened
 * from the platform — when its directory last changed. Both are ISO strings, so
 * they sort as text; a project with neither sinks to the bottom.
 */
function recency(project: Project): string {
  return project.lastOpened ?? project.lastActivity ?? ''
}

function byRecency(a: Project, b: Project): number {
  return recency(b).localeCompare(recency(a))
}

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newGitUrl, setNewGitUrl] = useState('')
  const [adding, setAdding] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const navigate = useNavigate()
  const toast = useToast()
  const attention = useAttention()
  const { t } = useLanguage()

  const loadProjects = useCallback(async () => {
    try {
      setError(null)
      const data = await fetchProjects()
      setProjects(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dashboard.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    loadProjects()
    const interval = setInterval(loadProjects, 5000)
    return () => clearInterval(interval)
  }, [loadProjects])

  const { favorites, rest } = useMemo(() => {
    const sorted = [...projects].sort(byRecency)
    return {
      favorites: sorted.filter((p) => p.favorite),
      rest: sorted.filter((p) => !p.favorite),
    }
  }, [projects])

  async function handleAddProject() {
    // Derive the name from the git URL when the name field is left empty
    let name = newName.trim()
    const gitUrl = newGitUrl.trim()
    if (!name && gitUrl) {
      name = gitUrl.split('/').pop()?.replace(/\.git$/, '') ?? ''
    }
    if (!name) {
      toast('error', t('dashboard.nameRequired'))
      return
    }
    setAdding(true)
    try {
      await addProject(name, gitUrl || undefined)
      toast('success', t(gitUrl ? 'dashboard.cloned' : 'dashboard.created', { name }))
      setShowAdd(false)
      setNewName('')
      setNewGitUrl('')
      await loadProjects()
    } catch (e) {
      toast('error', t('dashboard.addFailed', { error: e instanceof Error ? e.message : t('common.unknownError') }))
    } finally {
      setAdding(false)
    }
  }

  async function handleDeleteProject(id: string) {
    setDeleteTarget(null)
    try {
      await deleteProject(id)
      toast('success', t('dashboard.deleted', { name: id }))
      await loadProjects()
    } catch (e) {
      toast('error', t('dashboard.deleteFailed', { error: e instanceof Error ? e.message : t('common.unknownError') }))
    }
  }

  async function handleToggleFavorite(project: Project) {
    const favorite = !project.favorite
    // The 5s poll would otherwise hold the old star until the next round trip.
    setProjects((prev) => prev.map((p) => (p.name === project.name ? { ...p, favorite } : p)))
    try {
      await setProjectFavorite(project.name, favorite)
    } catch (e) {
      toast('error', t('dashboard.saveFailed', { error: e instanceof Error ? e.message : t('common.unknownError') }))
      await loadProjects()
    }
  }

  if (loading && projects.length === 0) {
    return <div className="loading">{t('dashboard.loading')}</div>
  }

  return (
    <div>
      <SystemStatus />

      <div className="dashboard-header">
        <h1>{t('dashboard.title')}</h1>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>{t('dashboard.add')}</button>
      </div>

      {error && <div className="error">{error}</div>}

      {projects.length === 0 ? (
        <div className="no-changes">{t('dashboard.empty')}</div>
      ) : (
        <>
          {favorites.length > 0 && (
            <section className="project-group project-group-favorites">
              <h2 className="project-group-title">{t('dashboard.favorites')}</h2>
              <div className="projects-grid">
                {favorites.map((project) => (
                  <ProjectCard
                    key={project.name}
                    project={project}
                    sessionRunning={project.running}
                    attention={attention[project.name]}
                    onOpen={() => navigate(`/project/${project.name}?open=1`)}
                    onDelete={() => setDeleteTarget(project.name)}
                    onToggleFavorite={() => handleToggleFavorite(project)}
                  />
                ))}
              </div>
            </section>
          )}

          <div className="projects-grid">
            {rest.map((project) => (
              <ProjectCard
                key={project.name}
                project={project}
                sessionRunning={project.running}
                attention={attention[project.name]}
                onOpen={() => navigate(`/project/${project.name}?open=1`)}
                onDelete={() => setDeleteTarget(project.name)}
                onToggleFavorite={() => handleToggleFavorite(project)}
              />
            ))}
          </div>
        </>
      )}

      {showAdd && (
        <Modal title={t('dashboard.addTitle')} onClose={() => !adding && setShowAdd(false)}>
          <div className="form-field">
            <label>{t('dashboard.projectName')}</label>
            <input
              type="text"
              value={newName}
              autoFocus
              placeholder={t('dashboard.projectPlaceholder')}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddProject()}
              disabled={adding}
            />
          </div>
          <div className="form-field">
            <label>{t('dashboard.gitUrl')}</label>
            <input
              type="text"
              value={newGitUrl}
              placeholder="https://github.com/user/repo.git"
              onChange={(e) => setNewGitUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddProject()}
              disabled={adding}
            />
          </div>
          <div className="modal-actions">
            <button className="btn btn-secondary btn-sm" onClick={() => setShowAdd(false)} disabled={adding}>
              {t('common.cancel')}
            </button>
            <button className="btn btn-primary btn-sm" onClick={handleAddProject} disabled={adding}>
              {adding
                ? (newGitUrl.trim() ? t('dashboard.cloning') : t('dashboard.creating'))
                : t('common.create')}
            </button>
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={t('dashboard.deleteTitle')}
          message={t('dashboard.deleteMessage', { name: deleteTarget })}
          confirmLabel={t('common.delete')}
          onConfirm={() => handleDeleteProject(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}
