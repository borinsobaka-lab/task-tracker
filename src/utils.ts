// Общие утилиты: идентификаторы, даты, base64, форматирование.

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'id-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export function nowISO(): string {
  return new Date().toISOString()
}

// ---------- Даты (локальные, без таймзон) ----------

/** Date -> 'YYYY-MM-DD' в локальном времени */
export function toDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 'YYYY-MM-DD' -> Date (локальная полночь) */
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Понедельник недели, в которую входит дата */
export function startOfWeek(d: Date): Date {
  const res = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dow = (res.getDay() + 6) % 7 // 0 = понедельник
  res.setDate(res.getDate() - dow)
  return res
}

export function addDays(d: Date, days: number): Date {
  const res = new Date(d)
  res.setDate(res.getDate() + days)
  return res
}

const DAY_FMT = new Intl.DateTimeFormat('ru-RU', { weekday: 'short' })
const DATE_FMT = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' })
const FULL_FMT = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })

export function fmtWeekday(d: Date): string {
  return DAY_FMT.format(d)
}
export function fmtDayMonth(d: Date): string {
  return DATE_FMT.format(d).replace('.', '')
}
export function fmtFullDate(d: Date): string {
  return FULL_FMT.format(d)
}

/** 'HH:MM' -> минуты от полуночи */
export function timeToMin(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

/** минуты от полуночи -> 'HH:MM' */
export function minToTime(min: number): string {
  const m = Math.max(0, Math.min(24 * 60 - 5, Math.round(min)))
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

// ---------- Участники ----------

export const MEMBER_COLORS = [
  '#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#84cc16',
]

/** Фиксированный цвет встреч в календаре — чтобы отличать их от задач. */
export const MEETING_COLOR = '#7c3aed'

// ---------- Палитра для цвета колонок (полоска сверху подложки на доске) ----------

/** ~50 оттенков: по 5 тонов в каждом семействе + нейтральные. */
export const COLUMN_COLORS = [
  // красные / розовые
  '#fecaca', '#f87171', '#ef4444', '#dc2626', '#b91c1c',
  '#fbcfe8', '#f472b6', '#ec4899', '#db2777', '#be185d',
  // оранжевые / янтарные
  '#fed7aa', '#fb923c', '#f97316', '#ea580c', '#c2410c',
  '#fde68a', '#fbbf24', '#f59e0b', '#d97706', '#b45309',
  // жёлтые / лаймовые
  '#fef08a', '#facc15', '#eab308', '#ca8a04', '#a16207',
  '#d9f99d', '#a3e635', '#84cc16', '#65a30d', '#4d7c0f',
  // зелёные / изумрудные
  '#bbf7d0', '#4ade80', '#22c55e', '#16a34a', '#15803d',
  '#a7f3d0', '#34d399', '#10b981', '#059669', '#047857',
  // бирюзовые / голубые
  '#99f6e4', '#2dd4bf', '#14b8a6', '#0d9488', '#0f766e',
  '#a5f3fc', '#22d3ee', '#06b6d4', '#0891b2', '#0e7490',
  // синие / голубые
  '#bae6fd', '#38bdf8', '#0ea5e9', '#2563eb', '#1d4ed8',
  '#c7d2fe', '#818cf8', '#6366f1', '#4f46e5', '#4338ca',
  // фиолетовые / пурпурные
  '#ddd6fe', '#a78bfa', '#8b5cf6', '#7c3aed', '#6d28d9',
  '#f5d0fe', '#e879f9', '#c026d3', '#a21caf', '#86198f',
  // нейтральные
  '#e2e8f0', '#94a3b8', '#64748b', '#475569', '#334155',
  '#e7e5e4', '#a8a29e', '#78716c', '#57534e', '#44403c',
]

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

// ---------- base64 (unicode-безопасно) ----------

export function b64EncodeUtf8(str: string): string {
  const bytes = new TextEncoder().encode(str)
  return bytesToBase64(bytes)
}

export function b64DecodeUtf8(b64: string): string {
  const clean = b64.replace(/\s/g, '')
  const bin = atob(clean)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

export async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  return bytesToBase64(new Uint8Array(buf))
}

// ---------- Форматирование ----------

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} Б`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} КБ`
  return `${(n / 1024 / 1024).toFixed(1)} МБ`
}

/**
 * Есть ли в описании видимое содержимое. Вызывается при отрисовке каждой
 * карточки доски, поэтому без DOMParser — быстрый разбор регуляркой.
 */
export function hasContent(html: string): boolean {
  if (!html) return false
  const stripped = html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, 'x')
  if (stripped.trim().length > 0) return true
  // Медиа без текста (картинка, разделитель и т.п.) тоже считается содержимым
  return /<(img|video|iframe|hr)\b/i.test(html)
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 80) || 'file'
}
