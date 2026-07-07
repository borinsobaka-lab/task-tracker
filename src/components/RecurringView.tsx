import { useState } from 'react'
import type { CSSProperties } from 'react'
import { useBoard } from '../store'
import type { SeriesInput } from '../store'
import type { Card, ID, Member, RecurFreq, RecurrenceRule, Series } from '../types'
import { describeRule, ruleIsValid } from '../recurrence'
import { fmtDayMonth, parseDateKey } from '../utils'
import { IcoCheck, IcoClose, IcoOpen, IcoRecurring } from '../icons'
import { Avatar, AvatarStack } from './Avatar'
import { RichTextEditor } from './RichTextEditor'
import { RecurrenceFields } from './RecurrenceFields'
import './recurring.css'

const DURATIONS: { v: number; label: string }[] = [
  { v: 30, label: '30 мин' },
  { v: 60, label: '1 ч' },
  { v: 90, label: '1.5 ч' },
  { v: 120, label: '2 ч' },
  { v: 180, label: '3 ч' },
  { v: 240, label: '4 ч' },
]

export function RecurringView({
  memberFilter,
  onOpenCard,
}: {
  memberFilter: ReadonlySet<ID>
  onOpenCard: (id: ID) => void
}) {
  const store = useBoard()
  const [editing, setEditing] = useState<Series | 'new' | null>(null)

  const inFilter = (c: Card) => memberFilter.size === 0 || c.assigneeIds.some((id) => memberFilter.has(id))
  // Раздел «Регулярное» — только задачи; повторяющиеся встречи живут в календаре
  const insts = store.recurringCards().filter((c) => c.kind !== 'meeting' && inFilter(c))
  const active = insts
    .filter((c) => !c.done)
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.title.localeCompare(b.title, 'ru'))
  const completed = insts.filter((c) => c.done).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))

  const memberById = new Map(store.members.map((m) => [m.id, m]))
  const assigneesOf = (c: Card): Member[] =>
    c.assigneeIds.map((id) => memberById.get(id)).filter((m): m is Member => !!m)

  const openEdit = (c: Card) => {
    const s = c.seriesId ? store.seriesById(c.seriesId) : undefined
    if (s) setEditing(s)
  }

  return (
    <div className="rec-root">
      <div className="rec-toolbar">
        <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>
          + Регулярная задача
        </button>
        <span className="rec-hint muted">Повторяющиеся задачи: выполнил — появляется следующая</span>
      </div>

      <div className="rec-list">
        {active.length === 0 && completed.length === 0 && (
          <div className="rec-empty muted">Пока нет регулярных задач. Нажмите «+ Регулярная задача».</div>
        )}

        {active.map((c) => (
          <RecRow key={c.id} card={c} rule={store.seriesById(c.seriesId!)?.rule} members={assigneesOf(c)} onEdit={() => openEdit(c)} onToggle={() => store.setCardDone(c.id, true)} onOpenCard={onOpenCard} />
        ))}

        {completed.length > 0 && <div className="rec-sep">Выполненные</div>}
        {completed.map((c) => (
          <RecRow key={c.id} card={c} rule={store.seriesById(c.seriesId!)?.rule} members={assigneesOf(c)} done onEdit={() => openEdit(c)} onToggle={() => store.setCardDone(c.id, false)} onOpenCard={onOpenCard} />
        ))}
      </div>

      {editing && (
        <RecurringEditor
          series={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function RecRow({
  card,
  rule,
  members,
  done,
  onEdit,
  onToggle,
  onOpenCard,
}: {
  card: Card
  rule?: RecurrenceRule
  members: Member[]
  done?: boolean
  onEdit: () => void
  onToggle: () => void
  onOpenCard: (id: ID) => void
}) {
  let dateLabel = ''
  if (card.date) {
    dateLabel = fmtDayMonth(parseDateKey(card.date))
    if (card.start) dateLabel += `, ${card.start}`
  }
  return (
    <div
      className={'rec-row' + (done ? ' done' : '')}
      style={members[0] ? ({ ['--rec-color' as string]: members[0].color } as CSSProperties) : undefined}
    >
      <button
        type="button"
        className={'rec-check' + (done ? ' on' : '')}
        title={done ? 'Вернуть в невыполненные' : 'Отметить выполненной'}
        aria-label={done ? 'Вернуть в невыполненные' : 'Отметить выполненной'}
        onClick={onToggle}
      >
        <IcoCheck size={17} color="currentColor" />
      </button>
      <button className="rec-body" onClick={onEdit} title="Настроить повторение">
        <div className="rec-title">
          <span className="inline-ico" aria-hidden><IcoRecurring size={15} /></span>
          {card.title}
        </div>
        <div className="rec-meta">
          {dateLabel && <span className="rec-date">{dateLabel}</span>}
          {rule && <span className="rec-rule">{describeRule(rule)}</span>}
        </div>
      </button>
      <div className="rec-right">
        {members.length > 0 && <AvatarStack members={members} size="sm" />}
        <button className="icon-btn rec-open" title="Открыть в календаре" aria-label="Открыть карточку" onClick={() => onOpenCard(card.id)}>
          <IcoOpen size={16} />
        </button>
      </div>
    </div>
  )
}

// ---------- Редактор серии ----------

function RecurringEditor({ series, onClose }: { series: Series | null; onClose: () => void }) {
  const store = useBoard()
  const [title, setTitle] = useState(series?.title ?? '')
  const [description, setDescription] = useState(series?.description ?? '')
  const [assignees, setAssignees] = useState<ID[]>(series?.assigneeIds ?? [])
  const [freq, setFreq] = useState<RecurFreq>(series?.rule.freq ?? 'weekly')
  const [weekdays, setWeekdays] = useState<number[]>(series?.rule.weekdays ?? [new Date().getDay()])
  const [monthdays, setMonthdays] = useState<number[]>(series?.rule.monthdays ?? [new Date().getDate()])
  const [hasTime, setHasTime] = useState(!!series?.start)
  const [time, setTime] = useState(series?.start ?? '10:00')
  const [duration, setDuration] = useState(series?.durationMin ?? 60)
  const [error, setError] = useState<string | null>(null)

  const buildRule = (): RecurrenceRule => {
    if (freq === 'weekly') return { freq, weekdays }
    if (freq === 'monthly') return { freq, monthdays }
    return { freq: 'daily' }
  }

  const save = () => {
    if (!title.trim()) return setError('Введите название.')
    const rule = buildRule()
    if (!ruleIsValid(rule)) {
      return setError(freq === 'weekly' ? 'Выберите хотя бы один день недели.' : 'Выберите хотя бы одно число месяца.')
    }
    const input: SeriesInput = {
      title,
      description,
      assigneeIds: assignees,
      rule,
      ...(hasTime ? { start: time, durationMin: duration } : {}),
    }
    if (series) store.updateSeries(series.id, input)
    else store.addSeries(input)
    onClose()
  }

  const remove = () => {
    if (!series) return
    if (confirm('Удалить регулярную задачу? Её будущие и активные повторения исчезнут.')) {
      store.deleteSeries(series.id)
      onClose()
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal rec-editor" role="dialog" aria-modal="true">
        <header className="rec-editor-head">
          <h3>{series ? 'Регулярная задача' : 'Новая регулярная задача'}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <IcoClose size={20} />
          </button>
        </header>

        <label className="field-label">Название</label>
        <input className="input" placeholder="Например: Планёрка" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} />

        <label className="field-label" style={{ marginTop: 14 }}>
          Описание
        </label>
        <RichTextEditor value={description} onChange={setDescription} placeholder="Добавьте описание… (появится в задаче в календаре)" />

        <label className="field-label" style={{ marginTop: 14 }}>
          Ответственные
        </label>
        <div className="rec-members">
          {store.members.length === 0 && <span className="muted">Сначала добавьте участников в настройках.</span>}
          {store.members.map((m) => {
            const on = assignees.includes(m.id)
            return (
              <button
                key={m.id}
                type="button"
                className={'rec-member' + (on ? ' on' : '')}
                onClick={() => setAssignees(on ? assignees.filter((x) => x !== m.id) : [...assignees, m.id])}
              >
                <Avatar member={m} size="sm" />
                {m.name}
                {on && <span className="rec-member-check"><IcoCheck size={15} /></span>}
              </button>
            )
          })}
        </div>

        <label className="field-label" style={{ marginTop: 14 }}>
          Повторять
        </label>
        <RecurrenceFields
          freq={freq}
          setFreq={setFreq}
          weekdays={weekdays}
          setWeekdays={setWeekdays}
          monthdays={monthdays}
          setMonthdays={setMonthdays}
        />

        <label className="rec-time-toggle" style={{ marginTop: 14 }}>
          <input type="checkbox" checked={hasTime} onChange={(e) => setHasTime(e.target.checked)} />
          Указать время (иначе задача закрепляется вверху дня в календаре)
        </label>
        {hasTime && (
          <div className="rec-time-row">
            <input type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} />
            <select className="input" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {DURATIONS.map((d) => (
                <option key={d.v} value={d.v}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {error && <div className="login-error" style={{ marginTop: 12 }}>{error}</div>}

        <div className="rec-editor-actions">
          {series && (
            <button className="btn btn-danger" onClick={remove}>
              Удалить
            </button>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="btn" onClick={onClose}>
              Отмена
            </button>
            <button className="btn btn-primary" onClick={save}>
              Сохранить
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
