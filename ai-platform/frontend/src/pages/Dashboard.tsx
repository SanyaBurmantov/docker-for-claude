import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchProjects, addProject, deleteProject, Project } from '../services/api'
import ProjectCard from '../components/ProjectCard'
import SystemStatus from '../components/SystemStatus'
import Modal, { ConfirmDialog } from '../components/Modal'
import { useToast } from '../components/Toast'
import { useAttention } from '../components/ClaudeEvents'

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

  const loadProjects = useCallback(async () => {
    try {
      setError(null)
      const data = await fetchProjects()
      setProjects(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load projects')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadProjects()
    const interval = setInterval(loadProjects, 5000)
    return () => clearInterval(interval)
  }, [loadProjects])

  async function handleAddProject() {
    // Derive the name from the git URL when the name field is left empty
    let name = newName.trim()
    const gitUrl = newGitUrl.trim()
    if (!name && gitUrl) {
      name = gitUrl.split('/').pop()?.replace(/\.git$/, '') ?? ''
    }
    if (!name) {
      toast('error', 'Project name is required')
      return
    }
    setAdding(true)
    try {
      await addProject(name, gitUrl || undefined)
      toast('success', gitUrl ? `Cloned ${name}` : `Created ${name}`)
      setShowAdd(false)
      setNewName('')
      setNewGitUrl('')
      await loadProjects()
    } catch (e) {
      toast('error', `Failed to add project: ${e instanceof Error ? e.message : 'Unknown error'}`)
    } finally {
      setAdding(false)
    }
  }

  async function handleDeleteProject(id: string) {
    setDeleteTarget(null)
    try {
      await deleteProject(id)
      toast('success', `Deleted ${id}`)
      await loadProjects()
    } catch (e) {
      toast('error', `Failed to delete project: ${e instanceof Error ? e.message : 'Unknown error'}`)
    }
  }

  if (loading && projects.length === 0) {
    return <div className="loading">Loading projects...</div>
  }

  return (
    <div>
      <SystemStatus />

      <div className="dashboard-header">
        <h1>Projects</h1>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>Add Project</button>
      </div>

      {error && <div className="error">{error}</div>}

      {projects.length === 0 ? (
        <div className="no-changes">Place project folders in the directory configured in .env (PROJECTS_DIR), or add one above.</div>
      ) : (
        <div className="projects-grid">
          {projects.map((project) => (
            <ProjectCard
              key={project.name}
              project={project}
              sessionRunning={project.running}
              attention={attention[project.name]}
              onOpen={() => navigate(`/project/${project.name}?start=1`)}
              onDelete={() => setDeleteTarget(project.name)}
            />
          ))}
        </div>
      )}

      {showAdd && (
        <Modal title="Add Project" onClose={() => !adding && setShowAdd(false)}>
          <div className="form-field">
            <label>Project name</label>
            <input
              type="text"
              value={newName}
              autoFocus
              placeholder="my-project (optional if git URL is set)"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddProject()}
              disabled={adding}
            />
          </div>
          <div className="form-field">
            <label>Git URL (optional — clones through the proxy)</label>
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
              Cancel
            </button>
            <button className="btn btn-primary btn-sm" onClick={handleAddProject} disabled={adding}>
              {adding ? (newGitUrl.trim() ? 'Cloning…' : 'Creating…') : 'Create'}
            </button>
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete project"
          message={`Delete project "${deleteTarget}" and all its files? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => handleDeleteProject(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}
