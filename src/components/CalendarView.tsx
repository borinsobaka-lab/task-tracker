// Недельный календарь в духе Google Calendar: шапка «весь день»,
// часовая сетка, панель «Без даты», перетаскивание своими pointer-событиями.

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useBoard } from '../store'
import { getCalDays, getCalPanelOpen, getCalTimeline, isMobileViewport, setCalDays, setCalPanelOpen, setCalTimeline } from '../config'
import type { Card, ID, Member } from '../types'
import { QUADRANT_COLOR, priorityStripeColor } from '../eisenhower'
import type { ViewProps } from '../viewProps'
import { IcoArrowLeft, IcoArrowRight, IcoCheck, IcoLink, IcoMeeting } from '../icons'
import { SubHeader } from './SubHeader'
import { TimelineView } from './TimelineView'
import type { TimelineHandle } from './TimelineView'
import { buildLiveTimelineUrl } from '../timelineShare'
import type { TLItem } from '../timelineShare'
import {
  addDays,
  clamp,
  parseDateKey,
  fmtDayMonth,
  fmtFullDate,
  fmtWeekday,
  minToTime,
  startOfWeek,
  timeToMin,
  toDateKey,
} from '../utils'
import { AvatarStack } from './Avatar'
import './calendar.css'

const HOUR_H = 48 // высота часа, px (синхронизировано с calendar.css)
const SNAP = 30 // шаг привязки, минут
const DAY_MIN = 24 * 60
const DRAG_THRESHOLD = 4 // px: меньше — это клик
// Тач: сколько удерживать палец, прежде чем карточка «возьмётся» и начнётся drag.
// Пока удержание не сработало, движение пальца прокручивает день, а не двигает задачу.
const HOLD_MS = 220
const PENDING_SLOP = 8 // px: сдвиг до срабатывания удержания трактуем как прокрутку

// ---------- Перетаскивание ----------

type DragKind = 'block' | 'resize' | 'allday' | 'unscheduled'

interface DragSource {
  kind: DragKind
  cardId: ID
}

type DragTarget =
  | { type: 'slot'; dayIdx: number; startMin: number; durationMin: number }
  | { type: 'allday'; dayIdx: number }
  | { type: 'unschedule' }
  | null

interface DragState {
  source: DragSource
  pointerId: number
  startX: number
  startY: number
  moved: boolean
  /** Перетаскивание активировано: для мыши — сразу, для тача — после удержания */
  active: boolean
  /** scrollTop контейнера в момент нажатия — для ручной прокрутки в фазе ожидания */
  startScrollTop: number
  /** В фазе ожидания палец повели — это прокрутка, значит не клик и не drag */
  scrolled: boolean
  /** Смещение точки захвата от начала блока, минут (для kind='block') */
  grabOffsetMin: number
  durationMin: number
  /** Для ресайза: день и начало не меняются */
  fixedDayIdx: number
  fixedStartMin: number
  origDate?: string
  origStart?: string
  origDur?: number
  target: DragTarget
}

function targetsEqual(a: DragTarget, b: DragTarget): boolean {
  if (a === b) return true
  if (!a || !b || a.type !== b.type) return false
  if (a.type === 'slot' && b.type === 'slot')
    return a.dayIdx === b.dayIdx && a.startMin === b.startMin && a.durationMin === b.durationMin
  if (a.type === 'allday' && b.type === 'allday') return a.dayIdx === b.dayIdx
  return true // оба 'unschedule'
}

// ---------- Раскладка пересекающихся блоков ----------

interface LaidEvent {
  card: Card
  startMin: number
  endMin: number // для геометрии (мин. 30 минут высоты)
  col: number
  cols: number
}

function layoutDay(cards: Card[]): LaidEvent[] {
  const evs: LaidEvent[] = cards
    .map((card) => {
      const startMin = clamp(timeToMin(card.start!), 0, DAY_MIN - 1)
      const endMin = Math.min(DAY_MIN, startMin + Math.max(SNAP, card.durationMin ?? 60))
      return { card, startMin, endMin, col: 0, cols: 1 }
    })
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin || a.card.id.localeCompare(b.card.id))

  // Простые кластеры: события, связанные пересечением, делят ширину поровну
  let clusterFrom = 0
  let clusterEnd = -1
  const colEnds: number[] = []
  const finalize = (to: number) => {
    for (let i = clusterFrom; i < to; i++) evs[i].cols = colEnds.length
  }
  evs.forEach((ev, i) => {
    if (colEnds.length > 0 && ev.startMin >= clusterEnd) {
      finalize(i)
      clusterFrom = i
      colEnds.length = 0
    }
    let col = colEnds.findIndex((end) => end <= ev.startMin)
    if (col === -1) {
      col = colEnds.length
      colEnds.push(ev.endMin)
    } else {
      colEnds[col] = ev.endMin
    }
    ev.col = col
    clusterEnd = Math.max(clusterEnd, ev.endMin)
  })
  finalize(evs.length)
  return evs
}

// ---------- Форматирование ----------

/** Конец интервала: 1440 показываем как «24:00» */
function fmtEnd(min: number): string {
  return min >= DAY_MIN ? '24:00' : minToTime(min)
}

function timeRange(startMin: number, endMin: number): string {
  return `${minToTime(startMin)} – ${fmtEnd(endMin)}`
}

function rangeTitle(start: Date, end: Date): string {
  const full = (d: Date) => fmtFullDate(d).replace(/\s*г\.\s*$/, '')
  if (start.getFullYear() !== end.getFullYear()) return `${full(start)} – ${full(end)}`
  if (start.getMonth() !== end.getMonth()) return `${fmtDayMonth(start)} – ${full(end)}`
  return `${start.getDate()} – ${full(end)}`
}

// ---------- Компонент ----------

export function CalendarView({ memberFilter, onMemberFilterChange, onOpenCard, onCreateDraft }: ViewProps) {
  const store = useBoard()
  // Сколько дней показывать: 1 / 3 / 7 — выбор пользователя (сохраняется).
  const [nDays, setNDaysState] = useState<number>(() => getCalDays())
  const setNDays = (n: number) => {
    setCalDays(n)
    setNDaysState(n)
  }
  // Режим «Таймлайн» — вертикальная хронология вместо сетки
  const [timeline, setTimelineState] = useState<boolean>(() => getCalTimeline())
  const setTimeline = (on: boolean) => {
    setCalTimeline(on)
    setTimelineState(on)
  }
  const tlRef = useRef<TimelineHandle>(null)
  const [copied, setCopied] = useState(false)
  const [anchor, setAnchor] = useState<Date>(() => new Date())
  // На телефоне запоминаем состояние панели «Без даты»; на десктопе всегда открыта.
  const [panelOpen, setPanelOpen] = useState<boolean>(() => (isMobileViewport() ? getCalPanelOpen() : true))
  const togglePanel = (open: boolean) => {
    setPanelOpen(open)
    if (isMobileViewport()) setCalPanelOpen(open)
  }
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  dragRef.current = drag
  const [now, setNow] = useState<Date>(() => new Date())

  const scrollRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const sidebarListRef = useRef<HTMLDivElement>(null)
  const swipeRef = useRef<{ x: number; y: number; ignore: boolean } | null>(null)
  // Таймер удержания перед началом перетаскивания (тач)
  const pressTimerRef = useRef<number | null>(null)
  const clearPressTimer = (): void => {
    if (pressTimerRef.current !== null) {
      clearTimeout(pressTimerRef.current)
      pressTimerRef.current = null
    }
  }
  // Контейнер, который прокручиваем пальцем в фазе ожидания (до начала drag)
  const scrollElFor = (kind: DragKind): HTMLDivElement | null =>
    kind === 'unscheduled' ? sidebarListRef.current : scrollRef.current
  useEffect(() => clearPressTimer, [])

  // Красная линия «сейчас» — обновление раз в минуту
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  // При открытии — автоскролл к 07:30
  useEffect(() => {
    const sc = scrollRef.current
    if (sc) sc.scrollTop = 7.5 * HOUR_H
  }, [])

  // Отмена перетаскивания по Escape
  useEffect(() => {
    if (!drag) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clearPressTimer()
        setDrag(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drag])

  // Страховка: pointer-события висят на самом блоке, и если он размонтируется
  // посреди перетаскивания (фоновая синхронизация подменила/удалила карточку),
  // штатный onPointerUp до нас не дойдёт и drag завис бы в is-dragging навсегда.
  // Ловим отпускание указателя на уровне window и снимаем зависший drag.
  useEffect(() => {
    const release = (e: PointerEvent): void => {
      const d = dragRef.current
      if (!d || e.pointerId !== d.pointerId) return
      // Даём сработать штатному обработчику элемента (он бежит раньше и сам
      // сбросит drag). Если через микротаск drag всё ещё висит — элемент исчез,
      // снимаем перетаскивание.
      setTimeout(() => {
        if (dragRef.current && dragRef.current.pointerId === e.pointerId) {
          clearPressTimer()
          setDrag(null)
        }
      }, 0)
    }
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    window.addEventListener('lostpointercapture', release)
    return () => {
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      window.removeEventListener('lostpointercapture', release)
    }
  }, [])

  // Начало показываемого диапазона: неделя — с понедельника; 3 дня — с выбранного дня.
  const rangeStart = useMemo(
    () => (nDays === 7 ? startOfWeek(anchor) : new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())),
    [anchor, nDays],
  )
  const gutterW = nDays === 7 ? 56 : 44
  const days = useMemo(() => Array.from({ length: nDays }, (_, i) => addDays(rangeStart, i)), [rangeStart, nDays])
  const dayKeys = useMemo(() => days.map(toDateKey), [days])
  const todayKey = toDateKey(now)
  // «Зона сна» текущего пользователя — серые слоты 00:00–это_время
  const sleepUntil = Math.max(0, Math.min(12, store.identity?.sleepUntil ?? 0))
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const nowMs = now.getTime()
  // Конец задачи: со временем — начало+длительность; без времени — конец её дня.
  const cardEndMs = (c: Card): number => {
    const d = parseDateKey(c.date!)
    if (c.start) {
      const [hh, mm] = c.start.split(':').map(Number)
      return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm).getTime() + (c.durationMin ?? 60) * 60000
    }
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59).getTime()
  }
  // Просроченная задача: не выполнена, не встреча, есть дата, и её конец уже прошёл.
  const isOverdue = (c: Card): boolean => !c.done && c.kind !== 'meeting' && !!c.date && cardEndMs(c) < nowMs

  const memberById = useMemo(() => new Map(store.members.map((m) => [m.id, m])), [store.members])

  const passesFilter = (c: Card): boolean =>
    memberFilter.size === 0 || c.assigneeIds.some((id) => memberFilter.has(id))

  const visible = store.liveCards().filter(passesFilter)
  const liveColumns = store.columns.filter((c) => !c.deleted)
  // Задачи со статусом «Готово» в панель «Без даты» не показываем — они уже
  // сделаны, распределять их по датам не нужно.
  const doneColIds = new Set(liveColumns.filter((c) => c.role === 'done').map((c) => c.id))
  const unscheduled = visible
    .filter((c) => !c.date && !c.done && !doneColIds.has(c.columnId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  // Группируем «Без даты» по статусу колонки. Порядок: Нужно сделать → В работе →
  // Ожидает проверки → колонки без роли. «Готово» уже отфильтровано выше.
  const UNSCHED_RANK: Record<string, number> = { todo: 0, doing: 1, review: 2 }
  const colRank = (role?: string): number => (role && role in UNSCHED_RANK ? UNSCHED_RANK[role] : 3)
  const unscheduledGroups = liveColumns
    .filter((col) => col.role !== 'done')
    .map((col) => ({ col, cards: unscheduled.filter((c) => c.columnId === col.id) }))
    .filter((g) => g.cards.length > 0)
    .sort((a, b) => colRank(a.col.role) - colRank(b.col.role))
  const unscheduledOther = unscheduled.filter((c) => !liveColumns.some((col) => col.id === c.columnId))
  // Просроченные задачи с прошлых дней закрепляем вверху сегодняшнего дня (в зоне
  // «весь день», без времени). Механизм включается, только когда сегодня в поле
  // зрения; иначе (листаем другие недели) задачи показываем на своих местах.
  const todayVisible = dayKeys.includes(todayKey)
  const overduePinned = (todayVisible ? visible.filter((c) => isOverdue(c) && c.date! < todayKey) : []).sort(
    (a, b) => (a.date! + (a.start ?? '')).localeCompare(b.date! + (b.start ?? '')),
  )
  const overdueSet = new Set(overduePinned.map((c) => c.id))
  const allDayByDay = dayKeys.map((key) => {
    const own = visible
      .filter((c) => c.date === key && !c.start && !overdueSet.has(c.id))
      .sort((a, b) => a.title.localeCompare(b.title, 'ru'))
    // Сегодня: сверху — просроченные с прошлых дней, затем обычные задачи дня.
    return key === todayKey ? [...overduePinned, ...own] : own
  })
  const timedByDay = dayKeys.map((key) => visible.filter((c) => c.date === key && !!c.start && !overdueSet.has(c.id)))

  const assigneesOf = (c: Card): Member[] =>
    c.assigneeIds.map((id) => memberById.get(id)).filter((m): m is Member => !!m)
  const isMeeting = (c: Card): boolean => c.kind === 'meeting'
  // Встречи — фиксированного цвета, задачи — по цвету первого исполнителя.
  // Встречи — серые, полоса слева и текст всегда чёрные (независимо от участников).
  // Задачи — по цвету исполнителя.
  const colorOf = (c: Card): string => (isMeeting(c) ? '#1f2937' : assigneesOf(c)[0]?.color ?? 'var(--accent)')

  // Снимок задач для таймлайна (и для публичной ссылки). Все запланированные,
  // без приватных полей — только то, что видно в хронологии.
  const timelineItems: TLItem[] = visible
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
      members: assigneesOf(c).map((m) => ({ name: m.name, color: m.color })),
    }))

  // ---------- Геометрия перетаскивания ----------

  const yToMin = (y: number): number => {
    const grect = gridRef.current!.getBoundingClientRect()
    return ((y - grect.top) / HOUR_H) * 60
  }

  const computeTarget = (x: number, y: number, d: DragState): DragTarget => {
    const grid = gridRef.current
    const head = headRef.current
    if (!grid || !head) return null

    if (d.source.kind === 'resize') {
      const endMin = clamp(Math.round(yToMin(y) / SNAP) * SNAP, d.fixedStartMin + SNAP, DAY_MIN)
      return { type: 'slot', dayIdx: d.fixedDayIdx, startMin: d.fixedStartMin, durationMin: endMin - d.fixedStartMin }
    }

    // Бросок на панель «Без даты» — снять с календаря
    const sb = sidebarRef.current
    if (sb && d.source.kind !== 'unscheduled') {
      const r = sb.getBoundingClientRect()
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return { type: 'unschedule' }
    }

    const grect = grid.getBoundingClientRect()
    const left = grect.left + gutterW
    const colW = (grect.width - gutterW) / days.length
    if (colW <= 0 || x < left || x > grect.right) return null
    const dayIdx = clamp(Math.floor((x - left) / colW), 0, days.length - 1)

    const hrect = head.getBoundingClientRect()
    if (y < hrect.bottom) return y >= hrect.top ? { type: 'allday', dayIdx } : null

    const pMin = yToMin(y)
    const dur = Math.min(d.durationMin, DAY_MIN)
    const raw = d.source.kind === 'block' ? Math.round((pMin - d.grabOffsetMin) / SNAP) * SNAP : Math.floor(pMin / SNAP) * SNAP
    const startMin = clamp(raw, 0, DAY_MIN - dur)
    return { type: 'slot', dayIdx, startMin, durationMin: dur }
  }

  const autoScroll = (y: number): void => {
    const sc = scrollRef.current
    const head = headRef.current
    if (!sc || !head) return
    const r = sc.getBoundingClientRect()
    const topEdge = head.getBoundingClientRect().bottom
    if (y > topEdge && y < topEdge + 32) sc.scrollTop -= 16
    else if (y > r.bottom - 32 && y < r.bottom + 80) sc.scrollTop += 16
  }

  // ---------- Обработчики перетаскивания ----------

  const beginDrag = (
    e: React.PointerEvent,
    source: DragSource,
    opts: {
      grabOffsetMin?: number
      durationMin: number
      fixedDayIdx?: number
      fixedStartMin?: number
      origDate?: string
      origStart?: string
      origDur?: number
    },
  ): void => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    clearPressTimer()
    // Мышь тащит сразу; палец — только после короткого удержания (иначе прокрутка дня
    // случайно двигала бы задачу). До удержания движение пальца прокручивает контейнер.
    const immediate = e.pointerType === 'mouse'
    setDrag({
      source,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      active: immediate,
      startScrollTop: scrollElFor(source.kind)?.scrollTop ?? 0,
      scrolled: false,
      grabOffsetMin: opts.grabOffsetMin ?? 0,
      durationMin: opts.durationMin,
      fixedDayIdx: opts.fixedDayIdx ?? 0,
      fixedStartMin: opts.fixedStartMin ?? 0,
      origDate: opts.origDate,
      origStart: opts.origStart,
      origDur: opts.origDur,
      target: null,
    })
    if (!immediate) {
      const pid = e.pointerId
      pressTimerRef.current = window.setTimeout(() => {
        pressTimerRef.current = null
        setDrag((prev) => (prev && prev.pointerId === pid ? { ...prev, active: true } : prev))
        // Тактильный отклик «взял» (где поддерживается)
        navigator.vibrate?.(12)
      }, HOLD_MS)
    }
  }

  const onDragMove = (e: React.PointerEvent): void => {
    if (!drag || e.pointerId !== drag.pointerId) return
    // Не даём событию всплыть к родительскому блоку (ручка ресайза вложена в блок)
    e.stopPropagation()

    // Фаза ожидания удержания: карточка ещё не «взята» — палец прокручивает день.
    if (!drag.active) {
      const dy = e.clientY - drag.startY
      if (!drag.scrolled && Math.hypot(e.clientX - drag.startX, dy) <= PENDING_SLOP) return
      // Повели пальцем раньше, чем сработало удержание → это жест прокрутки на всё касание
      clearPressTimer()
      const sc = scrollElFor(drag.source.kind)
      if (sc) sc.scrollTop = drag.startScrollTop - dy
      if (!drag.scrolled) setDrag((prev) => (prev ? { ...prev, scrolled: true } : prev))
      return
    }

    if (!drag.moved) {
      const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY)
      if (dist <= DRAG_THRESHOLD) return
    }
    autoScroll(e.clientY)
    const target = computeTarget(e.clientX, e.clientY, drag)
    if (drag.moved && targetsEqual(drag.target, target)) return
    setDrag({ ...drag, moved: true, target })
  }

  const onDragUp = (e: React.PointerEvent): void => {
    if (!drag || e.pointerId !== drag.pointerId) return
    e.stopPropagation()
    clearPressTimer()
    const d = drag
    setDrag(null)

    if (d.scrolled) return // это была прокрутка пальцем, а не клик/перетаскивание

    if (!d.moved) {
      // Порог не пройден — это клик (в т.ч. удержание без сдвига)
      if (d.source.kind !== 'resize') onOpenCard(d.source.cardId)
      return
    }

    const t = d.target
    if (!t) return
    const id = d.source.cardId

    if (t.type === 'unschedule') {
      if (d.origDate) store.scheduleCard(id, null)
      return
    }
    if (t.type === 'allday') {
      const date = dayKeys[t.dayIdx]
      if (d.origDate === date && !d.origStart) return
      store.scheduleCard(id, date, null)
      return
    }
    const date = dayKeys[t.dayIdx]
    const time = minToTime(t.startMin)
    if (d.origDate === date && d.origStart === time && d.origDur === t.durationMin) return
    store.scheduleCard(id, date, time, t.durationMin)
  }

  const onDragCancel = (e: React.PointerEvent): void => {
    if (!drag || e.pointerId !== drag.pointerId) return
    e.stopPropagation()
    clearPressTimer()
    setDrag(null)
  }

  const dragEvents = { onPointerMove: onDragMove, onPointerUp: onDragUp, onPointerCancel: onDragCancel }

  const draggedCardId = drag?.moved ? drag.source.cardId : null
  const ghostCard = draggedCardId ? store.card(draggedCardId) : undefined
  // Карточка «взята» после удержания, но ещё не сдвинута — подсвечиваем как приподнятую
  const armedCardId = drag?.active && !drag.moved ? drag.source.cardId : null

  // ---------- Создание карточек одним кликом/тапом ----------

  // Пустой черновик с курсором в поле названия; сразу планируем на дату/время.
  const createCard = (dayIdx: number, startMin: number | null): void => {
    onCreateDraft({ date: dayKeys[dayIdx], start: startMin === null ? null : minToTime(startMin) })
  }

  // Отличаем клик/тап от прокрутки: если палец/курсор сдвинулся больше порога
  // между нажатием и отпусканием — это прокрутка (или перетаскивание), не создаём.
  const TAP_SLOP = 8
  const tapStart = useRef<{ x: number; y: number } | null>(null)
  const isTap = (e: React.PointerEvent): boolean => {
    const s = tapStart.current
    tapStart.current = null
    return !!s && Math.hypot(e.clientX - s.x, e.clientY - s.y) <= TAP_SLOP
  }
  const cancelTap = (): void => {
    tapStart.current = null
  }

  // Часовая сетка дня
  const onColPointerDown = (e: React.PointerEvent): void => {
    tapStart.current =
      e.button === 0 && !(e.target as HTMLElement).closest('.cal-event, .cal-ghost')
        ? { x: e.clientX, y: e.clientY }
        : null
  }
  const onColPointerUp = (dayIdx: number) => (e: React.PointerEvent): void => {
    if ((e.target as HTMLElement).closest('.cal-event, .cal-ghost')) return cancelTap()
    if (!isTap(e)) return
    const grect = gridRef.current?.getBoundingClientRect()
    if (!grect) return
    const pMin = ((e.clientY - grect.top) / HOUR_H) * 60
    createCard(dayIdx, clamp(Math.floor(pMin / SNAP) * SNAP, 0, DAY_MIN - 60))
  }

  // Зона «весь день»
  const onAllDayPointerDown = (e: React.PointerEvent): void => {
    tapStart.current =
      e.button === 0 && !(e.target as HTMLElement).closest('.cal-chip') ? { x: e.clientX, y: e.clientY } : null
  }
  const onAllDayPointerUp = (dayIdx: number) => (e: React.PointerEvent): void => {
    if ((e.target as HTMLElement).closest('.cal-chip')) return cancelTap()
    if (!isTap(e)) return
    createCard(dayIdx, null)
  }

  // ---------- Рендер элементов ----------

  const renderChip = (c: Card): React.ReactNode => {
    const dragging = draggedCardId === c.id && drag?.source.kind === 'allday'
    const armed = armedCardId === c.id && drag?.source.kind === 'allday'
    const overdue = isOverdue(c)
    return (
      <div
        key={c.id}
        className={`cal-chip${c.done ? ' done' : ''}${overdue ? ' overdue' : ''}${dragging ? ' is-dragging' : ''}${armed ? ' armed' : ''}${isMeeting(c) ? ' meeting' : ''}`}
        style={{ '--ev-color': colorOf(c), '--prio-color': priorityStripeColor(c.priority) } as React.CSSProperties}
        title={c.title}
        onPointerDown={(e) =>
          beginDrag(e, { kind: 'allday', cardId: c.id }, { durationMin: 60, origDate: c.date })
        }
        {...dragEvents}
      >
        {!isMeeting(c) && (
          <button
            type="button"
            className={'cal-chip-check' + (c.done ? ' on' : '')}
            title={c.done ? 'Снять отметку' : 'Отметить выполненной'}
            aria-label={c.done ? 'Снять отметку' : 'Отметить выполненной'}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              store.setCardDone(c.id, !c.done)
            }}
          >
            <IcoCheck size={12} color="currentColor" />
          </button>
        )}
        <span className="cal-chip-title">{c.title}</span>
        {assigneesOf(c).length > 0 && (
          <span className="cal-chip-avatars">
            <AvatarStack members={assigneesOf(c)} size="xs" />
          </span>
        )}
      </div>
    )
  }

  const renderEvent = (ev: LaidEvent, dayIdx: number): React.ReactNode => {
    const c = ev.card
    const dur = c.durationMin ?? 60
    const top = (ev.startMin / 60) * HOUR_H
    const height = Math.max(((ev.endMin - ev.startMin) / 60) * HOUR_H - 2, 18)
    const compact = height < 40
    const dragging = draggedCardId === c.id && (drag?.source.kind === 'block' || drag?.source.kind === 'resize')
    const armed = armedCardId === c.id && (drag?.source.kind === 'block' || drag?.source.kind === 'resize')
    const label = timeRange(ev.startMin, ev.startMin + dur)
    const mtg = isMeeting(c)
    // Встречи не отмечают выполненными — они просто «проходят». Прошедшие зачёркиваем.
    const dayKey = dayKeys[dayIdx]
    const meetingPast = mtg && (dayKey < todayKey || (dayKey === todayKey && ev.startMin + dur <= nowMin))
    const overdue = isOverdue(c)
    return (
      <div
        key={c.id}
        className={`cal-event${c.done ? ' done' : ''}${overdue ? ' overdue' : ''}${meetingPast ? ' past' : ''}${compact ? ' compact' : ''}${dragging ? ' is-dragging' : ''}${armed ? ' armed' : ''}${mtg ? ' meeting' : ''}`}
        style={
          {
            top,
            height,
            left: `calc(${(ev.col * 100) / ev.cols}% + 2px)`,
            width: `calc(${100 / ev.cols}% - 5px)`,
            '--ev-color': colorOf(c),
            '--prio-color': priorityStripeColor(c.priority),
          } as React.CSSProperties
        }
        title={`${c.title}\n${label}`}
        onPointerDown={(e) => {
          const grect = gridRef.current?.getBoundingClientRect()
          if (!grect) return
          const pMin = ((e.clientY - grect.top) / HOUR_H) * 60
          beginDrag(
            e,
            { kind: 'block', cardId: c.id },
            {
              grabOffsetMin: pMin - ev.startMin,
              durationMin: dur,
              origDate: c.date,
              origStart: c.start,
              origDur: dur,
            },
          )
        }}
        {...dragEvents}
      >
        <div className="cal-event-toprow">
          {!mtg && (
            // Приоритет теперь показывает полоса слева, здесь остаётся только чекбокс
            <div className="cal-event-left">
              <button
                type="button"
                className={'cal-event-check' + (c.done ? ' on' : '')}
                title={c.done ? 'Снять отметку' : 'Отметить выполненной'}
                aria-label={c.done ? 'Снять отметку' : 'Отметить выполненной'}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  store.setCardDone(c.id, !c.done)
                }}
              >
                <IcoCheck size={13} color="currentColor" />
              </button>
            </div>
          )}
          <div className="cal-event-title">
            {mtg && <span className="cal-meeting-ico inline-ico" aria-hidden><IcoMeeting size={16} /></span>}
            {c.title}
          </div>
        </div>
        <div className="cal-event-time">{label}</div>
        <div className="cal-event-avatars">
          <AvatarStack members={assigneesOf(c)} size="xs" />
        </div>
        <div
          className="cal-event-resize"
          title="Изменить длительность"
          onPointerDown={(e) =>
            beginDrag(
              e,
              { kind: 'resize', cardId: c.id },
              {
                durationMin: dur,
                fixedDayIdx: dayIdx,
                fixedStartMin: ev.startMin,
                origDate: c.date,
                origStart: c.start,
                origDur: dur,
              },
            )
          }
          {...dragEvents}
        />
      </div>
    )
  }

  const renderGhost = (dayIdx: number): React.ReactNode => {
    if (!drag?.moved || drag.target?.type !== 'slot' || drag.target.dayIdx !== dayIdx) return null
    const t = drag.target
    const top = (t.startMin / 60) * HOUR_H
    const height = Math.max((t.durationMin / 60) * HOUR_H - 2, 18)
    return (
      <div className="cal-ghost" style={{ top, height }}>
        <div className={`cal-ghost-tip${top < 28 ? ' below' : ''}`}>
          {timeRange(t.startMin, t.startMin + t.durationMin)}
        </div>
        <div className="cal-ghost-title">{ghostCard?.title ?? ''}</div>
      </div>
    )
  }

  const renderSideCard = (c: Card): React.ReactNode => {
    const dragging = draggedCardId === c.id && drag?.source.kind === 'unscheduled'
    const armed = armedCardId === c.id && drag?.source.kind === 'unscheduled'
    const assignees = assigneesOf(c)
    return (
      <div
        key={c.id}
        className={`cal-side-card${c.done ? ' done' : ''}${dragging ? ' is-dragging' : ''}${armed ? ' armed' : ''}${isMeeting(c) ? ' meeting' : ''}`}
        style={{ '--ev-color': colorOf(c), '--prio-color': priorityStripeColor(c.priority) } as React.CSSProperties}
        onPointerDown={(e) => beginDrag(e, { kind: 'unscheduled', cardId: c.id }, { durationMin: 60 })}
        {...dragEvents}
      >
        <div className="cal-side-title">
          {isMeeting(c) && <span className="inline-ico" aria-hidden><IcoMeeting size={16} /></span>}
          {c.title}
        </div>
        {assignees.length > 0 && (
          <div className="cal-side-meta">
            <AvatarStack members={assignees} size="xs" />
          </div>
        )}
      </div>
    )
  }

  // ---------- Свайп по горизонтали: листать дни (в дополнение к стрелкам) ----------

  const onCalTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) {
      swipeRef.current = null
      return
    }
    const t = e.touches[0]
    // Свайп по событию/чипу/ручке — это перетаскивание, не листание
    const ignore = !!(e.target as HTMLElement).closest('.cal-event, .cal-chip, .cal-side-card, .cal-event-resize')
    swipeRef.current = { x: t.clientX, y: t.clientY, ignore }
  }

  const onCalTouchEnd = (e: React.TouchEvent) => {
    const s = swipeRef.current
    swipeRef.current = null
    if (!s || s.ignore || drag) return
    const t = e.changedTouches[0]
    if (!t) return
    const dx = t.clientX - s.x
    const dy = t.clientY - s.y
    // Явно горизонтальный жест (иначе это вертикальная прокрутка часов)
    if (Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      setAnchor((a) => addDays(a, dx < 0 ? nDays : -nDays))
    }
  }

  // ---------- Разметка ----------

  const hours = Array.from({ length: 24 }, (_, h) => h)

  return (
    <div
      className={`cal-root${drag?.moved ? ' is-dragging' : ''}`}
      style={{ ['--cal-days' as string]: String(nDays), ['--cal-gutter-w' as string]: `${gutterW}px` }}
    >
      <SubHeader
        memberFilter={memberFilter}
        onMemberFilterChange={onMemberFilterChange}
        right={
          timeline ? (
            <button
              className={'btn btn-sm' + (copied ? ' btn-ok' : '')}
              title="Скопировать живую ссылку на таймлайн (сама обновляется, только просмотр)"
              onClick={() => {
                navigator.clipboard.writeText(buildLiveTimelineUrl()).then(() => {
                  setCopied(true)
                  window.setTimeout(() => setCopied(false), 1800)
                })
              }}
            >
              <span className="btn-ico" aria-hidden>
                <IcoLink size={15} />
              </span>
              {copied ? 'Скопировано' : 'Ссылка'}
            </button>
          ) : undefined
        }
      >
        <button className="btn btn-sm" onClick={() => (timeline ? tlRef.current?.scrollToToday() : setAnchor(new Date()))}>
          Сегодня
        </button>
        <select
          className="cal-view-select"
          value={timeline ? 'timeline' : String(nDays)}
          onChange={(e) => {
            const v = e.target.value
            if (v === 'timeline') setTimeline(true)
            else {
              setTimeline(false)
              setNDays(Number(v))
            }
          }}
          title="Как показывать календарь"
          aria-label="Как показывать календарь"
        >
          <option value="1">Сегодня</option>
          <option value="3">3 дня</option>
          <option value="7">Неделя</option>
          <option value="timeline">Таймлайн</option>
        </select>
        {!timeline && (
          <>
            <div className="cal-nav">
              <button
                className="icon-btn"
                title="Назад"
                aria-label="Показать предыдущие дни"
                onClick={() => setAnchor((a) => addDays(a, -nDays))}
              >
                <IcoArrowLeft size={20} />
              </button>
              <button
                className="icon-btn"
                title="Вперёд"
                aria-label="Показать следующие дни"
                onClick={() => setAnchor((a) => addDays(a, nDays))}
              >
                <IcoArrowRight size={20} />
              </button>
            </div>
            <h2 className="cal-title">
              {days.length === 1
                ? fmtFullDate(rangeStart).replace(/\s*г\.\s*$/, '')
                : rangeTitle(rangeStart, days[days.length - 1])}
            </h2>
          </>
        )}
      </SubHeader>

      {timeline ? (
        <TimelineView
          ref={tlRef}
          items={timelineItems}
          interactive
          onOpenCard={onOpenCard}
          onToggleDone={(id, done) => store.setCardDone(id, done)}
        />
      ) : (
      <div className="cal-body">
        {panelOpen ? (
          <aside
            ref={sidebarRef}
            className={`cal-sidebar${drag?.moved && drag.target?.type === 'unschedule' ? ' drop-hint' : ''}`}
          >
            <div className="cal-sidebar-head">
              <span className="cal-sidebar-title">Без даты</span>
              {unscheduled.length > 0 && <span className="cal-count">{unscheduled.length}</span>}
              <button
                className="icon-btn cal-collapse"
                title="Свернуть панель"
                aria-label="Свернуть панель"
                onClick={() => togglePanel(false)}
              >
                <IcoArrowLeft size={18} />
              </button>
            </div>
            <div className="cal-sidebar-list" ref={sidebarListRef}>
              {unscheduled.length === 0 && <div className="cal-sidebar-empty muted">Все задачи запланированы</div>}
              {unscheduledGroups.map((g) => (
                <React.Fragment key={g.col.id}>
                  <div className="cal-side-status">{g.col.title}</div>
                  {g.cards.map(renderSideCard)}
                </React.Fragment>
              ))}
              {unscheduledOther.length > 0 && (
                <React.Fragment>
                  {unscheduledGroups.length > 0 && <div className="cal-side-status">Прочее</div>}
                  {unscheduledOther.map(renderSideCard)}
                </React.Fragment>
              )}
            </div>
            <div className="cal-sidebar-hint muted">Перетащите задачу на день или время</div>
          </aside>
        ) : (
          <aside className="cal-sidebar collapsed">
            <button
              className="icon-btn cal-collapse"
              title="Развернуть панель «Без даты»"
              aria-label="Развернуть панель «Без даты»"
              onClick={() => togglePanel(true)}
            >
              <IcoArrowRight size={18} />
            </button>
            <span className="cal-sidebar-vlabel">
              Без даты{unscheduled.length > 0 ? ` · ${unscheduled.length}` : ''}
            </span>
          </aside>
        )}

        <div className="cal-main" onTouchStart={onCalTouchStart} onTouchEnd={onCalTouchEnd}>
          <div className="cal-scroll" ref={scrollRef}>
            <div className="cal-head" ref={headRef}>
              <div className="cal-head-gutter" />
              {days.map((d, i) => {
                const isToday = dayKeys[i] === todayKey
                const dropHere = drag?.moved && drag.target?.type === 'allday' && drag.target.dayIdx === i
                return (
                  <div key={dayKeys[i]} className={`cal-day-head${isToday ? ' today' : ''}`}>
                    <div className="cal-day-name">
                      <span className="cal-day-wd">{fmtWeekday(d)}</span>
                      <span className="cal-day-num">{d.getDate()}</span>
                    </div>
                    <div
                      className={`cal-allday${dropHere ? ' drop-hint' : ''}`}
                      onPointerDown={onAllDayPointerDown}
                      onPointerUp={onAllDayPointerUp(i)}
                      onPointerCancel={cancelTap}
                      title="Нажмите, чтобы добавить задачу на весь день"
                    >
                      {allDayByDay[i].map(renderChip)}
                      {dropHere && (
                        <div className="cal-chip ghost">
                          <span className="cal-chip-dot" />
                          <span className="cal-chip-title">{ghostCard?.title ?? ''}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="cal-grid" ref={gridRef}>
              <div className="cal-gutter">
                {hours.map((h) => (
                  <div key={h} className={`cal-hour-label${h === 0 ? ' first' : ''}`} style={{ top: h * HOUR_H }}>
                    {String(h).padStart(2, '0')}:00
                  </div>
                ))}
              </div>
              {days.map((_, i) => (
                <div
                  key={dayKeys[i]}
                  className={`cal-day-col${dayKeys[i] === todayKey ? ' today' : ''}`}
                  onPointerDown={onColPointerDown}
                  onPointerUp={onColPointerUp(i)}
                  onPointerCancel={cancelTap}
                >
                  {sleepUntil > 0 && (
                    <div
                      className="cal-sleep-band"
                      style={{ height: sleepUntil * HOUR_H }}
                      title={`Сон до ${String(sleepUntil).padStart(2, '0')}:00`}
                    />
                  )}
                  {layoutDay(timedByDay[i]).map((ev) => renderEvent(ev, i))}
                  {renderGhost(i)}
                  {dayKeys[i] === todayKey && (
                    <div className="cal-now" style={{ top: (nowMin / 60) * HOUR_H }} />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      )}
    </div>
  )
}
