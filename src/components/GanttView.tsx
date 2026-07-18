import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { useBoard } from '../store'
import type { Card, ID, Member } from '../types'
import { addDays, parseDateKey, toDateKey } from '../utils'
import { AvatarStack, ProjectAvatar } from './Avatar'
import { IcoMeeting } from '../icons'
import './gantt.css'

/** Диаграмма Ганта: строки-задачи слева (проект + ответственный + название),
 *  справа — временная шкала по дням с полосой на дне(ях) задачи. Сущности те же,
 *  что и в календаре (задачи, встречи, ответственные, проекты). */
export interface GanttHandle {
  scrollToToday: () => void
}

const DAY_W = 46 // ширина колонки-дня, px (должна совпадать с --gantt-day-w в CSS)
const MAX_DAYS = 120 // ограничение диапазона, чтобы сетка не разрасталась бесконечно
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

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

    // Диапазон дней: охватывает все задачи и сегодня, с запасом по краю; ограничен MAX_DAYS
    const { days, dayKeys } = useMemo(() => {
      const dates = rows.map((r) => r.date!)
      let startKey = today
      let endKey = today
      if (dates.length) {
        const min = dates.reduce((a, b) => (a < b ? a : b))
        const max = dates.reduce((a, b) => (a > b ? a : b))
        startKey = min < today ? min : today
        endKey = max > today ? max : today
      }
      let start = addDays(parseDateKey(startKey), -1)
      const end = addDays(parseDateKey(endKey), 1)
      let count = Math.round((end.getTime() - start.getTime()) / 86400000) + 1
      if (count < 14) count = 14
      if (count > MAX_DAYS) count = MAX_DAYS
      const ds = Array.from({ length: count }, (_, i) => addDays(start, i))
      return { days: ds, dayKeys: ds.map(toDateKey) }
    }, [rows, today])

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

    // Подписи месяцев над шкалой (сегментами по сменам месяца)
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

    if (rows.length === 0) {
      return <div className="gantt-empty muted">Нет запланированных задач — добавьте задачам даты, и они появятся на диаграмме.</div>
    }

    return (
      <div className="gantt-root" ref={scrollRef} style={{ ['--gantt-day-w' as string]: `${DAY_W}px` }}>
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
              const col = idxOf(c.date!)
              const project = projectOf(c)
              const assignees = assigneesOf(c)
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
                    {col >= 0 && (
                      <button
                        type="button"
                        className={'gantt-bar' + (c.done ? ' done' : '')}
                        style={{ left: col * DAY_W + 2, background: colorOf(c) }}
                        title={c.title}
                        onClick={() => onOpenCard(c.id)}
                      >
                        {c.start && <span className="gantt-bar-label">{c.start}</span>}
                      </button>
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
