import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useBoard } from '../store'
import type { Card, ID, Member } from '../types'
import { addDays, clamp, parseDateKey, toDateKey } from '../utils'
import { AvatarStack, ProjectAvatar } from './Avatar'
import { IcoMeeting } from '../icons'
import './gantt.css'

/** Диаграмма Ганта: строки-задачи слева (проект + ответственный + название),
 *  справа — временная шкала по дням с полосой от даты начала до даты окончания.
 *  Полосу можно двигать и растягивать на несколько дней (меняет date/endDate).
 *  А протянув от кружка на краю полосы к другой задаче — задать зависимость. */
export interface GanttHandle {
  scrollToToday: () => void
}

const DAY_W = 46 // ширина колонки-дня, px (должна совпадать с --gantt-day-w в CSS)
const ROW_H = 40 // высота дорожки задачи, px (совпадает с .gantt-track height)
const ROW_PITCH = ROW_H // шаг между строками (у .gantt-row нет границ/отступов)
const BAR_CY = 20 // центр полосы по вертикали внутри дорожки (top 8 + высота 24 / 2)
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

// Протягивание зависимости: тянем от кружка на краю полосы к другой задаче.
interface Connect {
  fromId: ID
  fromEnd: 'start' | 'end' // за какой кружок взялись
  pointerId: number
  lx: number // текущая позиция курсора в координатах SVG-слоя
  ly: number
  overId: ID | null // задача под курсором (цель связи)
}

export const GanttView = forwardRef<GanttHandle, { cards: Card[]; onOpenCard: (id: ID) => void }>(
  function GanttView({ cards, onOpenCard }, ref) {
    const store = useBoard()
    const memberById = useMemo(() => new Map(store.members.map((m) => [m.id, m])), [store.members])
    const assigneesOf = (c: Card): Member[] =>
      c.assigneeIds.map((id) => memberById.get(id)).filter((m): m is Member => !!m)
    const projectOf = (c: Card) => (c.projectId ? store.projects.find((p) => p.id === c.projectId) : undefined)
    const isMeeting = (c: Card) => c.kind === 'meeting'
    const colorOf = (c: Card): string =>
      c.done ? '#16a34a' : isMeeting(c) ? '#1f2937' : assigneesOf(c)[0]?.color ?? 'var(--accent)'

    const scrollRef = useRef<HTMLDivElement>(null)
    const svgRef = useRef<SVGSVGElement>(null)
    const today = toDateKey(new Date())
    const [drag, setDrag] = useState<Drag | null>(null)
    const dragRef = useRef<Drag | null>(null)
    dragRef.current = drag
    const [connect, setConnect] = useState<Connect | null>(null)
    const connectRef = useRef<Connect | null>(null)
    connectRef.current = connect
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
    const rowIndex = useMemo(() => new Map(rows.map((c, i) => [c.id, i])), [rows])

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
    const weekendIdx = useMemo(
      () => days.map((d, i) => (d.getDay() === 0 || d.getDay() === 6 ? i : -1)).filter((i) => i >= 0),
      [days],
    )

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

    // Связи-зависимости: рисуем, только если обе задачи есть на диаграмме
    const connectors = useMemo(() => {
      const out: { key: string; x1: number; y1: number; x2: number; y2: number; done: boolean }[] = []
      for (const blocked of rows) {
        const ri = rowIndex.get(blocked.id)
        if (ri === undefined) continue
        for (const blockerId of blocked.blockedBy ?? []) {
          const bi = rowIndex.get(blockerId)
          if (bi === undefined) continue
          const blocker = rows[bi]
          const bEnd = idxOf(blocker.endDate ?? blocker.date!)
          const kStart = idxOf(blocked.date!)
          if (bEnd < 0 || kStart < 0) continue
          out.push({
            key: blockerId + '>' + blocked.id,
            x1: (bEnd + 1) * DAY_W,
            y1: bi * ROW_PITCH + BAR_CY,
            x2: kStart * DAY_W,
            y2: ri * ROW_PITCH + BAR_CY,
            done: !!blocker.done,
          })
        }
      }
      return out
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rows, rowIndex, dayKeys])

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

    // ---------- Протягивание зависимости ----------
    const beginConnect = (c: Card, fromEnd: 'start' | 'end') => (e: React.PointerEvent) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      if (rowIndex.get(c.id) === undefined) return
      let lx = 0
      let ly = 0
      const svg = svgRef.current
      if (svg) {
        const r = svg.getBoundingClientRect()
        lx = e.clientX - r.left
        ly = e.clientY - r.top
      }
      setConnect({ fromId: c.id, fromEnd, pointerId: e.pointerId, lx, ly, overId: null })
    }
    useEffect(() => {
      const move = (e: PointerEvent) => {
        const cn = connectRef.current
        if (!cn || e.pointerId !== cn.pointerId) return
        const svg = svgRef.current
        if (!svg) return
        const r = svg.getBoundingClientRect()
        const lx = e.clientX - r.left
        const ly = e.clientY - r.top
        let overId: ID | null = null
        const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
        const holder = el && el.closest ? (el.closest('[data-card-id]') as HTMLElement | null) : null
        const id = holder?.getAttribute('data-card-id')
        if (id && id !== cn.fromId) overId = id
        setConnect({ ...cn, lx, ly, overId })
      }
      const up = (e: PointerEvent) => {
        const cn = connectRef.current
        if (!cn || e.pointerId !== cn.pointerId) return
        if (cn.overId && cn.overId !== cn.fromId) {
          // конец полосы → «эта блокирует ту»; начало полосы → «та блокирует эту»
          if (cn.fromEnd === 'end') store.addDependency(cn.fromId, cn.overId)
          else store.addDependency(cn.overId, cn.fromId)
        }
        // Клик по полосе после протягивания не возникает (pointerdown был на кружке,
        // а не на полосе), поэтому гасить click тут не нужно — иначе «съедался» бы
        // следующий честный клик по любой задаче.
        setConnect(null)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
      return () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rows, rowIndex])

    // Начальная точка протягиваемой связи (в координатах SVG-слоя)
    const connectSrc = useMemo(() => {
      if (!connect) return null
      const i = rowIndex.get(connect.fromId)
      if (i === undefined) return null
      const c = rows[i]
      const x = connect.fromEnd === 'end' ? (idxOf(c.endDate ?? c.date!) + 1) * DAY_W : idxOf(c.date!) * DAY_W
      return { x, y: i * ROW_PITCH + BAR_CY }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [connect, rows, rowIndex, dayKeys])

    const totalH = rows.length * ROW_PITCH

    if (rows.length === 0) {
      return <div className="gantt-empty muted">Нет запланированных задач — добавьте задачам даты, и они появятся на диаграмме.</div>
    }

    const elbow = (x1: number, y1: number, x2: number, y2: number) => {
      const hx = x1 + 11
      return `M${x1},${y1} L${hx},${y1} L${hx},${y2} L${x2},${y2}`
    }

    return (
      <div
        className={'gantt-root' + (drag ? ' dragging' : '') + (connect ? ' connecting' : '')}
        ref={scrollRef}
        style={{ ['--gantt-day-w' as string]: `${DAY_W}px` }}
      >
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
              const isTarget = connect?.overId === c.id
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
                    {/* Подсветка выходных */}
                    {weekendIdx.map((i) => (
                      <div key={'we' + i} className="gantt-weekend" style={{ left: i * DAY_W }} />
                    ))}
                    {/* Красная полоска «сегодня» */}
                    {todayIdx >= 0 && <div className="gantt-today-line" style={{ left: todayIdx * DAY_W }} />}
                    {has && (
                      <>
                        <div
                          className={
                            'gantt-bar' + (c.done ? ' done' : '') + (dr ? ' active' : '') + (isTarget ? ' dep-target' : '')
                          }
                          data-card-id={c.id}
                          style={{
                            left: startIdx * DAY_W + 2,
                            width: (endIdx - startIdx + 1) * DAY_W - 4,
                            backgroundColor: colorOf(c),
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
                            if (!dragRef.current && !connectRef.current) onOpenCard(c.id)
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
                        {/* Название задачи справа от полосы */}
                        <span
                          className={'gantt-bar-name' + (c.done ? ' done' : '')}
                          style={{ left: (endIdx + 1) * DAY_W + 8 }}
                        >
                          {c.title}
                        </span>
                        {/* Кружки-порты для протягивания зависимости */}
                        <span
                          className="gantt-dot gantt-dot-l"
                          data-card-id={c.id}
                          style={{ left: startIdx * DAY_W + 2 }}
                          onPointerDown={beginConnect(c, 'start')}
                          title="Протяните к другой задаче, чтобы задать зависимость"
                        />
                        <span
                          className="gantt-dot gantt-dot-r"
                          data-card-id={c.id}
                          style={{ left: (endIdx + 1) * DAY_W - 2 }}
                          onPointerDown={beginConnect(c, 'end')}
                          title="Протяните к другой задаче, чтобы задать зависимость"
                        />
                      </>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Слой связей-зависимостей поверх дорожек */}
            <svg
              className="gantt-connectors"
              ref={svgRef}
              width={gridW}
              height={totalH}
              viewBox={`0 0 ${gridW} ${totalH}`}
            >
              <defs>
                <marker id="gantt-arrow" markerWidth="7" markerHeight="7" refX="5.5" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 Z" fill="#f59e0b" />
                </marker>
                <marker id="gantt-arrow-done" markerWidth="7" markerHeight="7" refX="5.5" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 Z" fill="#16a34a" />
                </marker>
              </defs>
              {connectors.map((c) => (
                <path
                  key={c.key}
                  d={elbow(c.x1, c.y1, c.x2, c.y2)}
                  className={'gantt-conn' + (c.done ? ' done' : '')}
                  markerEnd={`url(#${c.done ? 'gantt-arrow-done' : 'gantt-arrow'})`}
                />
              ))}
              {connect && connectSrc && (
                <line
                  className="gantt-conn-drag"
                  x1={connectSrc.x}
                  y1={connectSrc.y}
                  x2={connect.lx}
                  y2={connect.ly}
                />
              )}
            </svg>
          </div>
        </div>
      </div>
    )
  },
)
