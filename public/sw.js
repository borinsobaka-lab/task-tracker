// Service worker для PWA. Кэширует только статичную оболочку приложения
// (тот же origin, GitHub Pages). Запросы к GitHub API (другой origin) НЕ
// трогаются — чтобы не отдавать устаревшие данные задач.

const CACHE = 'tt-shell-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)

  // Только GET и только свой origin (Pages). Всё остальное — как обычно.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return

  // Хэшированные ассеты (immutable) — cache-first
  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(req)
        if (hit) return hit
        const res = await fetch(req)
        if (res.ok) cache.put(req, res.clone())
        return res
      }),
    )
    return
  }

  // Навигация и прочая статика — network-first, офлайн-фолбэк из кэша
  event.respondWith(
    (async () => {
      try {
        const res = await fetch(req)
        if (res.ok) {
          const cache = await caches.open(CACHE)
          cache.put(req, res.clone())
        }
        return res
      } catch {
        const cache = await caches.open(CACHE)
        const hit = (await cache.match(req)) || (await cache.match('/task-tracker/'))
        return hit || Response.error()
      }
    })(),
  )
})
