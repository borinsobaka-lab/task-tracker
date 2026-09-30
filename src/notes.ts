// Помощники раздела «Заметки»: группировка по датам (как в Apple Notes),
// текстовое превью, подготовка картинок и кэш содержимого вложений.

import { useSyncExternalStore } from 'react'
import type { Attachment, Note } from './types'
import { plainSnippet } from './utils'

/** Раздел заметок, его цвет и максимальный размер вложения (как у задач) */
export const NOTES_COLOR = '#eab308'
export const NOTE_MAX_FILE_SIZE = 15 * 1024 * 1024

// ---------- Список ----------

const MONTH_FMT = new Intl.DateTimeFormat('ru-RU', { month: 'long' })
const TIME_FMT = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })
const WEEKDAY_FMT = new Intl.DateTimeFormat('ru-RU', { weekday: 'long' })
const SHORT_DATE_FMT = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
const LONG_FMT = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })

function dayStart(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}
const DAY = 24 * 60 * 60 * 1000

/** Группа списка по дате изменения: «Сегодня», «Вчера», «Предыдущие 7 дней», «Предыдущие 30 дней», месяц, год. */
export function noteGroupLabel(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const diff = Math.round((dayStart(now) - dayStart(d)) / DAY)
  if (diff <= 0) return 'Сегодня'
  if (diff === 1) return 'Вчера'
  if (diff < 7) return 'Предыдущие 7 дней'
  if (diff < 30) return 'Предыдущие 30 дней'
  if (d.getFullYear() === now.getFullYear()) {
    const m = MONTH_FMT.format(d)
    return m.charAt(0).toUpperCase() + m.slice(1)
  }
  return String(d.getFullYear())
}

/** Короткая дата в строке списка: время — сегодня, «Вчера», день недели — на этой неделе, иначе 30.09.26. */
export function noteShortDate(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const diff = Math.round((dayStart(now) - dayStart(d)) / DAY)
  if (diff <= 0) return TIME_FMT.format(d)
  if (diff === 1) return 'Вчера'
  if (diff < 7) return WEEKDAY_FMT.format(d)
  return SHORT_DATE_FMT.format(d)
}

/** «30 сентября 2026 г. в 22:10» — над текстом открытой заметки */
export function noteLongDate(iso: string): string {
  const d = new Date(iso)
  return `${LONG_FMT.format(d)} в ${TIME_FMT.format(d)}`
}

/** Название для списка: своё или первая строка текста (как в Apple Notes) */
export function noteDisplayTitle(note: Note): string {
  const t = note.title.trim()
  if (t) return t
  return plainSnippet(firstBlock(note.html), 60) || 'Новая заметка'
}

/** Превью текста для второй строки списка */
export function notePreview(note: Note): string {
  const html = note.title.trim() ? note.html : note.html.replace(firstBlockRe, '')
  const text = plainSnippet(html.replace(/<div data-note-att[^>]*><\/div>/g, ' '), 120)
  if (text) return text
  const files = note.attachments.length
  if (files) return files === 1 ? '1 вложение' : `Вложений: ${files}`
  return 'Нет дополнительного текста'
}

const firstBlockRe = /^\s*<(p|h2|h3|li|blockquote)[^>]*>.*?<\/\1>/s
function firstBlock(html: string): string {
  const m = html.match(/<(p|h2|h3|li)[^>]*>(.*?)<\/\1>/s)
  return m ? m[2] : ''
}

/** Первая картинка заметки (в порядке появления в тексте) — миниатюра в списке */
export function noteThumb(note: Note): string | undefined {
  const byId = new Map(note.attachments.map((a) => [a.id, a]))
  for (const m of note.html.matchAll(/data-note-att="([^"]+)"/g)) {
    const a = byId.get(m[1])
    if (a?.thumb) return a.thumb
  }
  return undefined
}

export function noteMatchesQuery(note: Note, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const hay = (note.title + ' ' + note.html.replace(/<[^>]*>/g, ' ') + ' ' + note.attachments.map((a) => a.name).join(' ')).toLowerCase()
  return hay.includes(q)
}

export function isImageMime(mime: string): boolean {
  return /^image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml)$/i.test(mime)
}

// ---------- Подготовка картинок ----------

const MAX_SIDE = 2560 // фото с телефона больше этого уменьшаем — быстрее грузится и меньше места
const THUMB_SIDE = 120

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Не удалось открыть изображение'))
    }
    img.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

/**
 * Готовит картинку к загрузке: уменьшает слишком большие фото (JPEG/WebP/PNG),
 * снимает крошечную миниатюру для списка и размеры (чтобы заранее занять место).
 * Для прочих файлов (и если что-то пошло не так) возвращает файл как есть.
 */
export async function prepareNoteFile(file: File): Promise<{ file: File; thumb?: string; w?: number; h?: number }> {
  if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) return { file }
  try {
    const img = await loadImage(file)
    let w = img.naturalWidth
    let h = img.naturalHeight
    let out = file
    if (Math.max(w, h) > MAX_SIDE) {
      const k = MAX_SIDE / Math.max(w, h)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(w * k)
      canvas.height = Math.round(h * k)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      const type = /png/i.test(file.type) ? 'image/png' : 'image/jpeg'
      const blob = await canvasToBlob(canvas, type, 0.86)
      if (blob && blob.size < file.size) {
        const name = type === 'image/jpeg' ? file.name.replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg' : file.name
        out = new File([blob], name, { type })
        w = canvas.width
        h = canvas.height
      }
    }
    // Миниатюра-квадрат (обрезка по центру) для строки списка
    const t = document.createElement('canvas')
    t.width = THUMB_SIDE
    t.height = THUMB_SIDE
    const ctx = t.getContext('2d')!
    const s = Math.max(THUMB_SIDE / img.naturalWidth, THUMB_SIDE / img.naturalHeight)
    const tw = img.naturalWidth * s
    const th = img.naturalHeight * s
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, THUMB_SIDE, THUMB_SIDE)
    ctx.drawImage(img, (THUMB_SIDE - tw) / 2, (THUMB_SIDE - th) / 2, tw, th)
    return { file: out, thumb: t.toDataURL('image/jpeg', 0.6), w, h }
  } catch {
    return { file }
  }
}

// ---------- Загрузки в процессе и кэш содержимого ----------

/** Вложения, которые сейчас загружаются: id → локальная ссылка на файл (для мгновенного показа). */
const pending = new Map<string, { url: string; failed?: boolean }>()
const pendingListeners = new Set<() => void>()
let pendingVersion = 0
function emitPending() {
  pendingVersion++
  for (const fn of pendingListeners) fn()
}

export function addPendingUpload(id: string, file: File): void {
  const url = URL.createObjectURL(file)
  pending.set(id, { url })
  urlCache.set(id, Promise.resolve(url)) // после загрузки не скачиваем заново
  emitPending()
}
export function finishPendingUpload(id: string, failed = false): void {
  const p = pending.get(id)
  if (!p) return
  if (failed) {
    pending.set(id, { ...p, failed: true })
    urlCache.delete(id)
  } else pending.delete(id)
  emitPending()
}

export function usePendingUpload(id: string): { url: string; failed?: boolean } | undefined {
  useSyncExternalStore(
    (fn) => {
      pendingListeners.add(fn)
      return () => pendingListeners.delete(fn)
    },
    () => pendingVersion,
  )
  return pending.get(id)
}

/** Ссылки (object URL) на скачанное содержимое вложений — по id, чтобы не качать повторно */
const urlCache = new Map<string, Promise<string>>()

export function attachmentUrl(att: Attachment, load: (att: Attachment) => Promise<Blob>): Promise<string> {
  let p = urlCache.get(att.id)
  if (!p) {
    p = load(att).then((blob) => URL.createObjectURL(new Blob([blob], { type: att.mime })))
    p.catch(() => urlCache.delete(att.id))
    urlCache.set(att.id, p)
  }
  return p
}
