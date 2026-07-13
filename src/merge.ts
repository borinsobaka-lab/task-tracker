// Слияние двух версий доски (локальной и удалённой) без общей базовой версии.
// Стратегия: для каждой сущности побеждает более поздний updatedAt (LWW),
// удаления — через надгробия (deleted: true). После слияния доска нормализуется:
// каждая живая карточка лежит ровно в одной живой колонке.

import type { Attachment, BoardData, Card, ChecklistItem, Column, Comment, Member, ID, Series } from './types'
import { nowISO } from './utils'

const TOMBSTONE_TTL_MS = 45 * 24 * 60 * 60 * 1000

function newer<T extends { updatedAt: string }>(a: T, b: T): T {
  return a.updatedAt >= b.updatedAt ? a : b
}

/**
 * Слияние двух версий одной карточки. Скалярные поля (название, описание,
 * дата, исполнители) берём по LWW у более свежей карточки, но вложения и
 * пункты чек-листа сливаем как keyed-коллекции — иначе одновременная правка
 * двумя людьми (один отметил пункт, другой прикрепил файл) молча теряла бы
 * изменения проигравшей стороны.
 */
function mergeCard(a: Card, b: Card): Card {
  const base = newer(a, b)
  if (base.deleted) return base // надгробие — сливать нечего
  const other = base === a ? b : a
  return {
    ...base,
    checklist: mergeChecklist(base.checklist, other.checklist),
    attachments: mergeAttachments(base.attachments, other.attachments),
    comments: mergeComments(base.comments, other.comments),
  }
}

/**
 * Слияние комментариев двух версий карточки как keyed-коллекции: один и тот же
 * комментарий (по id) берём по более свежему updatedAt (правка/удаление-надгробие
 * побеждают старую версию), новые с любой из сторон — добавляем. Так одновременные
 * комментарии двух участников не теряются.
 */
function mergeComments(base: Comment[] | undefined, other: Comment[] | undefined): Comment[] | undefined {
  if (!base && !other) return undefined
  const b = base ?? []
  const o = other ?? []
  const otherById = new Map(o.map((c) => [c.id, c]))
  const result = b.map((bc) => {
    const oc = otherById.get(bc.id)
    if (!oc) return bc
    return oc.updatedAt > bc.updatedAt ? oc : bc
  })
  const baseIds = new Set(b.map((c) => c.id))
  for (const oc of o) if (!baseIds.has(oc.id)) result.push(oc)
  return result
}

function mergeChecklist(base: ChecklistItem[], other: ChecklistItem[]): ChecklistItem[] {
  const otherById = new Map(other.map((i) => [i.id, i]))
  const result = base.map((bi) => {
    const oi = otherById.get(bi.id)
    if (!oi) return bi
    // Один и тот же пункт правили с двух сторон — берём более свежий.
    return (oi.updatedAt ?? '') > (bi.updatedAt ?? '') ? oi : bi
  })
  const baseIds = new Set(base.map((i) => i.id))
  for (const oi of other) if (!baseIds.has(oi.id)) result.push(oi) // добавлен на другой стороне
  return result
}

function mergeAttachments(a: Attachment[], b: Attachment[]): Attachment[] {
  const byId = new Map<ID, Attachment>()
  for (const x of a) byId.set(x.id, x)
  for (const x of b) if (!byId.has(x.id)) byId.set(x.id, x) // вложения неизменяемы — объединяем
  return [...byId.values()]
}

function mergeById<T extends { id: ID; updatedAt: string }>(local: T[], remote: T[]): T[] {
  const remoteMap = new Map(remote.map((e) => [e.id, e]))
  const seen = new Set<ID>()
  const out: T[] = []
  for (const l of local) {
    const r = remoteMap.get(l.id)
    out.push(r ? newer(l, r) : l)
    seen.add(l.id)
  }
  for (const r of remote) {
    if (!seen.has(r.id)) out.push(r)
  }
  return out
}

export function mergeBoards(local: BoardData, remote: BoardData): BoardData {
  const members: Member[] = mergeById(local.members, remote.members)
  const columns: Column[] = mergeById(local.columns, remote.columns)

  const cards: Record<ID, Card> = {}
  const ids = new Set([...Object.keys(local.cards), ...Object.keys(remote.cards)])
  for (const id of ids) {
    const l = local.cards[id]
    const r = remote.cards[id]
    cards[id] = l && r ? mergeCard(l, r) : (l ?? r)
  }

  const series: Record<ID, Series> = {}
  const sids = new Set([...Object.keys(local.series ?? {}), ...Object.keys(remote.series ?? {})])
  for (const id of sids) {
    const l = local.series?.[id]
    const r = remote.series?.[id]
    series[id] = l && r ? newer(l, r) : (l ?? r)!
  }

  return normalizeBoard({
    schemaVersion: 1,
    members,
    columns,
    cards,
    series,
    updatedAt: local.updatedAt >= remote.updatedAt ? local.updatedAt : remote.updatedAt,
  })
}

/**
 * Восстанавливает инварианты доски:
 * - в cardIds колонок только живые существующие карточки, без дублей;
 * - при дублях карточка остаётся в колонке из card.columnId (или в первой встреченной);
 * - живые карточки, потерявшие колонку, добавляются в конец своей columnId
 *   (или первой живой колонки);
 * - card.columnId соответствует фактическому расположению;
 * - старые надгробия вычищаются.
 */
export function normalizeBoard(data: BoardData): BoardData {
  const liveColumns = data.columns.filter((c) => !c.deleted)
  const isLiveCard = (id: ID) => {
    const c = data.cards[id]
    return !!c && !c.deleted
  }

  // Где карточка встречается в cardIds
  const occurrences = new Map<ID, ID[]>()
  for (const col of liveColumns) {
    for (const cardId of col.cardIds) {
      if (!isLiveCard(cardId)) continue
      const list = occurrences.get(cardId) ?? []
      list.push(col.id)
      occurrences.set(cardId, list)
    }
  }

  // Выбираем для каждой карточки одну колонку
  const homeOf = new Map<ID, ID>()
  for (const [cardId, cols] of occurrences) {
    const preferred = data.cards[cardId].columnId
    homeOf.set(cardId, cols.includes(preferred) ? preferred : cols[0])
  }

  const columns: Column[] = data.columns.map((col) => {
    if (col.deleted) return { ...col, cardIds: [] }
    const cardIds = col.cardIds.filter((id) => isLiveCard(id) && homeOf.get(id) === col.id)
    return { ...col, cardIds }
  })

  // Потерянные живые карточки — возвращаем на доску.
  // Экземпляры повторяющихся задач (seriesId) на доске не живут — пропускаем.
  const placed = new Set(homeOf.keys())
  const liveColsAfter = columns.filter((c) => !c.deleted)
  for (const [id, card] of Object.entries(data.cards)) {
    if (card.deleted || card.seriesId || placed.has(id)) continue
    if (liveColsAfter.length === 0) continue
    const target = liveColsAfter.find((c) => c.id === card.columnId) ?? liveColsAfter[0]
    target.cardIds = [...target.cardIds, id]
    homeOf.set(id, target.id)
  }

  // Чистка старых надгробий и выравнивание columnId
  const cutoff = Date.now() - TOMBSTONE_TTL_MS
  const cards: Record<ID, Card> = {}
  for (const [id, card] of Object.entries(data.cards)) {
    if (card.deleted) {
      const t = Date.parse(card.updatedAt)
      if (!Number.isNaN(t) && t < cutoff) continue // выкидываем окончательно
      cards[id] = card
      continue
    }
    const home = homeOf.get(id)
    cards[id] = home && home !== card.columnId ? { ...card, columnId: home } : card
  }

  const keptColumns = columns.filter((col) => {
    if (!col.deleted) return true
    const t = Date.parse(col.updatedAt)
    return Number.isNaN(t) || t >= cutoff
  })

  const series: Record<ID, Series> = {}
  for (const [id, s] of Object.entries(data.series ?? {})) {
    if (s.deleted) {
      const t = Date.parse(s.updatedAt)
      if (!Number.isNaN(t) && t < cutoff) continue // старое надгробие серии — выкидываем
    }
    series[id] = s
  }

  const result = { ...data, columns: keptColumns, cards, series }
  // Журнал истории проекта убран из приложения — вычищаем его из старых данных,
  // чтобы не хранить и не тащить при загрузке.
  delete (result as { activity?: unknown }).activity
  return result
}

export function emptyBoard(): BoardData {
  const ts = nowISO()
  const mk = (id: string, title: string, role: Column['role']): Column => ({
    id,
    title,
    cardIds: [],
    role,
    createdAt: ts,
    updatedAt: ts,
  })
  return {
    schemaVersion: 1,
    members: [],
    columns: [
      mk('col-todo', 'Нужно сделать', 'todo'),
      mk('col-doing', 'В работе', 'doing'),
      mk('col-review', 'Проверка', 'review'),
      mk('col-done', 'Готово', 'done'),
    ],
    cards: {},
    series: {},
    updatedAt: ts,
  }
}
