// Быстрое добавление задачи на мобильном: компактный лист над клавиатурой.
// Поля: заголовок, описание, приоритет, статус (колонка), дата, ответственный.
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useBoard } from '../store'
import type { Card, EisenhowerQuadrant, ID } from '../types'
import { QUADRANT_COLOR, QUADRANTS } from '../eisenhower'
import { fmtDayMonth, parseDateKey } from '../utils'
import { IcoCheck } from '../icons'
import { Avatar } from './Avatar'

/** Простой текст → безопасный HTML для поля описания (переносы строк → <br>). */
function textToHtml(text: string): string {
  const t = text.trim()
  if (!t) return ''
  const esc = t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return '<p>' + esc.replace(/\n/g, '<br>') + '</p>'
}

/** Высота клавиатуры снизу — чтобы лист стоял ровно над ней (visualViewport). */
function useKeyboardOffset(): number {
  const [offset, setOffset] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => setOffset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop))
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])
  return offset
}

type Pop = null | 'prio' | 'status' | 'date' | 'who'

export function QuickAddSheet({ onClose }: { onClose: () => void }) {
  const store = useBoard()
  const columns = store.columns.filter((c) => !c.deleted)
  const todoCol = columns.find((c) => c.role === 'todo') ?? columns[0]
  const members = store.members

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<EisenhowerQuadrant | undefined>(undefined)
  const [columnId, setColumnId] = useState<ID>(todoCol?.id ?? '')
  const [date, setDate] = useState('')
  const [assigneeIds, setAssigneeIds] = useState<ID[]>([])
  const [pop, setPop] = useState<Pop>(null)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const offset = useKeyboardOffset()

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  const canSubmit = title.trim() !== '' || description.trim() !== ''
  const column = columns.find((c) => c.id === columnId)
  const chosen = assigneeIds.map((id) => members.find((m) => m.id === id)).filter((m): m is NonNullable<typeof m> => !!m)

  const submit = () => {
    if (!canSubmit || !columnId) return
    const id = store.addCard(columnId, title.trim())
    const patch: Partial<Card> = {}
    const html = textToHtml(description)
    if (html) patch.description = html
    if (date) patch.date = date
    if (assigneeIds.length) patch.assigneeIds = assigneeIds
    if (Object.keys(patch).length) store.updateCard(id, patch)
    if (priority) store.setPriority(id, priority)
    onClose()
  }

  const autogrow = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 140) + 'px'
  }

  return (
    <div className="qa-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="qa-sheet" style={{ bottom: offset } as CSSProperties}>
        <textarea
          ref={titleRef}
          className="qa-title"
          placeholder="Что нужно сделать?"
          value={title}
          rows={1}
          onChange={(e) => {
            setTitle(e.target.value)
            autogrow(e.target)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <textarea
          className="qa-desc"
          placeholder="Описание"
          value={description}
          rows={1}
          onChange={(e) => {
            setDescription(e.target.value)
            autogrow(e.target)
          }}
        />

        <div className="qa-controls">
          <button type="button" className={'qa-chip' + (priority ? ' on' : '')} onClick={() => setPop(pop === 'prio' ? null : 'prio')}>
            <span className="qa-dot" style={{ background: priority ? QUADRANT_COLOR[priority] : 'var(--border-strong)' }} />
            Приоритет
          </button>
          <button type="button" className="qa-chip" onClick={() => setPop(pop === 'status' ? null : 'status')}>
            {column?.color && <span className="qa-dot" style={{ background: column.color }} />}
            {column?.title ?? 'Статус'}
          </button>
          <button type="button" className={'qa-chip' + (date ? ' on' : '')} onClick={() => setPop(pop === 'date' ? null : 'date')}>
            {date ? fmtDayMonth(parseDateKey(date)) : 'Дата'}
          </button>
          <div className="qa-who">
            {chosen.map((m) => (
              <Avatar key={m.id} member={m} size="sm" />
            ))}
            <button type="button" className="qa-add-avatar" onClick={() => setPop(pop === 'who' ? null : 'who')} aria-label="Ответственный">
              +
            </button>
          </div>
          <span className="qa-spacer" />
          <button type="button" className="qa-send" disabled={!canSubmit} onClick={submit} aria-label="Создать задачу">
            <IcoCheck size={20} color="currentColor" />
          </button>
        </div>

        {pop === 'prio' && (
          <div className="qa-pop">
            {QUADRANTS.map((q) => (
              <button key={q.key} type="button" className={'qa-pop-item' + (priority === q.key ? ' on' : '')} onClick={() => { setPriority(q.key); setPop(null) }}>
                <span className="qa-dot" style={{ background: q.color }} />
                {q.title}
              </button>
            ))}
            <button type="button" className={'qa-pop-item' + (!priority ? ' on' : '')} onClick={() => { setPriority(undefined); setPop(null) }}>
              <span className="qa-dot none" />
              Без приоритета
            </button>
          </div>
        )}
        {pop === 'status' && (
          <div className="qa-pop">
            {columns.map((c) => (
              <button key={c.id} type="button" className={'qa-pop-item' + (columnId === c.id ? ' on' : '')} onClick={() => { setColumnId(c.id); setPop(null) }}>
                {c.color ? <span className="qa-dot" style={{ background: c.color }} /> : <span className="qa-dot none" />}
                {c.title}
              </button>
            ))}
          </div>
        )}
        {pop === 'date' && (
          <div className="qa-pop qa-pop-pad">
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
            {date && (
              <button type="button" className="qa-pop-clear" onClick={() => { setDate(''); setPop(null) }}>
                Убрать дату
              </button>
            )}
          </div>
        )}
        {pop === 'who' && (
          <div className="qa-pop">
            {members.length === 0 && <div className="qa-pop-empty">Сначала добавьте участников в настройках</div>}
            {members.map((m) => {
              const on = assigneeIds.includes(m.id)
              return (
                <button
                  key={m.id}
                  type="button"
                  className={'qa-pop-item' + (on ? ' on' : '')}
                  onClick={() => setAssigneeIds(on ? assigneeIds.filter((x) => x !== m.id) : [...assigneeIds, m.id])}
                >
                  <Avatar member={m} size="sm" />
                  {m.name}
                  {on && <span className="qa-pop-check"><IcoCheck size={14} /></span>}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
