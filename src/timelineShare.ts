// Данные и кодирование ссылки на публичный (только для просмотра) таймлайн.
// Ссылка самодостаточна: снимок задач кладётся прямо в hash — без бэкенда,
// без доступа к приватным данным. Любой, у кого есть ссылка, видит таймлайн,
// но ничего не может нажимать/редактировать.

export interface TLMember {
  name: string
  color: string
}

/** Минимальный снимок задачи для таймлайна (без приватных полей вроде описания). */
export interface TLItem {
  id: string
  title: string
  date: string
  start?: string
  durationMin?: number
  kind?: string // 'meeting' — встреча
  done?: boolean
  priorityColor?: string
  members: TLMember[]
}

const PREFIX = '#tl='

/** UTF-8-safe base64 в hash. */
export function buildTimelineUrl(items: TLItem[]): string {
  const json = JSON.stringify(items)
  const b64 = btoa(unescape(encodeURIComponent(json)))
  return `${location.origin}${location.pathname}${PREFIX}${encodeURIComponent(b64)}`
}

/** Достаёт снимок из hash или возвращает null, если это не ссылка-таймлайн. */
export function parseTimelineHash(hash: string): TLItem[] | null {
  if (!hash.startsWith(PREFIX)) return null
  try {
    const b64 = decodeURIComponent(hash.slice(PREFIX.length))
    const json = decodeURIComponent(escape(atob(b64)))
    const data = JSON.parse(json)
    return Array.isArray(data) ? (data as TLItem[]) : null
  } catch {
    return null
  }
}
