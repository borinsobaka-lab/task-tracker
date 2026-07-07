import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { TLItem } from '../timelineShare'
import { addDays, fmtDayMonth, fmtWeekday, minToTime, parseDateKey, timeToMin, toDateKey } from '../utils'
import { IcoCheck, IcoMeeting } from '../icons'

export interface TimelineHandle {
  scrollToToday: () => void
}

interface TimelineViewProps {
  items: TLItem[]
  interactive: boolean
  onOpenCard?: (id: string) => void
  onToggleDone?: (id: string, done: boolean) => void
}

const MEETING_COLOR = '#1f2937'

function timeRange(startMin: number, endMin: number): string {
  return `${minToTime(startMin)}–${minToTime(endMin)}`
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase()
}

/**
 * Вертикальная хронология задач. Просроченные закреплены вверху, ниже — сегодня,
 * завтра и будущее с метками дней слева. Используется и в календаре (interactive),
 * и на публичной странице-демонстрации (только просмотр).
 */
export const TimelineView = forwardRef<TimelineHandle, TimelineViewProps>(function TimelineView(
  { items, interactive, onOpenCard, onToggleDone },
  ref,
) {
  const [now, setNow] = useState<Date>(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  const containerRef = useRef<HTMLDivElement>(null)
  const todayRef = useRef<HTMLDivElement>(null)
  useImperativeHandle(ref, () => ({
    scrollToToday: () => {
      if (todayRef.current) todayRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' })
      else containerRef.current?.scrollTo({ top: 0 })
    },
  }))

  const nowMs = now.getTime()
  const todayKey = toDateKey(now)
  const tomorrowKey = toDateKey(addDays(now, 1))
  const startMsOf = (it: TLItem): number => {
    const d = parseDateKey(it.date)
    const [hh, mm] = it.start ? it.start.split(':').map(Number) : [0, 0]
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm).getTime()
  }
  const endMsOf = (it: TLItem): number => {
    if (it.start) return startMsOf(it) + (it.durationMin ?? 60) * 60000
    const d = parseDateKey(it.date)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59).getTime()
  }
  const isMtg = (it: TLItem): boolean => it.kind === 'meeting'

  const overdue = items
    .filter((it) => !it.done && !isMtg(it) && endMsOf(it) < nowMs)
    .sort((a, b) => (a.date + (a.start ?? '')).localeCompare(b.date + (b.start ?? '')))
  const overdueSet = new Set(overdue.map((i) => i.id))
  const future = items.filter((it) => !overdueSet.has(it.id) && it.date >= todayKey)
  const dayKeys = Array.from(new Set(future.map((i) => i.date))).sort()
  const days = dayKeys.map((key) => ({
    key,
    items: future
      .filter((i) => i.date === key)
      .sort((a, b) => (a.start ?? '').localeCompare(b.start ?? '') || a.title.localeCompare(b.title, 'ru')),
  }))
  const dayLabel = (key: string): { name: string; date: string } => {
    const d = parseDateKey(key)
    return { name: key === todayKey ? 'Сегодня' : key === tomorrowKey ? 'Завтра' : fmtWeekday(d), date: fmtDayMonth(d) }
  }

  const renderCard = (it: TLItem, showDate: boolean): React.ReactNode => {
    const mtg = isMtg(it)
    const past = mtg && endMsOf(it) < nowMs // прошедшая встреча — зачёркиваем
    const active = !it.done && !!it.start && startMsOf(it) <= nowMs && nowMs < endMsOf(it)
    const color = mtg ? MEETING_COLOR : it.members[0]?.color ?? 'var(--accent)'
    const cls =
      'tl-card' +
      (it.done ? ' done' : '') +
      (mtg ? ' meeting' : '') +
      (past ? ' past' : '') +
      (active ? ' now' : '') +
      (interactive ? ' clickable' : '')
    const clickProps = interactive
      ? {
          role: 'button',
          tabIndex: 0,
          onClick: () => onOpenCard?.(it.id),
          onKeyDown: (e: React.KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && onOpenCard?.(it.id),
        }
      : {}
    return (
      <div key={it.id} className={cls} style={{ ['--ev-color' as string]: color } as CSSProperties} {...clickProps}>
        <div className="tl-card-left">
          {!mtg &&
            (interactive ? (
              <button
                type="button"
                className={'cal-chip-check' + (it.done ? ' on' : '')}
                title={it.done ? 'Снять отметку' : 'Отметить выполненной'}
                aria-label={it.done ? 'Снять отметку' : 'Отметить выполненной'}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleDone?.(it.id, !it.done)
                }}
              >
                <IcoCheck size={12} color="currentColor" />
              </button>
            ) : (
              <span className={'cal-chip-check readonly' + (it.done ? ' on' : '')} aria-hidden>
                {it.done && <IcoCheck size={12} color="currentColor" />}
              </span>
            ))}
          {it.priorityColor && <span className="cal-event-prio" style={{ background: it.priorityColor }} title="Приоритет" />}
        </div>
        <div className="tl-card-main">
          <div className="tl-card-title">
            {mtg && (
              <span className="inline-ico" aria-hidden>
                <IcoMeeting size={13} />
              </span>
            )}
            {it.title}
          </div>
          <div className="tl-card-sub">
            {active && <span className="tl-now-badge">сейчас</span>}
            {it.start && (
              <span className="tl-time">{timeRange(timeToMin(it.start), timeToMin(it.start) + (it.durationMin ?? 60))}</span>
            )}
            {showDate && <span className="tl-date">{fmtDayMonth(parseDateKey(it.date))}</span>}
            {it.members.length > 0 && (
              <span className="tl-avatars">
                {it.members.map((m, i) => (
                  <span key={i} className="tl-avatar" style={{ background: m.color }} title={m.name}>
                    {initials(m.name)}
                  </span>
                ))}
              </span>
            )}
          </div>
        </div>
      </div>
    )
  }

  const empty = overdue.length === 0 && days.length === 0

  return (
    <div className="cal-timeline" ref={containerRef}>
      <div className="tl-inner">
        {overdue.length > 0 && (
          <div className="tl-day tl-overdue">
            <div className="tl-daylabel">
              <span className="tl-day-name">⚠️</span>
              <span className="tl-day-date">просрочено</span>
            </div>
            <div className="tl-day-cards">{overdue.map((it) => renderCard(it, true))}</div>
          </div>
        )}
        {days.map((g) => {
          const lbl = dayLabel(g.key)
          return (
            <div className="tl-day" key={g.key} ref={g.key === todayKey ? todayRef : undefined}>
              <div className={`tl-daylabel${g.key === todayKey ? ' today' : ''}`}>
                <span className="tl-day-name">{lbl.name}</span>
                <span className="tl-day-date">{lbl.date}</span>
              </div>
              <div className="tl-day-cards">{g.items.map((it) => renderCard(it, false))}</div>
            </div>
          )
        })}
        {empty && <div className="tl-empty muted">Запланированных задач нет 🎉</div>}
      </div>
    </div>
  )
})
