// Копия доски на устройстве (IndexedDB). При запуске приложение сразу
// показывает последние известные данные, а свежие догружает с GitHub в фоне —
// открытие PWA не ждёт сети. Пишется только подтверждённое сервером состояние
// (после загрузки/сохранения), поэтому копия никогда не «опережает» сервер.

import type { BoardData } from './types'

export interface CachedBoard {
  /** Какое хранилище (репозиторий/ветка) — чужую копию не показываем */
  key: string
  data: BoardData
  rev: string
  etag?: string
  savedAt: number
}

const DB_NAME = 'tt-cache'
const STORE = 'kv'
const SLOT = 'board'
/** IndexedDB изредка «зависает» (известные баги iOS) — дольше не ждём, идём в сеть */
const READ_TIMEOUT_MS = 1500

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1)
        req.onupgradeneeded = () => req.result.createObjectStore(STORE)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => resolve(null)
        req.onblocked = () => resolve(null)
      } catch {
        resolve(null) // нет IndexedDB (приватный режим старых браузеров и т.п.)
      }
    })
  }
  return dbPromise
}

function readSlot(): Promise<CachedBoard | null> {
  const read = openDb().then(
    (db) =>
      new Promise<CachedBoard | null>((resolve) => {
        if (!db) return resolve(null)
        try {
          const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(SLOT)
          req.onsuccess = () => resolve((req.result as CachedBoard | undefined) ?? null)
          req.onerror = () => resolve(null)
        } catch {
          resolve(null)
        }
      }),
  )
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), READ_TIMEOUT_MS))
  return Promise.race([read, timeout])
}

let early: Promise<CachedBoard | null> | null = null

/** Начать чтение копии как можно раньше (main.tsx) — параллельно с запуском React */
export function preloadBoardCache(): void {
  if (!early) early = readSlot()
}

/** Копия доски для хранилища key (или null) */
export async function readBoardCache(key: string): Promise<CachedBoard | null> {
  const p = early ?? readSlot()
  early = null
  const c = await p
  return c && c.key === key && c.data && c.rev ? c : null
}

let pending: CachedBoard | null = null
let timer: ReturnType<typeof setTimeout> | null = null

/** Запомнить подтверждённое сервером состояние (пишем с задержкой, последнее побеждает) */
export function writeBoardCache(entry: Omit<CachedBoard, 'savedAt'>): void {
  pending = { ...entry, savedAt: Date.now() }
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    void flushBoardCache()
  }, 800)
}

/** Записать отложенное сейчас (уход приложения в фон) */
export async function flushBoardCache(): Promise<void> {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  const entry = pending
  pending = null
  if (!entry) return
  const db = await openDb()
  if (!db) return
  try {
    db.transaction(STORE, 'readwrite').objectStore(STORE).put(entry, SLOT)
  } catch {
    /* нет места и т.п. — это только ускорение запуска */
  }
}

/** Выход из аккаунта: копию данных с устройства убираем */
export async function clearBoardCache(): Promise<void> {
  pending = null
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  const db = await openDb()
  if (!db) return
  try {
    db.transaction(STORE, 'readwrite').objectStore(STORE).delete(SLOT)
  } catch {
    /* ignore */
  }
}
