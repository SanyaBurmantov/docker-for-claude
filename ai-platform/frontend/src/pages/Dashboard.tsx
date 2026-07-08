import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchProjects, deleteProject, getSessionStatus, Project } from '../services/api'
import ProjectCard from '../components/ProjectCard'

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sessionStatuses, setSessionStatuses] = useState<Record<string, boolean>>({})
  const navigate = useNavigate()

  const loadProjects = useCallback(async () => {
    try {
      setError(null)
      const data = await fetchProjects()
      setProjects(data)
      const statuses: Record<string, boolean> = {}
      for (const p of data) {
        try {
          const s = await getSessionStatus(p.name)
          statuses[p.name] = s.running
        } catch {
          statuses[p.name] = false
        }
      }
      setSessionStatuses(statuses)
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

  async function handleDeleteProject(id: string) {
    if (!confirm('Are you sure you want to delete this project?')) return
    try {
      await deleteProject(id)
      await loadProjects()
    } catch (e) {
      alert(`Failed to delete project: ${e instanceof Error ? e.message : 'Unknown error'}`)
    }
  }

  if (loading && projects.length === 0) {
    return <div className="loading">Loading projects...</div>
  }

  return (
    <div>
      <div className="dashboard-header">
        <h1>Projects</h1>
      </div>

      {error && <div className="error">{error}</div>}

      {projects.length === 0 ? (
        <div className="no-changes">Place project folders in the directory configured in .env (PROJECTS_DIR).</div>
      ) : (
        <div className="projects-grid">
          {projects.map((project) => (
            <ProjectCard
              key={project.name}
              project={project}
              sessionRunning={sessionStatuses[project.name] ?? false}
              onOpen={() => navigate(`/project/${project.name}`)}
              onDelete={() => handleDeleteProject(project.name)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
