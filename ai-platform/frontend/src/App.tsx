import { Routes, Route, Link } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import ProjectPage from './pages/ProjectPage'

function App() {
  return (
    <div className="app">
      <nav className="navbar">
        <Link to="/" className="navbar-brand">AI Platform</Link>
        <div className="navbar-links">
          <Link to="/" className="nav-link">Projects</Link>
          <a href="http://localhost:6080" className="nav-link" target="_blank" rel="noopener noreferrer">noVNC</a>
        </div>
      </nav>
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/project/:id" element={<ProjectPage />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
