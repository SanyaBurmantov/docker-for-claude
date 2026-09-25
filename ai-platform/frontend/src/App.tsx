import { Routes, Route, Link, useLocation } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import ProjectPage from './pages/ProjectPage'
import VoiceCoachPage from './pages/VoiceCoachPage'
import VoiceHelperOverlay from './pages/VoiceHelperOverlay'
import ChatPanel from './components/ChatPanel'
import Clock from './components/Clock'
import SoundToggle from './components/SoundToggle'
import LanguageSelector from './components/LanguageSelector'
import SiteFooter from './components/SiteFooter'
import { novncUrl } from './services/api'
import { useLanguage } from './i18n'

function App() {
  const location = useLocation()
  const { t } = useLanguage()

  // The desktop companion loads this route into a small frameless always-on-top
  // window, so it must not inherit the platform navbar, drawers or footer.
  if (location.pathname === '/vc/overlay') return <VoiceHelperOverlay />

  return (
    <div className="app">
      <nav className="navbar">
        <Link to="/" className="navbar-brand">AI Platform</Link>
        <div className="navbar-links">
          <Link to="/" className="nav-link">{t('nav.projects')}</Link>
          <a href={novncUrl()} className="nav-link" target="_blank" rel="noopener noreferrer">noVNC</a>
          <Link to="/vc" className="nav-link">VC</Link>
          <SoundToggle />
          <LanguageSelector />
          <Clock />
        </div>
      </nav>
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/project/:id" element={<ProjectPage />} />
          <Route path="/vc" element={<VoiceCoachPage />} />
        </Routes>
      </main>
      <ChatPanel />
      <SiteFooter />
    </div>
  )
}

export default App
