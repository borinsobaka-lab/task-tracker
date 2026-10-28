// Слияние двух версий доски (локальной и удалённой) без общей базовой версии.
// Стратегия: для каждой сущности побеждает более поздний updatedAt (LWW),
// удаления — через надгробия (deleted: true). После слияния доска нормализуется:
// каждая живая карточка лежит ровно в одной живой колонке.

import type { Attachment, BoardData, Card, ChecklistItem, Column, Comment, CrmData, CustomBoard, Deal, Member, ID, Note, Project, Series } from './types'
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
    ...mergeAttachments(base, other),
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

/** Слияние двух версий заметки: текст — по LWW, вложения объединяем (как у карточек). */
function mergeNote(a: Note, b: Note): Note {
  const base = newer(a, b)
  if (base.deleted) return base
  const other = base === a ? b : a
  return { ...base, ...mergeAttachments(base, other) }
}

type WithAttachments = { attachments: Attachment[]; removedAttachmentIds?: ID[] }

/** Вложения неизменяемы — объединяем обе стороны, кроме удалённых хоть на одной
 *  из них (надгробия removedAttachmentIds тоже объединяем). */
function mergeAttachments(a: WithAttachments, b: WithAttachments): WithAttachments {
  const removed = new Set([...(a.removedAttachmentIds ?? []), ...(b.removedAttachmentIds ?? [])])
  const byId = new Map<ID, Attachment>()
  for (const x of a.attachments) byId.set(x.id, x)
  for (const x of b.attachments) if (!byId.has(x.id)) byId.set(x.id, x)
  for (const id of removed) byId.delete(id)
  return {
    attachments: [...byId.values()],
    ...(removed.size ? { removedAttachmentIds: [...removed] } : {}),
  }
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

/** Слияние двух словарей сущностей по id: одна и та же — по более свежему updatedAt (LWW)
 *  или своей функцией слияния двух версий. */
function mergeRecords<T extends { updatedAt: string }>(
  a: Record<ID, T> | undefined,
  b: Record<ID, T> | undefined,
  merge: (l: T, r: T) => T = newer,
): Record<ID, T> {
  const out: Record<ID, T> = {}
  for (const id of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
    const l = a?.[id]
    const r = b?.[id]
    out[id] = l && r ? merge(l, r) : (l ?? r)!
  }
  return out
}

/** Сделка: поля — по LWW, комментарии сливаем по id (как у карточек), чтобы
 *  одновременные сообщения двух участников не терялись. */
function mergeDeal(a: Deal, b: Deal): Deal {
  const base = newer(a, b)
  if (base.deleted) return base
  const other = base === a ? b : a
  const comments = mergeComments(base.comments, other.comments)
  return comments ? { ...base, comments } : base
}

/** CRM: сделки, записи истории, компании и контакты сливаются независимо, каждая — по LWW. */
function mergeCrm(a: CrmData | undefined, b: CrmData | undefined): CrmData | undefined {
  if (!a && !b) return undefined
  return {
    deals: mergeRecords(a?.deals, b?.deals, mergeDeal),
    records: mergeRecords(a?.records, b?.records),
    partners: mergeRecords(a?.partners, b?.partners),
    ...(a?.contacts || b?.contacts ? { contacts: mergeRecords(a?.contacts, b?.contacts) } : {}),
  }
}

export function mergeBoards(local: BoardData, remote: BoardData): BoardData {
  const members: Member[] = mergeById(local.members, remote.members)
  const columns: Column[] = mergeById(local.columns, remote.columns)
  const projects: Project[] = mergeById(local.projects ?? [], remote.projects ?? [])
  const boards: CustomBoard[] = mergeById(local.boards ?? [], remote.boards ?? [])

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

  const notes: Record<ID, Note> = {}
  const nids = new Set([...Object.keys(local.notes ?? {}), ...Object.keys(remote.notes ?? {})])
  for (const id of nids) {
    const l = local.notes?.[id]
    const r = remote.notes?.[id]
    notes[id] = l && r ? mergeNote(l, r) : (l ?? r)!
  }

  return normalizeBoard({
    schemaVersion: 1,
    members,
    columns,
    cards,
    series,
    projects,
    ...((local.boards || remote.boards) ? { boards } : {}),
    notes,
    ...((local.crm || remote.crm) ? { crm: mergeCrm(local.crm, remote.crm) } : {}),
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
export function normalizeBoard(input: BoardData): BoardData {
  const data = foldBoardColumns(input)
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

  const notes: Record<ID, Note> = {}
  for (const [id, n] of Object.entries(data.notes ?? {})) {
    if (n.deleted) {
      const t = Date.parse(n.updatedAt)
      if (!Number.isNaN(t) && t < cutoff) continue // старое надгробие заметки — выкидываем
    }
    notes[id] = n
  }

  // Поля notes и crm оставляем отсутствующими, если их не было: по их отсутствию SyncEngine
  // узнаёт данные, сохранённые старой версией приложения (та при слиянии теряла поля,
  // которых не знала).
  const result = {
    ...data,
    columns: keptColumns,
    cards,
    series,
    ...(data.notes ? { notes } : {}),
    ...(data.crm ? { crm: dropOldTombstones(data.crm, cutoff) } : {}),
  }
  // Журнал истории проекта убран из приложения — вычищаем его из старых данных,
  // чтобы не хранить и не тащить при загрузке.
  delete (result as { activity?: unknown }).activity
  return result
}

/**
 * Колонки одни на всю систему. Первая версия своих досок заводила им отдельные
 * колонки (Column.boardId) — переносим их задачи в общую колонку с тем же
 * статусом (без статуса — с тем же названием, иначе в первую), а сами колонки
 * удаляем. Задачи остаются на своей доске (Card.boardId).
 */
function foldBoardColumns(data: BoardData): BoardData {
  const extra = data.columns.filter((c) => c.boardId && !c.deleted)
  if (extra.length === 0) return data
  const main = data.columns.filter((c) => !c.boardId && !c.deleted)
  if (main.length === 0) return data
  const ts = nowISO()
  const target = (col: Column): Column =>
    main.find((m) => col.role && m.role === col.role) ??
    main.find((m) => m.title.trim().toLowerCase() === col.title.trim().toLowerCase()) ??
    main[0]
  const added = new Map<ID, ID[]>()
  const cards = { ...data.cards }
  for (const col of extra) {
    const to = target(col)
    for (const id of col.cardIds) {
      const card = cards[id]
      if (!card || card.deleted) continue
      cards[id] = { ...card, columnId: to.id, ...(card.boardId ? {} : { boardId: col.boardId }), updatedAt: ts }
      added.set(to.id, [...(added.get(to.id) ?? []), id])
    }
  }
  const columns = data.columns.map((c) => {
    if (c.boardId && !c.deleted) return { ...c, deleted: true, cardIds: [], updatedAt: ts }
    const more = added.get(c.id)
    return more ? { ...c, cardIds: [...c.cardIds.filter((id) => !more.includes(id)), ...more], updatedAt: ts } : c
  })
  return { ...data, columns, cards }
}

function dropOldTombstones(crm: CrmData, cutoff: number): CrmData {
  const keep = <T extends { deleted?: boolean; updatedAt: string }>(m: Record<ID, T> | undefined): Record<ID, T> => {
    const out: Record<ID, T> = {}
    for (const [id, x] of Object.entries(m ?? {})) {
      if (x.deleted) {
        const t = Date.parse(x.updatedAt)
        if (!Number.isNaN(t) && t < cutoff) continue
      }
      out[id] = x
    }
    return out
  }
  return {
    deals: keep(crm.deals),
    records: keep(crm.records),
    partners: keep(crm.partners),
    ...(crm.contacts ? { contacts: keep(crm.contacts) } : {}),
  }
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
    projects: [],
    notes: {},
    updatedAt: ts,
  }
}
