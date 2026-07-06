// Модальное окно карточки: заголовок и колонка, участники, срок/время,
// описание (TipTap), чек-лист, вложения (включая drag&drop), удаление.
// Все изменения данных — только через методы store (useBoard()).

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useBoard } from '../store'
import type { BoardStore } from '../store'
import type { Attachment, Card, ChecklistItem, ID, Member } from '../types'
import { fmtDayMonth, fmtFullDate, formatBytes, parseDateKey, toDateKey } from '../utils'
import { Avatar } from './Avatar'
import { RichTextEditor } from './RichTextEditor'
import './modal.css'

const MAX_FILE_SIZE = 15 * 1024 * 1024 // 15 МБ
const TITLE_DEBOUNCE_MS = 600

const DURATION_OPTIONS: { value: string; label: string }[] = [
  { value: '30', label: '30 мин' },
  { value: '60', label: '1 ч' },
  { value: '90', label: '1.5 ч' },
  { value: '120', label: '2 ч' },
  { value: '180', label: '3 ч' },
  { value: '240', label: '4 ч' },
  { value: 'allday', label: 'Весь день' },
]

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function durLabel(min: number): string {
  if (min < 60) return `${min} мин`
  return `${Math.round((min / 60) * 10) / 10} ч`
}

/** debounce со сбросом на unmount: несохранённое значение досылается */
function useDebouncedValue(fn: (v: string) => void, ms: number): { run: (v: string) => void; flush: () => void } {
  const fnRef = useRef(fn)
  fnRef.current = fn
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<string | null>(null)

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (pending.current !== null) {
      const v = pending.current
      pending.current = null
      fnRef.current(v)
    }
  }, [])

  const run = useCallback(
    (v: string) => {
      pending.current = v
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(flush, ms)
    },
    [flush, ms],
  )

  useEffect(() => flush, [flush]) // flush при размонтировании

  return { run, flush }
}

// ---------- Корневой компонент ----------

export function CardModal({ cardId, onClose }: { cardId: ID; onClose: () => void }) {
  const store = useBoard()
  const card = store.card(cardId)

  // Карточку удалили (в т.ч. с другого устройства) — закрываемся
  useEffect(() => {
    if (!card) onClose()
  }, [card, onClose])

  if (!card) return null
  return <CardModalInner key={cardId} card={card} store={store} onClose={onClose} />
}

// ---------- Содержимое (карточка гарантированно существует) ----------

function CardModalInner({ card, store, onClose }: { card: Card; store: BoardStore; onClose: () => void }) {
  // --- заголовок ---
  const [title, setTitle] = useState(card.title)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const lastCardTitle = useRef(card.title)

  const { run: runTitle, flush: flushTitle } = useDebouncedValue((v) => {
    const t = v.trim()
    if (t && t !== card.title) store.updateCard(card.id, { title: t })
  }, TITLE_DEBOUNCE_MS)

  const [titleFocused, setTitleFocused] = useState(false)

  // Внешнее изменение заголовка (синхронизация): подхватываем, когда поле не
  // в фокусе. Если пользователь в этот момент редактирует — НЕ трогаем ref,
  // чтобы синхронизировать сразу после blur (иначе заголовок в модалке навсегда
  // остался бы рассинхронизирован со свежим значением из хранилища).
  useEffect(() => {
    if (card.title === lastCardTitle.current) return
    if (titleFocused) return
    lastCardTitle.current = card.title
    setTitle(card.title)
  }, [card.title, titleFocused])

  // autosize
  useEffect(() => {
    const el = titleRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = el.scrollHeight + 'px'
    }
  }, [title])

  // --- поповеры ---
  const [membersOpen, setMembersOpen] = useState(false)
  const [dateOpen, setDateOpen] = useState(false)
  const membersBlockRef = useRef<HTMLDivElement>(null)
  const dateBlockRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!membersOpen) return
    const onDown = (e: MouseEvent) => {
      if (membersBlockRef.current && !membersBlockRef.current.contains(e.target as Node)) setMembersOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [membersOpen])

  useEffect(() => {
    if (!dateOpen) return
    const onDown = (e: MouseEvent) => {
      if (dateBlockRef.current && !dateBlockRef.current.contains(e.target as Node)) setDateOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [dateOpen])

  // Escape: сначала закрывает открытый поповер, затем — модалку
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (membersOpen) {
        setMembersOpen(false)
        return
      }
      if (dateOpen) {
        setDateOpen(false)
        return
      }
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [membersOpen, dateOpen, onClose])

  // --- срок/время: локальное состояние поповера ---
  const [dateVal, setDateVal] = useState('')
  const [timeVal, setTimeVal] = useState('')
  const [durVal, setDurVal] = useState('allday')

  const openDatePopover = () => {
    setDateVal(card.date ?? toDateKey(new Date()))
    setTimeVal(card.start ?? '')
    setDurVal(card.start ? String(card.durationMin ?? 60) : 'allday')
    setDateOpen(true)
  }

  const saveDate = () => {
    if (!dateVal) return
    if (durVal === 'allday' || !timeVal) store.scheduleCard(card.id, dateVal, null)
    else store.scheduleCard(card.id, dateVal, timeVal, Number(durVal))
    setDateOpen(false)
  }

  const clearDate = () => {
    store.scheduleCard(card.id, null)
    setDateOpen(false)
  }

  // --- чек-лист ---
  const [newItem, setNewItem] = useState('')
  const checklistDone = card.checklist.filter((i) => i.done).length
  const checklistTotal = card.checklist.length

  const addChecklistItem = () => {
    const t = newItem.trim()
    if (!t) return
    store.addChecklistItem(card.id, t)
    setNewItem('')
  }

  // --- вложения ---
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploads, setUploads] = useState<{ key: number; name: string }[]>([])
  const uploadKey = useRef(0)
  const [dragActive, setDragActive] = useState(false)
  const dragDepth = useRef(0)

  const handleFiles = async (files: File[]) => {
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        alert(`Файл «${file.name}» весит ${formatBytes(file.size)}. Максимальный размер — 15 МБ.`)
        continue
      }
      const key = ++uploadKey.current
      setUploads((u) => [...u, { key, name: file.name }])
      try {
        await store.uploadAttachment(card.id, file)
      } catch (e) {
        alert(`Не удалось загрузить файл «${file.name}»: ${errMsg(e)}`)
      } finally {
        setUploads((u) => u.filter((x) => x.key !== key))
      }
    }
  }

  const hasFiles = (e: ReactDragEvent) => Array.from(e.dataTransfer.types).includes('Files')

  const onDragEnter = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    dragDepth.current++
    setDragActive(true)
  }
  const onDragOver = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  const onDragLeave = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragActive(false)
  }
  const onDrop = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    dragDepth.current = 0
    setDragActive(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length) void handleFiles(files)
  }

  const removeAttachment = (att: Attachment) => {
    if (!confirm(`Удалить вложение «${att.name}»?`)) return
    store.removeAttachment(card.id, att.id).catch((e) => alert(`Не удалось удалить вложение: ${errMsg(e)}`))
  }

  const downloadAttachment = (att: Attachment) => {
    store.downloadAttachment(att).catch((e) => alert(`Не удалось скачать файл: ${errMsg(e)}`))
  }

  // --- участники ---
  const assignees = card.assigneeIds
    .map((id) => store.members.find((m) => m.id === id))
    .filter((m): m is Member => !!m)

  const toggleMember = (memberId: ID) => {
    const has = card.assigneeIds.includes(memberId)
    store.updateCard(card.id, {
      assigneeIds: has ? card.assigneeIds.filter((x) => x !== memberId) : [...card.assigneeIds, memberId],
    })
  }

  // --- удаление карточки ---
  const deleteCard = () => {
    if (!confirm('Удалить карточку? Это действие нельзя отменить.')) return
    store.deleteCard(card.id)
    onClose()
  }

  // --- закрытие по клику именно по оверлею ---
  const overlayDown = useRef(false)

  const chipLabel = card.date
    ? `${fmtDayMonth(parseDateKey(card.date))}${
        card.start ? `, ${card.start} · ${durLabel(card.durationMin ?? 60)}` : ' · весь день'
      }`
    : 'Добавить дату'

  const durationOptions = DURATION_OPTIONS.some((o) => o.value === durVal)
    ? DURATION_OPTIONS
    : [{ value: durVal, label: durLabel(Number(durVal)) }, ...DURATION_OPTIONS]

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        overlayDown.current = e.target === e.currentTarget
      }}
      onMouseUp={(e) => {
        if (overlayDown.current && e.target === e.currentTarget) onClose()
        overlayDown.current = false
      }}
    >
      <div
        className={'modal cm' + (dragActive ? ' dragging' : '')}
        role="dialog"
        aria-modal="true"
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {dragActive && <div className="cm-drop-hint">Отпустите, чтобы прикрепить файлы</div>}

        {/* ---------- Шапка ---------- */}
        <header className="cm-header">
          <button
            type="button"
            className={'cm-done' + (card.done ? ' on' : '')}
            title={card.done ? 'Отметить невыполненной' : 'Отметить выполненной'}
            aria-label={card.done ? 'Отметить невыполненной' : 'Отметить выполненной'}
            onClick={() => store.updateCard(card.id, { done: !card.done })}
          >
            ✓
          </button>
          <div className="cm-header-main">
            <textarea
              ref={titleRef}
              className="cm-title"
              value={title}
              rows={1}
              placeholder="Название карточки"
              onFocus={() => setTitleFocused(true)}
              onChange={(e) => {
                setTitle(e.target.value)
                runTitle(e.target.value)
              }}
              onBlur={() => {
                flushTitle()
                if (!title.trim()) setTitle(card.title)
                setTitleFocused(false)
              }}
              onKeyDown={(e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  e.currentTarget.blur()
                }
              }}
            />
            <label className="cm-subline">
              в колонке{' '}
              <select
                className="cm-col-select"
                value={card.columnId}
                onChange={(e) => {
                  const colId = e.target.value
                  if (colId !== card.columnId) store.moveCard(card.id, colId, store.cardsInColumn(colId).length)
                }}
              >
                {store.columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button type="button" className="icon-btn" title="Закрыть" aria-label="Закрыть" onClick={onClose}>
            ✕
          </button>
        </header>

        {/* ---------- Мета: участники и срок ---------- */}
        <div className="cm-meta">
          <div className="cm-meta-block" ref={membersBlockRef}>
            <span className="field-label">Участники</span>
            <div className="cm-members">
              {assignees.map((m) => (
                <Avatar key={m.id} member={m} />
              ))}
              <button
                type="button"
                className="cm-add-member"
                title="Назначить участников"
                aria-label="Назначить участников"
                onClick={() => setMembersOpen((o) => !o)}
              >
                +
              </button>
            </div>
            {membersOpen && (
              <div className="cm-pop cm-pop-members">
                {store.members.length === 0 ? (
                  <div className="muted cm-pop-empty">Участников пока нет — добавьте их в настройках</div>
                ) : (
                  store.members.map((m) => {
                    const on = card.assigneeIds.includes(m.id)
                    return (
                      <button type="button" key={m.id} className="cm-member-row" onClick={() => toggleMember(m.id)}>
                        <Avatar member={m} size="sm" />
                        <span className="cm-member-name">{m.name}</span>
                        {on && <span className="cm-member-check">✓</span>}
                      </button>
                    )
                  })
                )}
              </div>
            )}
          </div>

          <div className="cm-meta-block" ref={dateBlockRef}>
            <span className="field-label">Срок</span>
            <button
              type="button"
              className={'chip cm-date-chip' + (card.date ? ' active' : '')}
              onClick={() => (dateOpen ? setDateOpen(false) : openDatePopover())}
            >
              <CalendarGlyph />
              {chipLabel}
            </button>
            {dateOpen && (
              <div className="cm-pop cm-pop-date">
                <div>
                  <span className="field-label">Дата</span>
                  <input type="date" className="input" value={dateVal} onChange={(e) => setDateVal(e.target.value)} />
                </div>
                <div className="cm-date-grid">
                  <div>
                    <span className="field-label">Время</span>
                    <input
                      type="time"
                      className="input"
                      value={timeVal}
                      onChange={(e) => {
                        const v = e.target.value
                        setTimeVal(v)
                        if (v && durVal === 'allday') setDurVal('60')
                        if (!v) setDurVal('allday')
                      }}
                    />
                  </div>
                  <div>
                    <span className="field-label">Длительность</span>
                    <select
                      className="input"
                      value={durVal}
                      onChange={(e) => {
                        const v = e.target.value
                        setDurVal(v)
                        if (v === 'allday') setTimeVal('')
                      }}
                    >
                      {durationOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="cm-pop-actions">
                  <button type="button" className="btn btn-primary btn-sm" disabled={!dateVal} onClick={saveDate}>
                    Сохранить
                  </button>
                  <button type="button" className="btn btn-sm" disabled={!card.date} onClick={clearDate}>
                    Убрать дату
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ---------- Описание ---------- */}
        <section className="cm-section">
          <span className="field-label">Описание</span>
          <RichTextEditor
            value={card.description}
            onChange={(html) => store.updateCard(card.id, { description: html })}
            placeholder="Добавьте описание…"
          />
        </section>

        {/* ---------- Чек-лист ---------- */}
        <section className="cm-section">
          <div className="cm-check-head">
            <span className="field-label">Чек-лист</span>
            {checklistTotal > 0 && (
              <span className="cm-check-count">
                {checklistDone}/{checklistTotal}
              </span>
            )}
          </div>
          {checklistTotal > 0 && (
            <div className="cm-progress" role="progressbar" aria-valuemin={0} aria-valuemax={checklistTotal} aria-valuenow={checklistDone}>
              <div style={{ width: `${(checklistDone / checklistTotal) * 100}%` }} />
            </div>
          )}
          <div className="cm-check-list">
            {card.checklist.map((item) => (
              <ChecklistRow
                key={item.id}
                item={item}
                onToggle={(done) => store.updateChecklistItem(card.id, item.id, { done })}
                onRename={(text) => store.updateChecklistItem(card.id, item.id, { text })}
                onRemove={() => store.removeChecklistItem(card.id, item.id)}
              />
            ))}
          </div>
          <input
            className="input cm-check-add"
            placeholder="Добавить пункт…"
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addChecklistItem()
              }
              if (e.key === 'Escape' && newItem) {
                setNewItem('')
                e.stopPropagation()
              }
            }}
          />
        </section>

        {/* ---------- Вложения ---------- */}
        <section className="cm-section">
          <div className="cm-att-head">
            <span className="field-label">Вложения</span>
            <button type="button" className="btn btn-sm" onClick={() => fileInputRef.current?.click()}>
              Прикрепить файл
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                const files = e.currentTarget.files ? Array.from(e.currentTarget.files) : []
                e.currentTarget.value = ''
                if (files.length) void handleFiles(files)
              }}
            />
          </div>
          <div className="cm-att-list">
            {uploads.map((u) => (
              <div className="cm-att cm-att-uploading" key={`up-${u.key}`}>
                <span className="spinner" />
                <span className="cm-att-name-plain">{u.name}</span>
                <span className="muted">загрузка…</span>
              </div>
            ))}
            {card.attachments.map((att) => (
              <div className="cm-att" key={att.id}>
                <span className="cm-att-icon" aria-hidden="true">
                  {att.mime.startsWith('image/') ? '🖼' : '📄'}
                </span>
                <button type="button" className="cm-att-name" title="Скачать" onClick={() => downloadAttachment(att)}>
                  {att.name}
                </button>
                <span className="cm-att-meta muted">
                  {formatBytes(att.size)} · {fmtDayMonth(new Date(att.uploadedAt))}
                </span>
                <button
                  type="button"
                  className="icon-btn cm-att-del"
                  title="Удалить вложение"
                  aria-label="Удалить вложение"
                  onClick={() => removeAttachment(att)}
                >
                  ✕
                </button>
              </div>
            ))}
            {uploads.length === 0 && card.attachments.length === 0 && (
              <div className="muted cm-att-empty">Файлов нет — перетащите их сюда или нажмите «Прикрепить файл»</div>
            )}
          </div>
        </section>

        {/* ---------- Футер ---------- */}
        <footer className="cm-footer">
          <span className="muted">Создано {fmtFullDate(new Date(card.createdAt))}</span>
          <button type="button" className="btn btn-danger btn-sm" onClick={deleteCard}>
            Удалить карточку
          </button>
        </footer>
      </div>
    </div>
  )
}

// ---------- Пункт чек-листа ----------

function ChecklistRow({
  item,
  onToggle,
  onRename,
  onRemove,
}: {
  item: ChecklistItem
  onToggle: (done: boolean) => void
  onRename: (text: string) => void
  onRemove: () => void
}) {
  const [text, setText] = useState(item.text)
  const inputRef = useRef<HTMLInputElement>(null)

  // Внешнее изменение текста — подхватываем, если пункт сейчас не редактируется
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setText(item.text)
  }, [item.text])

  const commit = () => {
    const t = text.trim()
    if (!t) {
      setText(item.text)
      return
    }
    if (t !== item.text) onRename(t)
  }

  return (
    <div className={'cm-check-row' + (item.done ? ' done' : '')}>
      <input
        type="checkbox"
        className="cm-checkbox"
        checked={item.done}
        onChange={(e) => onToggle(e.target.checked)}
        aria-label={item.done ? 'Снять отметку' : 'Отметить выполненным'}
      />
      <input
        ref={inputRef}
        className="cm-check-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          }
          if (e.key === 'Escape') {
            setText(item.text)
            e.currentTarget.blur()
            e.stopPropagation()
          }
        }}
      />
      <button type="button" className="icon-btn cm-check-del" title="Удалить пункт" aria-label="Удалить пункт" onClick={onRemove}>
        ✕
      </button>
    </div>
  )
}

function CalendarGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="2" y="3" width="12" height="11" rx="2" />
      <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" strokeLinecap="round" />
    </svg>
  )
}
