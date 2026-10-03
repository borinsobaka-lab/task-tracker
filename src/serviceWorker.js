// Service worker PWA «Задачи». Главная цель — мгновенный запуск с иконки:
//  • при установке скачивает всю оболочку приложения (index.html, JS, CSS,
//    иконки) в кэш своей версии;
//  • запуск (навигация) отвечает index.html из кэша сразу, не дожидаясь сети;
//  • файлы с хэшем в имени (assets/) — из кэша; новая версия скачивается в
//    фоне и включается со следующего открытия приложения.
// Данные задач (GitHub API, другой origin) не трогаются — они всегда свежие.
//
// Шаблон: при сборке плагин в vite.config.ts подставляет версию и список файлов
// и кладёт результат в dist/sw.js.

const VERSION = '__TT_VERSION__'
/** Пути относительно scope (…/task-tracker/) */
const PRECACHE = __TT_PRECACHE__

const PREFIX = 'tt-shell-'
const CACHE = PREFIX + VERSION
const SCOPE = self.registration.scope // https://…/task-tracker/
const SHELL = SCOPE // index.html храним под адресом start_url

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      // index.html — мимо HTTP-кэша, и убеждаемся, что это ровно наша версия
      // (CDN мог ещё отдавать прошлую) — иначе установка повторится позже.
      const res = await fetch(new Request(SHELL, { cache: 'reload' }))
      if (!res.ok) throw new Error(`index.html: ${res.status}`)
      const html = await res.clone().text()
      if (!html.includes(VERSION)) throw new Error('index.html ещё прошлой версии')
      await cache.put(SHELL, res)
      await Promise.all(
        PRECACHE.map(async (path) => {
          const url = new URL(path, SCOPE).href
          const hashed = path.startsWith('assets/')
          // Файлы с хэшем не меняются: берём из прошлых версий, если уже есть
          const old = hashed ? await caches.match(url) : undefined
          if (old) return cache.put(url, old)
          const r = await fetch(new Request(url, { cache: hashed ? 'default' : 'reload' }))
          if (!r.ok) throw new Error(`${path}: ${r.status}`)
          await cache.put(url, r)
        }),
      )
      // Не ждём закрытия старых вкладок: открытое приложение доработает на своих
      // файлах (кэш прошлой версии сохраняем), а следующее открытие — уже новая.
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Удаляем старые версии, кроме предыдущей: запущенное с неё приложение
      // может ещё догружать свои чанки (разделы, карточку задачи).
      const old = (await caches.keys()).filter((n) => n.startsWith(PREFIX) && n !== CACHE)
      const keep = old[old.length - 1] // keys() — в порядке создания
      await Promise.all(old.filter((n) => n !== keep).map((n) => caches.delete(n)))
      await self.clients.claim()
      // Сообщаем открытым окнам: новая версия готова (обновятся, когда свернут приложение)
      for (const client of await self.clients.matchAll({ type: 'window' })) {
        client.postMessage({ type: 'tt-sw-activated', version: VERSION })
      }
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (!url.href.startsWith(SCOPE)) return // другой origin (GitHub API и т.п.) — как обычно

  const path = url.pathname.slice(new URL(SCOPE).pathname.length)

  // Запуск приложения (с иконки, по ссылке, ?demo=1, #card=…) — index.html из кэша
  if (req.mode === 'navigate' && (path === '' || path === 'index.html')) {
    event.respondWith(
      (async () => {
        const hit = await (await caches.open(CACHE)).match(SHELL)
        if (hit) return hit
        try {
          return await fetch(req)
        } catch {
          return (await caches.match(SHELL)) || Response.error()
        }
      })(),
    )
    return
  }

  // Файлы с хэшем — из любого кэша (содержимое неизменно), иначе из сети с докладкой в кэш
  if (path.startsWith('assets/')) {
    event.respondWith(
      (async () => {
        const hit = await caches.match(req)
        if (hit) return hit
        const res = await fetch(req)
        if (res.ok) (await caches.open(CACHE)).put(req, res.clone())
        return res
      })(),
    )
    return
  }

  // Иконки, манифест — из кэша текущей версии; прочее — сеть как обычно
  if (PRECACHE.includes(path)) {
    event.respondWith(
      (async () => (await (await caches.open(CACHE)).match(req)) || fetch(req))(),
    )
  }
})
