// Хранилище состояния доски + движок синхронизации.
// Все изменения проходят через SyncEngine.update(), который штампует updatedAt,
// откладывает сохранение (debounce), а при конфликтах сливает версии и повторяет.

import React, { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react'
import { produce } from 'immer'
import type { Attachment, BoardData, Card, CardKind, ChecklistItem, Column, ColumnRole, Comment, EisenhowerQuadrant, ID, Member, Project, RecurrenceRule, Series } from './types'
import type { StorageAdapter } from './storage/adapter'
import { ConflictError } from './storage/adapter'
import { emptyBoard, mergeBoards, normalizeBoard } from './merge'
import { dateMatchesRule, firstOccurrence, nextOccurrence } from './recurrence'
import { getIdentity, setIdentityId } from './config'
import { clamp, nowISO, toDateKey, uid } from './utils'
import { celebrate } from './confetti'

export interface SeriesInput {
  title: string
  description?: string
  assigneeIds: ID[]
  rule: RecurrenceRule
  kind?: CardKind
  meetingUrl?: string
  start?: string
  durationMin?: number
}

const MAX_DONE_INSTANCES = 8 // сколько выполненных экземпляров серии храним
const MEETING_WINDOW = 8 // сколько ближайших экземпляров повторяющейся встречи держим готовыми
const MEETING_MAX_PAST = 4 // сколько прошедших встреч серии храним

function makeInstance(seriesId: ID, s: Series, dateKey: string, ts: string): Card {
  const c: Card = {
    id: uid(),
    seriesId,
    title: s.title,
    description: s.description,
    columnId: '',
    assigneeIds: [...s.assigneeIds],
    checklist: [],
    attachments: [],
    date: dateKey,
    createdAt: ts,
    updatedAt: ts,
  }
  if (s.kind === 'meeting') {
    c.kind = 'meeting'
    if (s.meetingUrl) c.meetingUrl = s.meetingUrl
  }
  if (s.start) {
    c.start = s.start
    c.durationMin = s.durationMin ?? 60
  }
  return c
}

/**
 * Пополняет серию-встречу будущими экземплярами до окна MEETING_WINDOW и
 * подчищает старые прошедшие. Работает по времени (встречи не «выполняются»).
 */
function topUpMeetingSeries(d: BoardData, s: Series): void {
  if (s.deleted || s.kind !== 'meeting') return
  const today = toDateKey(new Date())
  const own = () => Object.values(d.cards).filter((c) => c.seriesId === s.id && !c.deleted)
  // Правило могло измениться (например, поменяли дни недели) — удаляем будущие
  // экземпляры, которые больше не попадают под текущее правило, чтобы они не «зависали».
  for (const c of own()) {
    if (c.date && c.date >= today && !dateMatchesRule(c.date, s.rule)) {
      c.deleted = true
      touch(c)
    }
  }
  const dates = new Set(own().map((c) => c.date).filter(Boolean) as string[])
  const ex = new Set(s.exdates ?? []) // даты, удалённые пользователем по одной — не пересоздаём
  // Идём по ближайшим MEETING_WINDOW датам ПО ПОРЯДКУ (по всем дням правила —
  // и понедельникам, и четвергам, и всем числам месяца) и досоздаём недостающие.
  // Важно перебирать по порядку, а не «добивать до количества»: иначе при
  // добавлении дня недели окно уже занято старыми датами и новые не появляются.
  let key = firstOccurrence(today, s.rule)
  let count = 0
  let guard = 0
  while (key && count < MEETING_WINDOW && guard++ < 400) {
    if (!dates.has(key) && !ex.has(key)) {
      const inst = makeInstance(s.id, s, key, nowISO())
      d.cards[inst.id] = inst
      dates.add(key)
    }
    count++
    key = nextOccurrence(key, s.rule)
  }
  // Приводим «шапку» будущих экземпляров к шаблону серии (на случай, если они
  // разошлись — например, старые экземпляры остались без названия).
  applySharedToInstances(d, s, today)
  const past = own()
    .filter((c) => (c.date ?? '') < today)
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
  for (let i = 0; i < past.length - MEETING_MAX_PAST; i++) {
    past[i].deleted = true
    touch(past[i])
  }
}

/**
 * Приводит общие поля (название, описание, ответственные, ссылка на созвон) всех
 * живых экземпляров серии-встречи к шаблону серии — у одной встречи «шапка»
 * одинакова везде. sinceKey — синхронизировать только начиная с этой даты.
 * Время и дату не трогаем: они у каждого экземпляра свои.
 */
function applySharedToInstances(d: BoardData, s: Series, sinceKey = ''): void {
  for (const c of Object.values(d.cards)) {
    if (c.seriesId !== s.id || c.deleted) continue
    if (sinceKey && (c.date ?? '') < sinceKey) continue
    let ch = false
    if (c.title !== s.title) {
      c.title = s.title
      ch = true
    }
    if (c.description !== s.description) {
      c.description = s.description
      ch = true
    }
    if (c.assigneeIds.join(',') !== s.assigneeIds.join(',')) {
      c.assigneeIds = [...s.assigneeIds]
      ch = true
    }
    if ((s.meetingUrl ?? '') !== (c.meetingUrl ?? '')) {
      if (s.meetingUrl) c.meetingUrl = s.meetingUrl
      else delete c.meetingUrl
      ch = true
    }
    if (ch) touch(c)
  }
}

export type SyncStatus = 'loading' | 'synced' | 'saving' | 'offline' | 'error'

export interface StoreSnapshot {
  data: BoardData | null
  status: SyncStatus
  lastSyncAt: number | null
  lastError: string | null
  identityId: ID | null
}

const SAVE_DEBOUNCE_MS = 1200
const POLL_INTERVAL_MS = 25_000
const MAX_CONFLICT_RETRIES = 6

export class SyncEngine {
  private data: BoardData | null = null
  private rev: string | null = null
  private dirty = false
  private saving = false
  private stopped = false
  /** Токен текущего запуска. Каждый start()/stop() его увеличивает, поэтому
   *  «зависший» в await прошлый start() (React 18 StrictMode) аборится. */
  private epoch = 0
  /** Растёт при каждом успешном сохранении; poll использует его, чтобы
   *  не перезаписать данные ответом GET, снятым до параллельного save */
  private saveGen = 0
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private conflictRetries = 0
  private errorBackoffMs = 5000
  private listeners = new Set<() => void>()
  private snapshot: StoreSnapshot
  /** Взводится мутатором, когда задача перешла в «Готово»; после применения
   *  изменений выпускаем конфетти. */
  private pendingCelebrate = false

  status: SyncStatus = 'loading'
  lastSyncAt: number | null = null
  lastError: string | null = null
  identityId: ID | null = getIdentity()

  constructor(public readonly adapter: StorageAdapter) {
    this.snapshot = this.buildSnapshot()
  }

  // ---------- подписка для React ----------

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getSnapshot = (): StoreSnapshot => this.snapshot

  private buildSnapshot(): StoreSnapshot {
    return {
      data: this.data,
      status: this.status,
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError,
      identityId: this.identityId,
    }
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot()
    for (const fn of this.listeners) fn()
  }

  // ---------- жизненный цикл ----------

  async start(): Promise<void> {
    // React 18 StrictMode делает mount→unmount→mount на одном движке.
    // Каждый запуск получает свой epoch; если во время await движок
    // остановили или перезапустили, продолжение аборится.
    const myEpoch = ++this.epoch
    this.stopped = false
    const aborted = () => this.stopped || this.epoch !== myEpoch
    try {
      let state = await this.adapter.load()
      if (aborted()) return
      if (!state) state = await this.adapter.init(emptyBoard())
      if (aborted()) return
      this.data = state.data
      this.rev = state.rev
      this.status = 'synced'
      this.lastSyncAt = Date.now()
      this.lastError = null
      this.emit()
    } catch (e) {
      if (aborted()) return
      this.status = 'error'
      this.lastError = e instanceof Error ? e.message : String(e)
      this.emit()
      return
    }

    if (aborted()) return
    this.pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') void this.poll()
    }, POLL_INTERVAL_MS)
    window.addEventListener('focus', this.onFocus)
    window.addEventListener('online', this.onOnline)
    window.addEventListener('beforeunload', this.onBeforeUnload)
  }

  stop(): void {
    this.stopped = true
    this.epoch++
    if (this.pollTimer) clearInterval(this.pollTimer)
    if (this.saveTimer) clearTimeout(this.saveTimer)
    if (this.retryTimer) clearTimeout(this.retryTimer)
    window.removeEventListener('focus', this.onFocus)
    window.removeEventListener('online', this.onOnline)
    window.removeEventListener('beforeunload', this.onBeforeUnload)
  }

  private onFocus = (): void => {
    void this.poll()
  }

  private onOnline = (): void => {
    if (this.dirty) void this.flush()
    else void this.poll()
  }

  private onBeforeUnload = (e: BeforeUnloadEvent): void => {
    if (this.dirty || this.saving) {
      e.preventDefault()
    }
  }

  // ---------- изменения ----------

  update(mutator: (d: BoardData) => void): void {
    if (!this.data) return
    this.pendingCelebrate = false
    this.data = produce(this.data, (draft) => {
      mutator(draft)
      draft.updatedAt = nowISO()
    })
    this.dirty = true
    this.conflictRetries = 0
    this.emit()
    this.scheduleSave()
    // Конфетти — после применения и рендера состояния (вне мутатора immer).
    if (this.pendingCelebrate) {
      this.pendingCelebrate = false
      celebrate()
    }
  }

  /** Пометить, что в текущем update() задача выполнена — выпустить конфетти. */
  requestCelebrate(): void {
    this.pendingCelebrate = true
  }

  setIdentity(id: ID | null): void {
    this.identityId = id
    setIdentityId(id)
    this.emit()
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void this.flush(), SAVE_DEBOUNCE_MS)
  }

  async flush(): Promise<void> {
    if (this.saving || !this.dirty || !this.data || this.rev === null || this.stopped) return
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    this.saving = true
    this.status = 'saving'
    this.emit()

    const snapshot = normalizeBoard(this.data)
    this.dirty = false

    try {
      const { rev } = await this.adapter.save(snapshot, this.rev)
      this.rev = rev
      this.saveGen++
      this.conflictRetries = 0
      this.errorBackoffMs = 5000
      this.lastSyncAt = Date.now()
      this.lastError = null
      this.status = this.dirty ? 'saving' : 'synced'
    } catch (e) {
      this.dirty = true
      if (e instanceof ConflictError) {
        this.conflictRetries++
        if (this.conflictRetries <= MAX_CONFLICT_RETRIES) {
          this.data = mergeBoards(this.data!, e.remote.data)
          this.rev = e.remote.rev
          this.saving = false
          this.emit()
          // Немедленный повтор поверх свежей ревизии
          this.retryTimer = setTimeout(() => void this.flush(), 100)
          return
        }
        this.status = 'error'
        this.lastError = 'Не удаётся согласовать изменения — попробуйте обновить страницу'
      } else {
        this.status = typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error'
        this.lastError = e instanceof Error ? e.message : String(e)
        // Повтор с растущим интервалом
        this.retryTimer = setTimeout(() => void this.flush(), this.errorBackoffMs)
        this.errorBackoffMs = Math.min(this.errorBackoffMs * 2, 60_000)
      }
    } finally {
      this.saving = false
    }
    this.emit()
    // Пока сохраняли, пользователь мог внести новую правку (dirty снова true).
    // Перепланируем, если нет уже поставленного повтора (retryTimer) из
    // веток ошибки/конфликта — они планируют сами.
    if (this.dirty && this.lastError === null) this.scheduleSave()
  }

  async poll(): Promise<void> {
    if (this.saving || this.stopped || !this.data) return
    if (this.dirty) {
      // Есть несохранённые изменения — просто ускоряем сохранение,
      // конфликт (если будет) разрешится слиянием.
      void this.flush()
      return
    }
    const genBefore = this.saveGen
    try {
      const remote = await this.adapter.load()
      // Пока летел GET, могло начаться/завершиться сохранение или появиться
      // локальная правка — тогда ответ устарел, применять его нельзя (иначе
      // откатим только что сохранённое и регрессируем rev).
      if (!remote || this.saving || this.dirty || this.stopped || this.saveGen !== genBefore) return
      const revChanged = remote.rev !== this.rev
      if (revChanged) {
        this.data = remote.data
        this.rev = remote.rev
      }
      this.lastSyncAt = Date.now() // обновляем тихо: подхватится следующим emit
      let statusChanged = false
      if (this.status === 'offline' || this.status === 'error') {
        this.status = 'synced'
        this.lastError = null
        statusChanged = true
      }
      // Не эмитим на каждый опрос при неизменных данных — иначе весь UI
      // (все карточки доски) перерисовывался бы каждые 25 секунд впустую.
      if (revChanged || statusChanged) this.emit()
    } catch {
      // Ошибки фонового опроса не показываем — покажем при сохранении
    }
  }
}

// ---------- React-контекст ----------

export interface BoardStore {
  data: BoardData
  status: SyncStatus
  lastSyncAt: number | null
  lastError: string | null

  members: Member[] // без архивных
  columns: Column[] // без удалённых
  card(id: ID): Card | undefined
  cardsInColumn(columnId: ID): Card[]
  liveCards(): Card[]

  identity: Member | null
  setIdentity(id: ID | null): void

  // Участники
  addMember(name: string, color: string): Member
  updateMember(id: ID, patch: Partial<Pick<Member, 'name' | 'color' | 'sleepUntil' | 'tgUsername' | 'avatar'>>): void
  archiveMember(id: ID): void

  // Проекты (табы в шапке; пока только визуально)
  projects: Project[]
  /** Задать имя/иконку слота проекта (0 или 1); слот создаётся при необходимости.
   *  icon: строка — установить, undefined — убрать. */
  updateProjectSlot(slot: number, patch: { name?: string; icon?: string | undefined }): void

  // Колонки
  addColumn(title: string): void
  renameColumn(id: ID, title: string): void
  setColumnRole(id: ID, role: ColumnRole | undefined): void
  setColumnColor(id: ID, color: string | undefined): void
  /** Разовая сортировка карточек колонки (порядок сохраняется в cardIds) */
  sortColumn(id: ID, by: 'due' | 'created' | 'priority'): void
  deleteColumn(id: ID): void
  moveColumn(id: ID, toIndex: number): void

  // Карточки
  addCard(columnId: ID, title: string): ID
  updateCard(id: ID, patch: Partial<Omit<Card, 'id' | 'createdAt' | 'updatedAt' | 'attachments'>>): void
  deleteCard(id: ID): void
  moveCard(id: ID, toColumnId: ID, toIndex: number): void
  /** Отметить выполненной/невыполненной; при done=true переносит в колонку «Готово», если она задана */
  setCardDone(id: ID, done: boolean): void
  /** Приоритет по матрице Эйзенхауэра (undefined — снять с матрицы) */
  setPriority(id: ID, priority: EisenhowerQuadrant | undefined): void

  // Повторяющиеся (регулярные) задачи
  series: Series[]
  seriesById(id: ID): Series | undefined
  /** Живые экземпляры повторяющихся задач (карточки со seriesId) */
  recurringCards(): Card[]
  addSeries(input: SeriesInput): void
  updateSeries(id: ID, input: SeriesInput): void
  deleteSeries(id: ID): void
  /** Сделать встречу повторяющейся (или изменить правило) — генерирует будущие экземпляры */
  applyMeetingRecurrence(cardId: ID, rule: RecurrenceRule): void
  /** Отключить повторение у встречи: убрать серию и будущие экземпляры, текущую оставить */
  stopMeetingRecurrence(cardId: ID): void
  /** Пополнить будущие экземпляры повторяющихся встреч (вызывается при загрузке) */
  topUpMeetings(): void

  // Чек-лист
  addChecklistItem(cardId: ID, text: string): void
  updateChecklistItem(cardId: ID, itemId: ID, patch: Partial<ChecklistItem>): void
  removeChecklistItem(cardId: ID, itemId: ID): void

  // Комментарии
  addComment(cardId: ID, html: string): void
  updateComment(cardId: ID, commentId: ID, html: string): void
  removeComment(cardId: ID, commentId: ID): void

  // Календарь
  scheduleCard(id: ID, date: string | null, start?: string | null, durationMin?: number): void

  // Вложения
  uploadAttachment(cardId: ID, file: File): Promise<void>
  removeAttachment(cardId: ID, attId: ID): Promise<void>
  downloadAttachment(att: Attachment): Promise<void>

  flush(): Promise<void>
  refresh(): Promise<void>
}

const StoreContext = createContext<BoardStore | null>(null)
const EngineContext = createContext<SyncEngine | null>(null)

export function BoardProvider({ adapter, children }: { adapter: StorageAdapter; children: React.ReactNode }) {
  const engine = useMemo(() => new SyncEngine(adapter), [adapter])

  useEffect(() => {
    void engine.start()
    return () => engine.stop()
  }, [engine])

  const snap = useSyncExternalStore(engine.subscribe, engine.getSnapshot)

  const store = useMemo<BoardStore | null>(() => {
    if (!snap.data) return null
    return buildStore(engine, snap)
  }, [engine, snap])

  return (
    <EngineContext.Provider value={engine}>
      <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
    </EngineContext.Provider>
  )
}

/** Статус синхронизации до того, как данные загрузились */
export function useSyncMeta(): { status: SyncStatus; lastError: string | null } {
  const engine = useContext(EngineContext)
  if (!engine) throw new Error('useSyncMeta вне BoardProvider')
  const snap = useSyncExternalStore(engine.subscribe, engine.getSnapshot)
  return { status: snap.status, lastError: snap.lastError }
}

export function useBoard(): BoardStore {
  const store = useContext(StoreContext)
  if (!store) throw new Error('useBoard вызван до загрузки данных или вне BoardProvider')
  return store
}

/** Как useBoard, но возвращает null, пока данные не загрузились */
export function useMaybeBoard(): BoardStore | null {
  return useContext(StoreContext)
}

function touch(e: { updatedAt: string }): void {
  e.updatedAt = nowISO()
}

function buildStore(engine: SyncEngine, snap: StoreSnapshot): BoardStore {
  const data = snap.data!
  const liveColumns = data.columns.filter((c) => !c.deleted)
  const activeMembers = data.members.filter((m) => !m.archived)
  const identity = snap.identityId ? data.members.find((m) => m.id === snap.identityId && !m.archived) ?? null : null

  const getCard = (id: ID): Card | undefined => {
    const c = data.cards[id]
    return c && !c.deleted ? c : undefined
  }

  return {
    data,
    status: snap.status,
    lastSyncAt: snap.lastSyncAt,
    lastError: snap.lastError,

    members: activeMembers,
    projects: (data.projects ?? []).filter((p) => !p.deleted),
    columns: liveColumns,
    card: getCard,
    cardsInColumn: (columnId) => {
      const col = liveColumns.find((c) => c.id === columnId)
      if (!col) return []
      return col.cardIds.map((id) => getCard(id)).filter((c): c is Card => !!c)
    },
    liveCards: () => Object.values(data.cards).filter((c) => !c.deleted),

    series: Object.values(data.series ?? {}).filter((s) => !s.deleted),
    seriesById: (id) => data.series?.[id],
    recurringCards: () => Object.values(data.cards).filter((c) => !c.deleted && !!c.seriesId),

    identity,
    setIdentity: (id) => engine.setIdentity(id),

    addMember: (name, color) => {
      const ts = nowISO()
      const member: Member = { id: uid(), name: name.trim(), color, createdAt: ts, updatedAt: ts }
      engine.update((d) => {
        d.members.push(member)
      })
      return member
    },
    updateMember: (id, patch) =>
      engine.update((d) => {
        const m = d.members.find((x) => x.id === id)
        if (!m) return
        Object.assign(m, patch)
        touch(m)
      }),
    archiveMember: (id) =>
      engine.update((d) => {
        const m = d.members.find((x) => x.id === id)
        if (!m) return
        m.archived = true
        touch(m)
      }),

    updateProjectSlot: (slot, patch) =>
      engine.update((d) => {
        if (!d.projects) d.projects = []
        const ts = nowISO()
        // Гарантируем существование слотов до нужного индекса (со стабильными id).
        while (d.projects.length <= slot) {
          const n = d.projects.length + 1
          d.projects.push({ id: `proj-${n}`, name: `Проект ${n}`, createdAt: ts, updatedAt: ts })
        }
        const p = d.projects[slot]
        if (patch.name !== undefined) p.name = patch.name
        if ('icon' in patch) {
          if (patch.icon) p.icon = patch.icon
          else delete p.icon
        }
        touch(p)
      }),

    addColumn: (title) =>
      engine.update((d) => {
        const ts = nowISO()
        d.columns.push({ id: uid(), title: title.trim() || 'Новая колонка', cardIds: [], createdAt: ts, updatedAt: ts })
      }),
    renameColumn: (id, title) =>
      engine.update((d) => {
        const col = d.columns.find((c) => c.id === id)
        if (!col) return
        col.title = title.trim() || col.title
        touch(col)
      }),
    setColumnRole: (id, role) =>
      engine.update((d) => {
        const col = d.columns.find((c) => c.id === id)
        if (!col) return
        if (role) col.role = role
        else delete col.role
        touch(col)
        // Приводим отметку «выполнено» у карточек колонки в соответствие с ролью
        for (const cardId of col.cardIds) {
          const card = d.cards[cardId]
          if (!card || card.deleted) continue
          const shouldBeDone = role === 'done'
          if (!!card.done !== shouldBeDone && (role === 'done' || card.done)) {
            card.done = shouldBeDone
            touch(card)
          }
        }
      }),
    setColumnColor: (id, color) =>
      engine.update((d) => {
        const col = d.columns.find((c) => c.id === id)
        if (!col) return
        if (color) col.color = color
        else delete col.color
        touch(col)
      }),
    sortColumn: (id, by) =>
      engine.update((d) => {
        const col = d.columns.find((c) => c.id === id)
        if (!col) return
        const live = col.cardIds
          .map((cid) => d.cards[cid])
          .filter((c): c is Card => !!c && !c.deleted)
        const dueKey = (c: Card) => (c.date ? `${c.date}T${c.start ?? '99:99'}` : '￿') // без даты — в конец
        // Приоритет: q1 (срочно и важно) → q4 (не срочно, не важно), без приоритета — в конец
        const RANK: Record<string, number> = { q1: 0, q2: 1, q3: 2, q4: 3 }
        const prioRank = (c: Card) => (c.priority ? RANK[c.priority] : 4)
        live.sort((a, b) => {
          if (by === 'created') return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
          if (by === 'priority') return prioRank(a) - prioRank(b) || a.createdAt.localeCompare(b.createdAt)
          return dueKey(a).localeCompare(dueKey(b)) || a.createdAt.localeCompare(b.createdAt)
        })
        col.cardIds = live.map((c) => c.id)
        touch(col)
      }),
    deleteColumn: (id) =>
      engine.update((d) => {
        const col = d.columns.find((c) => c.id === id)
        if (!col) return
        col.deleted = true
        for (const cardId of col.cardIds) {
          const card = d.cards[cardId]
          if (card) {
            card.deleted = true
            touch(card)
          }
        }
        col.cardIds = []
        touch(col)
      }),
    moveColumn: (id, toIndex) =>
      engine.update((d) => {
        const live = d.columns.filter((c) => !c.deleted)
        const from = live.findIndex((c) => c.id === id)
        if (from < 0) return
        const target = live[from]
        live.splice(from, 1)
        live.splice(clamp(toIndex, 0, live.length), 0, target)
        // Пересобираем общий массив: живые в новом порядке + удалённые в конце
        d.columns = [...live, ...d.columns.filter((c) => c.deleted)]
        touch(target)
      }),

    addCard: (columnId, title) => {
      const id = uid()
      engine.update((d) => {
        const col = d.columns.find((c) => c.id === columnId && !c.deleted)
        if (!col) return
        const ts = nowISO()
        d.cards[id] = {
          id,
          title: title.trim() || 'Без названия',
          description: '',
          columnId,
          assigneeIds: [],
          checklist: [],
          attachments: [],
          createdAt: ts,
          updatedAt: ts,
        }
        col.cardIds.push(id)
        touch(col)
      })
      return id
    },
    updateCard: (id, patch) =>
      engine.update((d) => {
        const card = d.cards[id]
        if (!card || card.deleted) return
        Object.assign(card, patch)
        touch(card)
        // Повторяющаяся встреча: название/описание/ответственные/ссылка одинаковы
        // у всех экземпляров серии — распространяем правку на серию и остальные.
        if (card.kind === 'meeting' && card.seriesId && ('title' in patch || 'description' in patch || 'assigneeIds' in patch || 'meetingUrl' in patch)) {
          const s = d.series?.[card.seriesId]
          if (s && !s.deleted) {
            s.title = card.title
            s.description = card.description
            s.assigneeIds = [...card.assigneeIds]
            if (card.meetingUrl) s.meetingUrl = card.meetingUrl
            else delete s.meetingUrl
            touch(s)
            applySharedToInstances(d, s)
          }
        }
      }),
    deleteCard: (id) =>
      engine.update((d) => {
        const card = d.cards[id]
        if (!card) return
        // Удаление одного экземпляра повторяющейся встречи: запоминаем дату как
        // исключение, иначе автопополнение серии создаст встречу на неё заново.
        const s = card.seriesId ? d.series?.[card.seriesId] : undefined
        if (s && s.kind === 'meeting' && !s.deleted && card.date) {
          if (!s.exdates) s.exdates = []
          if (!s.exdates.includes(card.date)) {
            s.exdates.push(card.date)
            touch(s)
          }
        }
        card.deleted = true
        touch(card)
        const col = d.columns.find((c) => c.id === card.columnId)
        if (col) {
          col.cardIds = col.cardIds.filter((x) => x !== id)
          touch(col)
        }
      }),
    moveCard: (id, toColumnId, toIndex) =>
      engine.update((d) => {
        const card = d.cards[id]
        const to = d.columns.find((c) => c.id === toColumnId && !c.deleted)
        if (!card || card.deleted || !to) return
        const from = d.columns.find((c) => c.id === card.columnId)
        if (from) {
          from.cardIds = from.cardIds.filter((x) => x !== id)
          if (from.id !== to.id) touch(from)
        }
        // На случай рассинхрона убираем дубликаты
        to.cardIds = to.cardIds.filter((x) => x !== id)
        to.cardIds.splice(clamp(toIndex, 0, to.cardIds.length), 0, id)
        card.columnId = toColumnId
        // Перемещение в колонку с ролью синхронизирует отметку «выполнено»:
        // в «Готово» → выполнено; в любую другую колонку с ролью → не выполнено.
        const wasDone = !!card.done
        if (to.role === 'done') card.done = true
        else if (to.role) card.done = false
        if (card.done && !wasDone) engine.requestCelebrate() // задача стала «Готово» → конфетти
        touch(card)
        touch(to)
      }),
    setCardDone: (id, done) =>
      engine.update((d) => {
        const card = d.cards[id]
        if (!card || card.deleted) return
        const wasDone = !!card.done
        card.done = done
        if (done && !wasDone) engine.requestCelebrate() // задача выполнена → конфетти
        touch(card)
        if (!done) {
          // Отмена выполнения повторяющейся задачи — «шаг назад»: задача снова
          // становится активной, а автоматически созданный следующий экземпляр
          // (тот, что появился при отметке «выполнено») удаляется.
          if (card.seriesId) {
            for (const c of Object.values(d.cards)) {
              if (c.seriesId === card.seriesId && !c.deleted && !c.done && c.id !== id) {
                c.deleted = true
                touch(c)
              }
            }
          }
          return
        }

        // Экземпляр повторяющейся задачи: не переносим на доску, а порождаем
        // следующий экземпляр и подчищаем старые выполненные.
        if (card.seriesId) {
          const s = d.series?.[card.seriesId]
          if (s && !s.deleted) {
            const hasActive = Object.values(d.cards).some(
              (c) => c.seriesId === card.seriesId && !c.deleted && !c.done && c.id !== id,
            )
            if (!hasActive) {
              const nextKey = nextOccurrence(card.date ?? toDateKey(new Date()), s.rule)
              if (nextKey) {
                const inst = makeInstance(card.seriesId, s, nextKey, nowISO())
                d.cards[inst.id] = inst
              }
            }
            const completed = Object.values(d.cards)
              .filter((c) => c.seriesId === card.seriesId && !c.deleted && c.done)
              .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
            for (let i = 0; i < completed.length - MAX_DONE_INSTANCES; i++) {
              completed[i].deleted = true
              touch(completed[i])
            }
          }
          return
        }

        // Обычная задача: переносим в колонку с ролью «Готово», если она есть
        const doneCol = d.columns.find((c) => !c.deleted && c.role === 'done')
        if (!doneCol || card.columnId === doneCol.id) return
        const from = d.columns.find((c) => c.id === card.columnId)
        if (from) {
          from.cardIds = from.cardIds.filter((x) => x !== id)
          touch(from)
        }
        doneCol.cardIds = doneCol.cardIds.filter((x) => x !== id)
        doneCol.cardIds.push(id)
        card.columnId = doneCol.id
        touch(doneCol)
      }),
    setPriority: (id, priority) =>
      engine.update((d) => {
        const card = d.cards[id]
        if (!card || card.deleted) return
        if (priority) card.priority = priority
        else delete card.priority
        touch(card)
      }),
    addSeries: (input) =>
      engine.update((d) => {
        const ts = nowISO()
        const sid = uid()
        if (!d.series) d.series = {}
        const s: Series = {
          id: sid,
          title: input.title.trim() || 'Регулярная задача',
          description: input.description ?? '',
          assigneeIds: [...input.assigneeIds],
          rule: input.rule,
          ...(input.start ? { start: input.start, durationMin: input.durationMin ?? 60 } : {}),
          createdAt: ts,
          updatedAt: ts,
        }
        d.series[sid] = s
        const firstKey = firstOccurrence(toDateKey(new Date()), s.rule)
        if (firstKey) {
          const inst = makeInstance(sid, s, firstKey, ts)
          d.cards[inst.id] = inst
        }
      }),
    updateSeries: (id, input) =>
      engine.update((d) => {
        const s = d.series?.[id]
        if (!s || s.deleted) return
        const ruleChanged = JSON.stringify(input.rule) !== JSON.stringify(s.rule)
        s.title = input.title.trim() || s.title
        s.description = input.description ?? ''
        s.assigneeIds = [...input.assigneeIds]
        s.rule = input.rule
        if (input.start) {
          s.start = input.start
          s.durationMin = input.durationMin ?? 60
        } else {
          delete s.start
          delete s.durationMin
        }
        touch(s)
        // Синхронизируем активный (невыполненный) экземпляр
        const active = Object.values(d.cards).find((c) => c.seriesId === id && !c.deleted && !c.done)
        if (active) {
          active.title = s.title
          active.description = s.description
          active.assigneeIds = [...s.assigneeIds]
          if (s.start) {
            active.start = s.start
            active.durationMin = s.durationMin
          } else {
            delete active.start
            delete active.durationMin
          }
          if (ruleChanged) {
            const k = firstOccurrence(toDateKey(new Date()), s.rule)
            if (k) active.date = k
          }
          touch(active)
        }
      }),
    deleteSeries: (id) =>
      engine.update((d) => {
        const s = d.series?.[id]
        if (!s) return
        s.deleted = true
        touch(s)
        for (const c of Object.values(d.cards)) {
          if (c.seriesId === id && !c.deleted) {
            c.deleted = true
            touch(c)
          }
        }
      }),

    // ---------- Повторяющиеся встречи ----------
    applyMeetingRecurrence: (cardId, rule) =>
      engine.update((d) => {
        const card = d.cards[cardId]
        if (!card || card.deleted) return
        const ts = nowISO()
        let s = card.seriesId ? d.series?.[card.seriesId] : undefined
        if (s && s.kind === 'meeting' && !s.deleted) {
          // Обновляем существующую серию-встречу по данным карточки + новое правило
          s.rule = rule
          s.title = card.title
          s.description = card.description
          s.assigneeIds = [...card.assigneeIds]
          if (card.meetingUrl) s.meetingUrl = card.meetingUrl
          else delete s.meetingUrl
          if (card.start) {
            s.start = card.start
            s.durationMin = card.durationMin ?? 60
          } else {
            delete s.start
            delete s.durationMin
          }
          touch(s)
        } else {
          // Создаём новую серию-встречу из текущей карточки
          if (!d.series) d.series = {}
          const sid = uid()
          s = {
            id: sid,
            kind: 'meeting',
            title: card.title,
            description: card.description,
            assigneeIds: [...card.assigneeIds],
            rule,
            ...(card.meetingUrl ? { meetingUrl: card.meetingUrl } : {}),
            ...(card.start ? { start: card.start, durationMin: card.durationMin ?? 60 } : {}),
            createdAt: ts,
            updatedAt: ts,
          }
          d.series[sid] = s
          card.seriesId = sid
          touch(card)
        }
        topUpMeetingSeries(d, s)
      }),
    stopMeetingRecurrence: (cardId) =>
      engine.update((d) => {
        const card = d.cards[cardId]
        if (!card || !card.seriesId) return
        const sid = card.seriesId
        const s = d.series?.[sid]
        if (s) {
          s.deleted = true
          touch(s)
        }
        // Удаляем будущие экземпляры этой серии, текущую карточку оставляем разовой
        const today = toDateKey(new Date())
        for (const c of Object.values(d.cards)) {
          if (c.seriesId === sid && c.id !== cardId && !c.deleted && (c.date ?? '') >= today) {
            c.deleted = true
            touch(c)
          }
        }
        delete card.seriesId
        touch(card)
      }),
    topUpMeetings: () =>
      engine.update((d) => {
        if (!d.series) return
        for (const s of Object.values(d.series)) topUpMeetingSeries(d, s)
      }),

    addChecklistItem: (cardId, text) =>
      engine.update((d) => {
        const card = d.cards[cardId]
        if (!card || card.deleted) return
        card.checklist.push({ id: uid(), text: text.trim(), done: false, updatedAt: nowISO() })
        touch(card)
      }),
    updateChecklistItem: (cardId, itemId, patch) =>
      engine.update((d) => {
        const card = d.cards[cardId]
        if (!card || card.deleted) return
        const item = card.checklist.find((i) => i.id === itemId)
        if (!item) return
        Object.assign(item, patch)
        item.updatedAt = nowISO()
        touch(card)
      }),
    removeChecklistItem: (cardId, itemId) =>
      engine.update((d) => {
        const card = d.cards[cardId]
        if (!card || card.deleted) return
        card.checklist = card.checklist.filter((i) => i.id !== itemId)
        touch(card)
      }),

    addComment: (cardId, html) =>
      engine.update((d) => {
        const card = d.cards[cardId]
        if (!card || card.deleted) return
        const ts = nowISO()
        const comment: Comment = {
          id: uid(),
          ...(identity ? { authorId: identity.id } : {}),
          authorName: identity?.name ?? 'Аноним',
          html,
          createdAt: ts,
          updatedAt: ts,
        }
        if (!card.comments) card.comments = []
        card.comments.push(comment)
        touch(card)
      }),
    updateComment: (cardId, commentId, html) =>
      engine.update((d) => {
        const card = d.cards[cardId]
        if (!card || card.deleted || !card.comments) return
        const c = card.comments.find((x) => x.id === commentId)
        if (!c || c.deleted) return
        // Редактировать можно только свои комментарии
        if (identity && c.authorId && c.authorId !== identity.id) return
        const ts = nowISO()
        c.html = html
        c.updatedAt = ts
        c.editedAt = ts
        touch(card)
      }),
    removeComment: (cardId, commentId) =>
      engine.update((d) => {
        const card = d.cards[cardId]
        if (!card || card.deleted || !card.comments) return
        const c = card.comments.find((x) => x.id === commentId)
        if (!c || c.deleted) return
        if (identity && c.authorId && c.authorId !== identity.id) return
        // Надгробие: сохраняем факт удаления для синхронизации, содержимое стираем
        c.deleted = true
        c.html = ''
        c.updatedAt = nowISO()
        touch(card)
      }),

    scheduleCard: (id, date, start, durationMin) =>
      engine.update((d) => {
        const card = d.cards[id]
        if (!card || card.deleted) return
        if (date === null) {
          delete card.date
          delete card.start
          delete card.durationMin
        } else {
          card.date = date
          if (start === null) {
            delete card.start
            delete card.durationMin
          } else if (start !== undefined) {
            card.start = start
            card.durationMin = durationMin ?? card.durationMin ?? 60
          } else if (durationMin !== undefined) {
            card.durationMin = durationMin
          }
        }
        touch(card)
      }),

    uploadAttachment: async (cardId, file) => {
      const att = await engine.adapter.uploadAttachment(cardId, file, snap.identityId ?? undefined)
      engine.update((d) => {
        const card = d.cards[cardId]
        if (!card || card.deleted) return
        card.attachments.push(att)
        touch(card)
      })
    },
    removeAttachment: async (cardId, attId) => {
      // Берём метаданные из текущего снапшота (обычный замороженный объект),
      // а НЕ из immer-черновика внутри update — тот отзывается после produce.
      const att = data.cards[cardId]?.attachments.find((a) => a.id === attId)
      engine.update((d) => {
        const card = d.cards[cardId]
        if (!card) return
        card.attachments = card.attachments.filter((a) => a.id !== attId)
        touch(card)
      })
      if (att) {
        try {
          await engine.adapter.deleteAttachment(att)
        } catch (e) {
          console.warn('Не удалось удалить файл вложения', e)
        }
      }
    },
    downloadAttachment: async (att) => {
      const blob: Blob = await engine.adapter.downloadAttachment(att)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = att.name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    },

    flush: () => engine.flush(),
    refresh: () => engine.poll(),
  }
}
