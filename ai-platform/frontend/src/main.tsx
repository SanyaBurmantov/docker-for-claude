import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ToastProvider } from './components/Toast'
import { ClaudeEventsProvider } from './components/ClaudeEvents'
import { LanguageProvider } from './i18n'
import { AppearanceProvider } from './appearance'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <LanguageProvider>
        <AppearanceProvider>
          <ToastProvider>
            <ClaudeEventsProvider>
              <App />
            </ClaudeEventsProvider>
          </ToastProvider>
        </AppearanceProvider>
      </LanguageProvider>
    </BrowserRouter>
  </React.StrictMode>
)
