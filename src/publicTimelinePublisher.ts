// Публикует публичный timeline.json прямо из приложения (когда владелец работает),
// чтобы виджет на телефоне видел свежие статусы почти сразу, не дожидаясь
// планового воркфлоу. Пишет в ветку app-config публичного репозитория токеном
// владельца. Всё «мягко»: при отсутствии доступа/сети просто ничего не делает.

import type { Card, Member } from './types'
import { QUADRANT_COLOR } from './eisenhower'
import type { TLItem } from './timelineShare'

interface StoreLike {
  liveCards: () => Card[]
  members: Member[]
}

/** Снимок задач для таймлайна (все запланированные, только публичные поля). */
export function buildTimelineItems(store: StoreLike): TLItem[] {
  const byId = new Map(store.members.map((m) => [m.id, m]))
  return store
    .liveCards()
    .filter((c) => !!c.date)
    .map((c) => ({
      id: c.id,
      title: c.title,
      date: c.date!,
      ...(c.start ? { start: c.start } : {}),
      ...(c.durationMin ? { durationMin: c.durationMin } : {}),
      ...(c.kind ? { kind: c.kind } : {}),
      ...(c.done ? { done: true } : {}),
      ...(c.priority ? { priorityColor: QUADRANT_COLOR[c.priority] } : {}),
      members: c.assigneeIds
        .map((id) => byId.get(id))
        .filter((m): m is Member => !!m)
        .map((m) => ({ id: m.id, name: m.name, color: m.color })),
    }))
    .sort((a, b) => (a.date + (a.start ?? '')).localeCompare(b.date + (b.start ?? '')))
}

function repoCoords(): { owner: string; repo: string } {
  let owner = 'borinsobaka-lab'
  let repo = 'task-tracker'
  if (location.hostname.endsWith('.github.io')) {
    owner = location.hostname.split('.')[0] || owner
    const seg = location.pathname.split('/').filter(Boolean)[0]
    if (seg) repo = seg
  }
  return { owner, repo }
}

/** PUT timeline.json в app-config (best-effort). Возвращает true при успехе/без изменений. */
export async function publishTimeline(token: string, items: TLItem[]): Promise<boolean> {
  const { owner, repo } = repoCoords()
  const branch = 'app-config'
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/timeline.json`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  let sha: string | undefined
  let existing: string | null = null
  try {
    const r = await fetch(`${api}?ref=${branch}`, { headers, cache: 'no-store' })
    if (r.ok) {
      const f = await r.json()
      sha = f.sha
      try {
        const j = JSON.parse(decodeURIComponent(escape(atob(String(f.content).replace(/\s/g, '')))))
        existing = JSON.stringify(j.items)
      } catch {
        /* старый формат — перезапишем */
      }
    } else if (r.status !== 404) {
      return false // нет доступа — не спамим
    }
  } catch {
    return false
  }
  if (existing === JSON.stringify(items)) return true // ничего не изменилось
  const payload = { generatedAt: new Date().toISOString(), items }
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 2))))
  try {
    const r = await fetch(api, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Обновление таймлайна из приложения', content, branch, ...(sha ? { sha } : {}) }),
    })
    return r.ok
  } catch {
    return false
  }
}
