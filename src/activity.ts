// Журнал истории проекта: добавление событий с лёгкой коалесценцией
// (подряд идущие однотипные правки одной задачи одним автором не плодят записи).

import type { ActivityEntry, ActivityKind, BoardData, ID, Member } from './types'
import { nowISO, uid } from './utils'

const MAX_ACTIVITY = 500
const COALESCE_WINDOW_MS = 10 * 60 * 1000

// Правки, которые схлопываем при повторе (печатание названия, описания и т.п.)
const COALESCE: Set<ActivityKind> = new Set(['card.rename', 'card.describe', 'card.schedule', 'card.assign'])

export function logActivity(
  d: BoardData,
  actor: Member | null,
  kind: ActivityKind,
  opts: { cardId?: ID; cardTitle?: string; detail?: string } = {},
): void {
  if (!d.activity) d.activity = []
  const ts = nowISO()
  const last = d.activity[d.activity.length - 1]
  if (
    last &&
    COALESCE.has(kind) &&
    last.kind === kind &&
    last.cardId === opts.cardId &&
    last.actorId === (actor?.id ?? undefined) &&
    Date.parse(ts) - Date.parse(last.ts) < COALESCE_WINDOW_MS
  ) {
    last.ts = ts
    if (opts.detail !== undefined) last.detail = opts.detail
    if (opts.cardTitle !== undefined) last.cardTitle = opts.cardTitle
    return
  }
  d.activity.push({
    id: uid(),
    ts,
    ...(actor ? { actorId: actor.id } : {}),
    actorName: actor?.name ?? 'Кто-то',
    kind,
    ...opts,
  })
  if (d.activity.length > MAX_ACTIVITY) d.activity.splice(0, d.activity.length - MAX_ACTIVITY)
}
