import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { initTheme } from './lib/theme'
import Root from './Root.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'

initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary><Root /></ErrorBoundary>
  </StrictMode>,
)
