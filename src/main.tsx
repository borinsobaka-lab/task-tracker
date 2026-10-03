import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { preloadBoardCache } from './boardCache'
import { reloadOnStaleChunks, setupServiceWorker } from './pwa'
import './styles.css'

// Копию доски с устройства начинаем читать сразу — параллельно с запуском React
preloadBoardCache()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// PWA: service worker (только в проде — в dev мешает HMR)
if (import.meta.env.PROD) {
  reloadOnStaleChunks()
  setupServiceWorker()
}
