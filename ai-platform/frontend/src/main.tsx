import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ToastProvider } from './components/Toast'
import { ClaudeEventsProvider } from './components/ClaudeEvents'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <ClaudeEventsProvider>
          <App />
        </ClaudeEventsProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>
)
