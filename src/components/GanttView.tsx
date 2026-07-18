import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useBoard } from '../store'
import type { Card, ID, Member } from '../types'
import { addDays, clamp, parseDateKey, toDateKey } from '../utils'
import { AvatarStack, ProjectAvatar } from './Avatar'
import { IcoMeeting } from '../icons'
import './gantt.css'

/** Диаграмма Ганта: строки-задачи слева (проект + ответственный + название),
 *  справа — временная шкала по дням с полосой от даты начала до даты окончания.
 *  Полосу можно двигать и растягивать на несколько дней (меняет date/endDate). */
export interface GanttHandle {
  scrollToToday: () => void
}

const DAY_W = 46 // ширина колонки-дня, px (должна совпадать с --gantt-day-w в CSS)
const MAX_DAYS = 180
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

type DragMode = 'move' | 'resize-l' | 'resize-r'
interface Drag {
  cardId: ID
  mode: DragMode
  pointerId: number
  startX: number
  origStart: number
  origEnd: number
  curStart: number
  curEnd: number
  moved: boolean
}

export const GanttView = forwardRef<GanttHandle, { cards: Card[]; onOpenCard: (id: ID) => void }>(
  function GanttView({ cards, onOpenCard }, ref) {
    const store = useBoard()
    const memberById = useMemo(() => new Map(store.members.map((m) => [m.id, m])), [store.members])
    const assigneesOf = (c: Card): Member[] =>
      c.assigneeIds.map((id) => memberById.get(id)).filter((m): m is Member => !!m)
    const projectOf = (c: Card) => (c.projectId ? store.projects.find((p) => p.id === c.projectId) : undefined)
    const isMeeting = (c: Card) => c.kind === 'meeting'
    const colorOf = (c: Card): string => (isMeeting(c) ? '#1f2937' : assigneesOf(c)[0]?.color ?? 'var(--accent)')

    const scrollRef = useRef<HTMLDivElement>(null)
    const today = toDateKey(new Date())
    const [drag, setDrag] = useState<Drag | null>(null)
    const dragRef = useRef<Drag | null>(null)
    dragRef.current = drag
    // Гасим клик, который браузер шлёт сразу после перетаскивания (иначе открывалась бы карточка)
    const suppressClickRef = useRef(false)

    // Строки — только задачи/встречи с датой, по возрастанию даты и времени
    const rows = useMemo(
      () =>
        cards
          .filter((c) => !!c.date)
          .sort((a, b) =>
            a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : (a.start ?? '').localeCompare(b.start ?? ''),
          ),
      [cards],
    )

    // Диапазон дней: охватывает все даты (включая окончания) и сегодня, с запасом
    const { days, dayKeys } = useMemo(() => {
      const starts = rows.map((r) => r.date!)
      const ends = rows.map((r) => r.endDate ?? r.date!)
      let startKey = today
      let endKey = today
      if (rows.length) {
        const min = starts.reduce((a, b) => (a < b ? a : b))
        const max = ends.reduce((a, b) => (a > b ? a : b))
        startKey = min < today ? min : today
        endKey = max > today ? max : today
      }
      const start = addDays(parseDateKey(startKey), -1)
      const end = addDays(parseDateKey(endKey), 2)
      let count = Math.round((end.getTime() - start.getTime()) / 86400000) + 1
      if (count < 14) count = 14
      if (count > MAX_DAYS) count = MAX_DAYS
      const ds = Array.from({ length: count }, (_, i) => addDays(start, i))
      return { days: ds, dayKeys: ds.map(toDateKey) }
    }, [rows, today])

    const lastIdx = days.length - 1
    const todayIdx = dayKeys.indexOf(today)
    const idxOf = (key: string) => dayKeys.indexOf(key)
    const gridW = days.length * DAY_W

    const centerToday = () => {
      const el = scrollRef.current
      if (!el || todayIdx < 0) return
      el.scrollLeft = Math.max(0, todayIdx * DAY_W - el.clientWidth / 2)
    }
    useImperativeHandle(ref, () => ({ scrollToToday: centerToday }))
    useEffect(() => {
      centerToday()
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Подписи месяцев над шкалой
    const monthSegments = useMemo(() => {
      const segs: { label: string; span: number }[] = []
      days.forEach((d) => {
        const label = `${MON[d.getMonth()]} ${d.getFullYear() % 100}`
        const last = segs[segs.length - 1]
        if (last && last.label === label) last.span += 1
        else segs.push({ label, span: 1 })
      })
      return segs
    }, [days])

    // ---------- Перетаскивание/растягивание полосы ----------
    const beginDrag = (c: Card, mode: DragMode) => (e: React.PointerEvent) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const s = idxOf(c.date!)
      const en = idxOf(c.endDate ?? c.date!)
      if (s < 0) return
      const end = en < 0 ? s : en
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      setDrag({ cardId: c.id, mode, pointerId: e.pointerId, startX: e.clientX, origStart: s, origEnd: end, curStart: s, curEnd: end, moved: false })
    }
    const onDragMove = (e: React.PointerEvent) => {
      const d = dragRef.current
      if (!d || e.pointerId !== d.pointerId) return
      const delta = Math.round((e.clientX - d.startX) / DAY_W)
      let curStart = d.origStart
      let curEnd = d.origEnd
      if (d.mode === 'move') {
        const dd = clamp(delta, -d.origStart, lastIdx - d.origEnd)
        curStart = d.origStart + dd
        curEnd = d.origEnd + dd
      } else if (d.mode === 'resize-l') {
        curStart = clamp(d.origStart + delta, 0, d.origEnd)
      } else {
        curEnd = clamp(d.origEnd + delta, d.origStart, lastIdx)
      }
      if (curStart === d.curStart && curEnd === d.curEnd && (d.moved || delta === 0)) return
      setDrag({ ...d, curStart, curEnd, moved: d.moved || delta !== 0 })
    }
    const endDrag = (e: React.PointerEvent) => {
      const d = dragRef.current
      if (!d || e.pointerId !== d.pointerId) return
      e.stopPropagation()
      if (d.moved) suppressClickRef.current = true
      setDrag(null)
      if (d.moved && (d.curStart !== d.origStart || d.curEnd !== d.origEnd)) {
        store.setCardSpan(d.cardId, dayKeys[d.curStart], dayKeys[d.curEnd])
      }
    }
    // Страховка на уровне window — если capture потеряется, drag не зависнет
    useEffect(() => {
      const release = (e: PointerEvent) => {
        const d = dragRef.current
        if (!d || e.pointerId !== d.pointerId) return
        setTimeout(() => {
          const d2 = dragRef.current
          if (d2 && d2.pointerId === e.pointerId) {
            if (d2.moved) suppressClickRef.current = true
            if (e.type === 'pointerup' && d2.moved && (d2.curStart !== d2.origStart || d2.curEnd !== d2.origEnd)) {
              store.setCardSpan(d2.cardId, dayKeys[d2.curStart], dayKeys[d2.curEnd])
            }
            setDrag(null)
          }
        }, 0)
      }
      window.addEventListener('pointerup', release)
      window.addEventListener('pointercancel', release)
      return () => {
        window.removeEventListener('pointerup', release)
        window.removeEventListener('pointercancel', release)
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dayKeys])

    if (rows.length === 0) {
      return <div className="gantt-empty muted">Нет запланированных задач — добавьте задачам даты, и они появятся на диаграмме.</div>
    }

    return (
      <div className={'gantt-root' + (drag ? ' dragging' : '')} ref={scrollRef} style={{ ['--gantt-day-w' as string]: `${DAY_W}px` }}>
        <div className="gantt-inner">
          {/* Подписи месяцев */}
          <div className="gantt-months">
            <div className="gantt-left gantt-corner" />
            <div className="gantt-months-track" style={{ width: gridW }}>
              {monthSegments.map((s, i) => (
                <div key={i} className="gantt-month" style={{ width: s.span * DAY_W }}>
                  {s.label}
                </div>
              ))}
            </div>
          </div>

          {/* Дни */}
          <div className="gantt-head">
            <div className="gantt-left gantt-corner">Задача</div>
            <div className="gantt-days" style={{ width: gridW }}>
              {days.map((d, i) => {
                const weekend = d.getDay() === 0 || d.getDay() === 6
                return (
                  <div
                    key={dayKeys[i]}
                    className={'gantt-day' + (dayKeys[i] === today ? ' today' : '') + (weekend ? ' weekend' : '')}
                  >
                    <div className="gantt-day-wd">{WD[d.getDay()]}</div>
                    <div className="gantt-day-num">{d.getDate()}</div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Строки-задачи */}
          <div className="gantt-body">
            {rows.map((c) => {
              const project = projectOf(c)
              const assignees = assigneesOf(c)
              const dr = drag && drag.cardId === c.id ? drag : null
              const startIdx = dr ? dr.curStart : idxOf(c.date!)
              const endIdx = dr ? dr.curEnd : idxOf(c.endDate ?? c.date!)
              const has = startIdx >= 0 && endIdx >= 0
              return (
                <div key={c.id} className="gantt-row">
                  <div className="gantt-left">
                    {project && <ProjectAvatar project={project} size="xs" />}
                    {assignees.length > 0 && <AvatarStack members={assignees} size="xs" />}
                    <span className={'gantt-task-title' + (c.done ? ' done' : '')} title={c.title}>
                      {isMeeting(c) && (
                        <span className="inline-ico" aria-hidden>
                          <IcoMeeting size={13} />
                        </span>
                      )}
                      {c.title}
                    </span>
                  </div>
                  <div className="gantt-track" style={{ width: gridW }}>
                    {todayIdx >= 0 && <div className="gantt-today-line" style={{ left: todayIdx * DAY_W }} />}
                    {has && (
                      <div
                        className={'gantt-bar' + (c.done ? ' done' : '') + (dr ? ' active' : '')}
                        style={{
                          left: startIdx * DAY_W + 2,
                          width: (endIdx - startIdx + 1) * DAY_W - 4,
                          background: colorOf(c),
                        }}
                        title={c.title}
                        onPointerDown={beginDrag(c, 'move')}
                        onPointerMove={onDragMove}
                        onPointerUp={endDrag}
                        onPointerCancel={endDrag}
                        onClick={() => {
                          if (suppressClickRef.current) {
                            suppressClickRef.current = false
                            return
                          }
                          if (!dragRef.current) onOpenCard(c.id)
                        }}
                      >
                        <span
                          className="gantt-handle gantt-handle-l"
                          onPointerDown={beginDrag(c, 'resize-l')}
                          onClick={(e) => e.stopPropagation()}
                        />
                        {c.start && !c.endDate && <span className="gantt-bar-label">{c.start}</span>}
                        <span
                          className="gantt-handle gantt-handle-r"
                          onPointerDown={beginDrag(c, 'resize-r')}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  },
)
