import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './lib/monacoSetup' // configure Monaco to use the bundled (non-CDN) build
// ContextHub Living Feed editorial faces (self-hosted → satisfies CSP font-src 'self').
import '@fontsource/bricolage-grotesque/400.css'
import '@fontsource/bricolage-grotesque/700.css'
import '@fontsource/fraunces/400.css'
import '@fontsource/fraunces/600.css'
import '@fontsource/archivo/500.css'
import '@fontsource/hanken-grotesk/400.css'
import '@fontsource/hanken-grotesk/600.css'
import '@fontsource/jetbrains-mono/400.css'
import './styles/global.css'
// Redesign token LAYER — variables + a few opt-in base classes (.wos*). Loaded
// after global.css so tokens can reference/override, but it restyles nothing
// existing (see styles/tokens.css). Only the new shell opts in via `.wos`.
import './styles/tokens.css'

// Light is the default theme for the office/executive audience; persisted choice wins.
const savedTheme = localStorage.getItem('workspace-os:theme') ?? 'light'
document.documentElement.setAttribute('data-theme', savedTheme)

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
