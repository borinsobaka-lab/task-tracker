// Регистрация service worker (мгновенный запуск PWA из кэша) и тихое обновление:
// новая версия скачивается в фоне, а включается, когда приложение свёрнуто и
// ничего не потеряется (нет несохранённых правок, открытых карточек и форм).

import { hasUnsavedChanges } from './store'

/** Версия этой сборки — её пишет в index.html плагин в vite.config.ts */
const BUILD = document.querySelector<HTMLMetaElement>('meta[name="tt-build"]')?.content ?? ''
/** Как часто проверять обновление, пока приложение долго открыто (в фоне/на экране) */
const UPDATE_CHECK_MS = 30 * 60 * 1000

export function setupServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return
  let updateReady = false
  navigator.serviceWorker.addEventListener('message', (e) => {
    const msg = e.data as { type?: string; version?: string } | null
    if (msg?.type === 'tt-sw-activated' && msg.version && msg.version !== BUILD) updateReady = true
  })

  const register = () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then((reg) => {
        let lastCheck = Date.now()
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden') {
            if (updateReady && safeToReload()) location.reload()
          } else if (Date.now() - lastCheck > UPDATE_CHECK_MS) {
            lastCheck = Date.now()
            reg.update().catch(() => {})
          }
        })
      })
      .catch(() => {})
  }
  // Первый визит: регистрируем после загрузки, чтобы скачивание оболочки не
  // мешало первому показу. Дальше SW уже установлен, и это ничего не стоит.
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
}

/** Можно ли перезагрузить незаметно: нет несохранённого, открытых окон и ввода */
function safeToReload(): boolean {
  if (hasUnsavedChanges()) return false
  const a = document.activeElement as HTMLElement | null
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return false
  return !document.querySelector('[role="dialog"], .modal-overlay, .qa-overlay, .notes-has-open')
}

/** Чанк не загрузился (вышла новая версия, старых файлов уже нет) — один раз перезагружаемся */
export function reloadOnStaleChunks(): void {
  window.addEventListener('vite:preloadError', (e) => {
    try {
      const key = 'tt.chunkReload'
      const last = Number(sessionStorage.getItem(key) || 0)
      if (Date.now() - last < 30_000) return // уже пробовали — пусть покажет ошибку
      sessionStorage.setItem(key, String(Date.now()))
    } catch {
      return
    }
    e.preventDefault()
    location.reload()
  })
}
