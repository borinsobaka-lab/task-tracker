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
  /** 'compact' — внутри приложения (просрочка закреплена сверху);
   *  'widget' — внешняя полоса: хронология, текущая задача прокручена наверх. */
  variant?: 'compact' | 'widget'
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

interface Section {
  key: string
  isOverdueBlock?: boolean
  overdue?: boolean
  showDate?: boolean
  items: TLItem[]
}

/**
 * Вертикальная хронология задач. Два режима: компактный (в приложении) и
 * «виджет» — сплошная лента с автопрокруткой к текущей задаче.
 */
export const TimelineView = forwardRef<TimelineHandle, TimelineViewProps>(function TimelineView(
  { items, interactive, variant = 'compact', onOpenCard, onToggleDone },
  ref,
) {
  const [now, setNow] = useState<Date>(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  const containerRef = useRef<HTMLDivElement>(null)
  const todayRef = useRef<HTMLDivElement>(null)
  const currentRef = useRef<HTMLDivElement>(null)
  const lastScrolled = useRef<string | null>(null)
  useImperativeHandle(ref, () => ({
    scrollToToday: () => {
      const target = currentRef.current ?? todayRef.current
      if (target) target.scrollIntoView({ block: 'start', behavior: 'smooth' })
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
  const byStart = (a: TLItem, b: TLItem) =>
    (a.start ?? '').localeCompare(b.start ?? '') || a.title.localeCompare(b.title, 'ru')
  const groupByDay = (list: TLItem[]): { key: string; items: TLItem[] }[] => {
    const keys = Array.from(new Set(list.map((i) => i.date))).sort()
    return keys.map((key) => ({ key, items: list.filter((i) => i.date === key).sort(byStart) }))
  }
  const dayLabel = (key: string): { name: string; date: string } => {
    const d = parseDateKey(key)
    return { name: key === todayKey ? 'Сегодня' : key === tomorrowKey ? 'Завтра' : fmtWeekday(d), date: fmtDayMonth(d) }
  }

  // Текущая (или ближайшая невыполненная) задача — к ней прокручиваем в режиме «виджет».
  let currentId: string | null = null
  let sections: Section[] = []

  if (variant === 'widget') {
    // Хронология: просроченные (прошлые дни, невыполненные) + сегодня и будущее.
    const kept = items.filter((it) => it.date >= todayKey || (!it.done && !isMtg(it)))
    sections = groupByDay(kept).map((g) => ({ ...g, overdue: g.key < todayKey }))
    const chron = kept
      .slice()
      .sort((a, b) => (a.date + (a.start ?? '')).localeCompare(b.date + (b.start ?? '')))
    currentId = chron.find((it) => !it.done && endMsOf(it) >= nowMs)?.id ?? null
  } else {
    const overdue = items
      .filter((it) => !it.done && !isMtg(it) && endMsOf(it) < nowMs)
      .sort((a, b) => (a.date + (a.start ?? '')).localeCompare(b.date + (b.start ?? '')))
    const overdueSet = new Set(overdue.map((i) => i.id))
    const future = items.filter((it) => !overdueSet.has(it.id) && it.date >= todayKey)
    if (overdue.length) sections.push({ key: '__overdue__', isOverdueBlock: true, showDate: true, items: overdue })
    for (const g of groupByDay(future)) sections.push(g)
  }

  // В режиме «виджет» ставим текущую задачу наверх (предыдущие — выше, скрыты).
  useEffect(() => {
    if (variant !== 'widget') return
    if (currentId && currentRef.current && lastScrolled.current !== currentId) {
      currentRef.current.scrollIntoView({ block: 'start' })
      lastScrolled.current = currentId
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, currentId, items])

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
      <div
        key={it.id}
        ref={it.id === currentId ? currentRef : undefined}
        className={cls}
        style={{ ['--ev-color' as string]: color } as CSSProperties}
        {...clickProps}
      >
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
            {variant !== 'widget' && it.members.length > 0 && (
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

  return (
    <div className="cal-timeline" ref={containerRef}>
      <div className="tl-inner">
        {sections.map((sec) =>
          sec.isOverdueBlock ? (
            <div className="tl-day tl-overdue" key={sec.key}>
              <div className="tl-daylabel">
                <span className="tl-day-name">⚠️</span>
                <span className="tl-day-date">просрочено</span>
              </div>
              <div className="tl-day-cards">{sec.items.map((it) => renderCard(it, !!sec.showDate))}</div>
            </div>
          ) : (
            <div className="tl-day" key={sec.key} ref={sec.key === todayKey ? todayRef : undefined}>
              <div className={`tl-daylabel${sec.key === todayKey ? ' today' : ''}${sec.overdue ? ' overdue' : ''}`}>
                <span className="tl-day-name">{dayLabel(sec.key).name}</span>
                <span className="tl-day-date">{dayLabel(sec.key).date}</span>
              </div>
              <div className="tl-day-cards">{sec.items.map((it) => renderCard(it, !!sec.showDate))}</div>
            </div>
          ),
        )}
        {sections.length === 0 && <div className="tl-empty muted">Запланированных задач нет 🎉</div>}
      </div>
    </div>
  )
})
