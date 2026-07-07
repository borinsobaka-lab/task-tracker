// Канбан-доска: горизонтальная лента колонок с карточками.
// Drag-and-drop карточек (внутри и между колонками) и колонок — @dnd-kit.
// Все изменения данных идут строго через методы store; во время перетаскивания
// используется локальное optimistic-состояние, а в onDragEnd — один вызов moveCard/moveColumn.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, MutableRefObject } from 'react'
import {
  closestCenter,
  closestCorners,
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type {
  CollisionDetection,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from '@dnd-kit/core'
import {
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useBoard } from '../store'
import type { Card, Column, ColumnRole, ID, Member } from '../types'
import { ROLE_META, ROLE_ORDER } from '../columnRoles'
import { QUADRANT_COLOR, QUADRANT_LABEL } from '../eisenhower'
import { COLUMN_COLORS, fmtDayMonth, hasContent, parseDateKey, toDateKey } from '../utils'
import type { ViewProps } from '../viewProps'
import { IcoCalendar, IcoCheck, IcoClose, IcoComment, IcoDescription, IcoMeeting, IcoMenu, IcoNone, IcoPaperclip, IcoSort, IcoTrash } from '../icons'
import { Avatar, AvatarStack } from './Avatar'
import { SubHeader } from './SubHeader'
import { hasUnseenComments, liveComments, useCommentsSeen } from './Comments'
import './board.css'

type CardsByCol = Record<ID, ID[]>

const MEASURING = { droppable: { strategy: MeasuringStrategy.Always } }

function findColumnOf(map: CardsByCol, cardId: ID): ID | undefined {
  for (const colId of Object.keys(map)) {
    if (map[colId].includes(cardId)) return colId
  }
  return undefined
}

function cardClassName(card: Card): string {
  return 'board-card' + (card.done ? ' done' : '')
}

/** Бледная подложка колонки под цвет её статуса (~8%) + чуть заметная рамка.
 *  Карточки на ней остаются белыми. */
function colTint(color?: string): CSSProperties {
  if (!color) return {}
  return {
    ['--col-bg' as string]: `color-mix(in srgb, ${color} 8%, var(--bg-panel))`,
    ['--col-border' as string]: `color-mix(in srgb, ${color} 22%, var(--border))`,
  }
}

// ---------- Корневой компонент ----------

export function BoardView({ memberFilter, onMemberFilterChange, onOpenCard }: ViewProps) {
  const store = useBoard()
  const columns = store.columns

  const [activeCardId, setActiveCardId] = useState<ID | null>(null)
  const [activeColumnId, setActiveColumnId] = useState<ID | null>(null)
  // Порядок видимых карточек по колонкам на время перетаскивания (optimistic)
  const [localCards, setLocalCards] = useState<CardsByCol | null>(null)
  // Гасим click, который браузер шлёт сразу после завершения drag
  const suppressClickRef = useRef(false)

  // Мышь — тащим почти сразу; палец — только после удержания (~220 мс), иначе
  // при вертикальной прокрутке списка карточки случайно переносились бы.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
  )

  const matchesFilter = useCallback(
    // Встречи и экземпляры регулярных задач на доске не показываем
    (card: Card) =>
      card.kind !== 'meeting' &&
      !card.seriesId &&
      (memberFilter.size === 0 || card.assigneeIds.some((id) => memberFilter.has(id))),
    [memberFilter],
  )

  const isColumnId = useCallback((id: string) => columns.some((c) => c.id === id), [columns])

  const visibleIdsFromStore = useCallback(
    (columnId: ID): ID[] => store.cardsInColumn(columnId).filter(matchesFilter).map((c) => c.id),
    [store, matchesFilter],
  )

  const cardsFor = (col: Column): Card[] => {
    const ids = localCards ? localCards[col.id] ?? [] : visibleIdsFromStore(col.id)
    return ids.map((id) => store.card(id)).filter((c): c is Card => !!c)
  }

  // Колонки таскаем только между колонками; карточки — сначала точное попадание
  // указателем в карточку, потом в колонку, иначе ближайший угол.
  const collisionDetection: CollisionDetection = useCallback((args) => {
    if (args.active.data.current?.type === 'column') {
      return closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter((c) => c.data.current?.type === 'column'),
      })
    }
    const cardContainers = args.droppableContainers.filter((c) => c.data.current?.type === 'card')
    const withinCards = pointerWithin({ ...args, droppableContainers: cardContainers })
    if (withinCards.length > 0) return withinCards
    const columnContainers = args.droppableContainers.filter((c) => c.data.current?.type === 'column')
    const withinColumns = pointerWithin({ ...args, droppableContainers: columnContainers })
    if (withinColumns.length > 0) return withinColumns
    return closestCorners({
      ...args,
      droppableContainers: args.droppableContainers.filter(
        (c) => c.data.current?.type === 'card' || c.data.current?.type === 'column',
      ),
    })
  }, [])

  const handleDragStart = ({ active }: DragStartEvent) => {
    const type = active.data.current?.type
    if (type === 'column') {
      setActiveColumnId(String(active.id))
      return
    }
    if (type === 'card') {
      setActiveCardId(String(active.id))
      const snapshot: CardsByCol = {}
      for (const col of columns) snapshot[col.id] = visibleIdsFromStore(col.id)
      setLocalCards(snapshot)
    }
  }

  // Перенос карточки между колонками — только в локальном состоянии
  const handleDragOver = ({ active, over }: DragOverEvent) => {
    if (active.data.current?.type !== 'card' || !over) return
    const activeId = String(active.id)
    const overId = String(over.id)
    if (activeId === overId) return
    setLocalCards((prev) => {
      if (!prev) return prev
      const fromCol = findColumnOf(prev, activeId)
      const toCol = isColumnId(overId) ? overId : findColumnOf(prev, overId)
      if (!fromCol || !toCol || fromCol === toCol) return prev
      const fromList = prev[fromCol].filter((id) => id !== activeId)
      const toList = [...(prev[toCol] ?? [])]
      let insertAt = toList.length
      if (!isColumnId(overId)) {
        const overIndex = toList.indexOf(overId)
        if (overIndex >= 0) {
          const activeRect = active.rect.current.translated
          const below = activeRect ? activeRect.top > over.rect.top + over.rect.height : false
          insertAt = overIndex + (below ? 1 : 0)
        }
      }
      toList.splice(insertAt, 0, activeId)
      return { ...prev, [fromCol]: fromList, [toCol]: toList }
    })
  }

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    suppressClickRef.current = true
    window.setTimeout(() => {
      suppressClickRef.current = false
    }, 0)

    const type = active.data.current?.type

    if (type === 'column') {
      setActiveColumnId(null)
      if (!over) return
      const fromIndex = columns.findIndex((c) => c.id === String(active.id))
      const toIndex = columns.findIndex((c) => c.id === String(over.id))
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return
      store.moveColumn(String(active.id), toIndex)
      return
    }

    if (type !== 'card') return
    const local = localCards
    setActiveCardId(null)
    setLocalCards(null)
    if (!local || !over) return

    const activeId = String(active.id)
    const overId = String(over.id)
    const destColId = isColumnId(overId) ? overId : findColumnOf(local, overId)
    if (!destColId) return
    const destCol = columns.find((c) => c.id === destColId)
    const card = store.card(activeId)
    if (!destCol || !card) return

    // Целевая позиция среди ВИДИМЫХ карточек (семантика arrayMove)
    const list = local[destColId] ?? []
    let visIndex: number
    if (!isColumnId(overId) && overId !== activeId) {
      visIndex = list.indexOf(overId)
      if (visIndex < 0) visIndex = list.length
    } else {
      visIndex = list.includes(activeId) ? list.indexOf(activeId) : list.length
    }
    const without = list.filter((id) => id !== activeId)
    const finalVisible = [...without]
    finalVisible.splice(Math.max(0, Math.min(visIndex, without.length)), 0, activeId)

    // Перевод видимого индекса в индекс полного списка колонки
    // (фильтр по участникам может скрывать часть карточек): вставляем
    // перед ближайшей видимой карточкой, следующей за перетащенной.
    const fullWithout = destCol.cardIds.filter((id) => id !== activeId)
    const pos = finalVisible.indexOf(activeId)
    const nextVisible = finalVisible.slice(pos + 1).find((id) => fullWithout.includes(id))
    let toIndex = nextVisible !== undefined ? fullWithout.indexOf(nextVisible) : fullWithout.length
    if (toIndex < 0) toIndex = fullWithout.length

    // Ничего не изменилось — не трогаем store
    if (card.columnId === destColId) {
      const after = [...fullWithout]
      after.splice(toIndex, 0, activeId)
      const before = destCol.cardIds
      if (after.length === before.length && after.every((id, i) => id === before[i])) return
    }

    store.moveCard(activeId, destColId, toIndex)
  }

  const handleDragCancel = () => {
    setActiveCardId(null)
    setActiveColumnId(null)
    setLocalCards(null)
  }

  const activeCard = activeCardId ? store.card(activeCardId) ?? null : null
  const activeColumn = activeColumnId ? columns.find((c) => c.id === activeColumnId) ?? null : null

  return (
    <>
      <SubHeader memberFilter={memberFilter} onMemberFilterChange={onMemberFilterChange} />
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        measuring={MEASURING}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="board">
        <SortableContext items={columns.map((c) => c.id)} strategy={horizontalListSortingStrategy}>
          {columns.map((col) => (
            <BoardColumn
              key={col.id}
              column={col}
              cards={cardsFor(col)}
              members={store.members}
              cardDragActive={activeCardId !== null}
              suppressClickRef={suppressClickRef}
              onOpenCard={onOpenCard}
            />
          ))}
        </SortableContext>
        <AddColumn />
      </div>
        <DragOverlay>
          {activeCard ? (
            <div className={cardClassName(activeCard) + ' card-overlay'}>
              <CardContent card={activeCard} members={store.members} />
            </div>
          ) : activeColumn ? (
            <ColumnGhost column={activeColumn} cards={cardsFor(activeColumn)} members={store.members} />
          ) : null}
        </DragOverlay>
      </DndContext>
    </>
  )
}

// ---------- Колонка ----------

function BoardColumn({
  column,
  cards,
  members,
  cardDragActive,
  suppressClickRef,
  onOpenCard,
}: {
  column: Column
  cards: Card[]
  members: Member[]
  cardDragActive: boolean
  suppressClickRef: MutableRefObject<boolean>
  onOpenCard: (id: ID) => void
}) {
  const store = useBoard()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const cancelledRef = useRef(false)

  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: column.id,
    data: { type: 'column' },
  })

  const startEdit = () => {
    if (suppressClickRef.current) return
    cancelledRef.current = false
    setDraft(column.title)
    setEditing(true)
  }

  const commit = () => {
    if (!cancelledRef.current) {
      const t = draft.trim()
      if (t && t !== column.title) store.renameColumn(column.id, t)
    }
    setEditing(false)
  }

  return (
    <section
      ref={setNodeRef}
      className={'board-col' + (isDragging ? ' col-dragging' : '')}
      style={{ transform: CSS.Translate.toString(transform), transition, ...colTint(column.color) }}
    >
      {column.color && <div className="board-col-strip" style={{ background: column.color }} />}
      <div className="board-col-header" ref={setActivatorNodeRef} {...attributes} {...listeners}>
        {editing ? (
          <input
            className="board-col-title-input"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                cancelledRef.current = true
                setEditing(false)
              }
            }}
          />
        ) : (
          <h3 className="board-col-title" title="Нажмите, чтобы переименовать" onClick={startEdit}>
            {column.role && (
              <span className="board-col-role" title={ROLE_META[column.role].label}>
                {ROLE_META[column.role].emoji}
              </span>
            )}
            {column.title}
          </h3>
        )}
        <span className="board-col-count" title="Карточек в колонке">
          {cards.length}
        </span>
        <ColumnMenu column={column} />
      </div>

      <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <div className="board-col-cards">
          {cards.map((card) => (
            <BoardCard
              key={card.id}
              card={card}
              members={members}
              suppressClickRef={suppressClickRef}
              onOpen={() => onOpenCard(card.id)}
            />
          ))}
          {cards.length === 0 && cardDragActive && <div className="board-drop-hint">Перетащите карточку сюда</div>}
        </div>
      </SortableContext>

      <div className="board-col-footer">
        <AddCard columnId={column.id} />
      </div>
    </section>
  )
}

function ColumnMenu({ column }: { column: Column }) {
  const store = useBoard()
  const [open, setOpen] = useState(false)

  const remove = () => {
    setOpen(false)
    const count = store.cardsInColumn(column.id).length
    const warn =
      count > 0
        ? `Вместе с ней будут удалены все её карточки (${count} шт.). `
        : ''
    if (window.confirm(`Удалить колонку «${column.title}»? ${warn}Это действие нельзя отменить.`)) {
      store.deleteColumn(column.id)
    }
  }

  const setRole = (role: ColumnRole | undefined) => {
    store.setColumnRole(column.id, role)
  }

  const setColor = (color: string | undefined) => {
    store.setColumnColor(column.id, color)
  }

  const sortBy = (by: 'due' | 'created') => {
    store.sortColumn(column.id, by)
    setOpen(false)
  }

  return (
    <div className="col-menu-wrap" onPointerDown={(e) => e.stopPropagation()}>
      <button
        className="icon-btn"
        title="Действия с колонкой"
        aria-label="Действия с колонкой"
        onClick={() => setOpen((o) => !o)}
      >
        <IcoMenu size={18} />
      </button>
      {open && (
        <>
          <div className="col-menu-backdrop" onClick={() => setOpen(false)} />
          <div className="col-menu" role="menu">
            <div className="col-menu-label">Действие</div>
            <button className="col-menu-item" role="menuitem" onClick={() => sortBy('due')}>
              <span className="col-menu-emoji"><IcoSort size={16} /></span>
              Сортировать по дате выполнения
            </button>
            <button className="col-menu-item" role="menuitem" onClick={() => sortBy('created')}>
              <span className="col-menu-emoji"><IcoSort size={16} /></span>
              Сортировать по дате создания
            </button>
            <div className="col-menu-sep" />
            <div className="col-menu-label">Статус для отчётов</div>
            {ROLE_ORDER.map((r) => (
              <button
                key={r}
                className={'col-menu-item' + (column.role === r ? ' active' : '')}
                role="menuitemradio"
                aria-checked={column.role === r}
                onClick={() => setRole(r)}
              >
                <span className="col-menu-emoji">{ROLE_META[r].emoji}</span>
                {ROLE_META[r].label}
                {column.role === r && <span className="col-menu-check"><IcoCheck size={16} /></span>}
              </button>
            ))}
            <button
              className={'col-menu-item' + (!column.role ? ' active' : '')}
              role="menuitemradio"
              aria-checked={!column.role}
              onClick={() => setRole(undefined)}
            >
              <span className="col-menu-emoji"><IcoNone size={16} /></span>
              Без статуса
              {!column.role && <span className="col-menu-check"><IcoCheck size={16} /></span>}
            </button>
            <div className="col-menu-sep" />
            <div className="col-menu-label">Цвет колонки</div>
            <div className="col-menu-colors">
              <button
                className={'col-color-swatch none' + (!column.color ? ' active' : '')}
                onClick={() => setColor(undefined)}
                title="Без цвета"
                aria-label="Без цвета"
              >
                <IcoClose size={15} />
              </button>
              {COLUMN_COLORS.map((c) => (
                <button
                  key={c}
                  className={'col-color-swatch' + (column.color === c ? ' active' : '')}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  title={c}
                  aria-label={`Цвет ${c}`}
                />
              ))}
            </div>
            <div className="col-menu-sep" />
            <button className="col-menu-item danger" role="menuitem" onClick={remove}>
              <span className="col-menu-emoji"><IcoTrash size={16} color="currentColor" /></span>
              Удалить колонку
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// Копия колонки для DragOverlay
function ColumnGhost({ column, cards, members }: { column: Column; cards: Card[]; members: Member[] }) {
  return (
    <div className="board-col col-overlay" style={colTint(column.color)}>
      {column.color && <div className="board-col-strip" style={{ background: column.color }} />}
      <div className="board-col-header">
        <h3 className="board-col-title">{column.title}</h3>
        <span className="board-col-count">{cards.length}</span>
      </div>
      <div className="board-col-cards">
        {cards.map((c) => (
          <div key={c.id} className={cardClassName(c)}>
            <CardContent card={c} members={members} />
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------- Карточка ----------

function BoardCard({
  card,
  members,
  suppressClickRef,
  onOpen,
}: {
  card: Card
  members: Member[]
  suppressClickRef: MutableRefObject<boolean>
  onOpen: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: 'card' },
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cardClassName(card) + (isDragging ? ' card-source' : '')}
      onClick={() => {
        if (!suppressClickRef.current) onOpen()
      }}
      {...attributes}
      {...listeners}
    >
      <CardContent card={card} members={members} interactive />
    </div>
  )
}

// Быстрое назначение ответственного прямо на карточке доски
function QuickAssign({ card, members, assignees }: { card: Card; members: Member[]; assignees: Member[] }) {
  const store = useBoard()
  const [pos, setPos] = useState<{ right: number; bottom: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!pos) return
    const close = (e: Event) => {
      const t = e.target as Node
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return
      setPos(null)
    }
    const onScroll = () => setPos(null) // поповер fixed — при прокрутке закрываем
    document.addEventListener('mousedown', close)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', close)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [pos])

  const openPop = () => {
    if (pos) {
      setPos(null)
      return
    }
    const r = btnRef.current!.getBoundingClientRect()
    setPos({ right: window.innerWidth - r.right, bottom: window.innerHeight - r.top + 6 })
  }

  const toggle = (id: ID) => {
    const has = card.assigneeIds.includes(id)
    store.updateCard(card.id, {
      assigneeIds: has ? card.assigneeIds.filter((x) => x !== id) : [...card.assigneeIds, id],
    })
  }

  return (
    <div className="card-assign" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <button
        ref={btnRef}
        type="button"
        className="card-assign-btn"
        title="Назначить ответственного"
        aria-label="Назначить ответственного"
        onClick={openPop}
      >
        {assignees.length > 0 ? <AvatarStack members={assignees} size="sm" /> : <span className="card-add-avatar">+</span>}
      </button>
      {pos && (
        <div className="card-assign-pop" role="menu" ref={popRef} style={{ right: pos.right, bottom: pos.bottom }}>
          {store.members.length === 0 && <div className="muted card-assign-empty">Добавьте участников в настройках</div>}
          {store.members.map((m) => {
            const on = card.assigneeIds.includes(m.id)
            return (
              <button key={m.id} type="button" className="card-assign-row" onClick={() => toggle(m.id)}>
                <Avatar member={m} size="sm" />
                <span className="card-assign-name">{m.name}</span>
                {on && <span className="card-assign-check"><IcoCheck size={15} /></span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CardContent({ card, members, interactive }: { card: Card; members: Member[]; interactive?: boolean }) {
  const store = useBoard()
  const { seenAt } = useCommentsSeen()
  const total = card.checklist.length
  const doneCount = card.checklist.reduce((n, i) => n + (i.done ? 1 : 0), 0)
  const attachments = card.attachments.length
  const withDescription = hasContent(card.description)
  const commentCount = liveComments(card).length
  const unseenComments = commentCount > 0 && hasUnseenComments(card, store.identity?.id ?? null, seenAt(card.id))
  const assignees = card.assigneeIds
    .map((id) => members.find((m) => m.id === id))
    .filter((m): m is Member => !!m)

  let dateLabel: string | null = null
  let overdue = false
  if (card.date) {
    dateLabel = fmtDayMonth(parseDateKey(card.date))
    if (card.start) dateLabel += `, ${card.start}`
    overdue = !card.done && card.date < toDateKey(new Date())
  }

  const hasMeta =
    dateLabel !== null || total > 0 || attachments > 0 || withDescription || commentCount > 0 || assignees.length > 0

  return (
    <>
      <div className="board-card-title">
        {card.done && (
          <span className="card-done-check" title="Выполнено" aria-label="Выполнено">
            <CheckIcon />
          </span>
        )}
        {card.priority && (
          <span
            className="card-prio-dot"
            style={{ background: QUADRANT_COLOR[card.priority] }}
            title={`Приоритет: ${QUADRANT_LABEL[card.priority]}`}
          />
        )}
        {card.kind === 'meeting' && (
          <span className="card-meeting-ico" aria-hidden>
            <IcoMeeting size={14} />
          </span>
        )}
        <span className="board-card-title-text">{card.title}</span>
      </div>
      {(hasMeta || interactive) && (
        <div className="board-card-meta">
          {dateLabel && (
            <span className={'card-badge' + (overdue ? ' overdue' : '')} title={overdue ? 'Срок прошёл' : 'Дата'}>
              <CalendarIcon />
              {dateLabel}
            </span>
          )}
          {total > 0 && (
            <span
              className={'card-badge' + (doneCount === total ? ' complete' : '')}
              title={`Чек-лист: ${doneCount} из ${total}`}
            >
              <IcoCheck size={12} /> {doneCount}/{total}
            </span>
          )}
          {attachments > 0 && (
            <span className="card-badge plain" title={`Вложений: ${attachments}`}>
              <PaperclipIcon />
              {attachments}
            </span>
          )}
          {withDescription && (
            <span className="card-badge plain" title="Есть описание">
              <DescriptionIcon />
            </span>
          )}
          {commentCount > 0 && (
            <span
              className={'card-badge' + (unseenComments ? ' unseen' : ' plain')}
              title={unseenComments ? 'Есть непрочитанные комментарии' : `Комментариев: ${commentCount}`}
            >
              <IcoComment size={12} /> {commentCount}
            </span>
          )}
          {interactive ? (
            <QuickAssign card={card} members={members} assignees={assignees} />
          ) : (
            assignees.length > 0 && (
              <span className="card-assignees">
                <AvatarStack members={assignees} size="sm" />
              </span>
            )
          )}
        </div>
      )}
    </>
  )
}

// ---------- Быстрое добавление ----------

function AddCard({ columnId }: { columnId: ID }) {
  const store = useBoard()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) taRef.current?.focus()
  }, [open])

  // Клик мимо композера — сворачиваем и сбрасываем к исходному состоянию
  useEffect(() => {
    if (!open) return
    const onDown = (e: Event) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
        setText('')
      }
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const close = () => {
    setOpen(false)
    setText('')
  }

  const submit = () => {
    const t = text.trim()
    if (!t) {
      taRef.current?.focus()
      return
    }
    store.addCard(columnId, t)
    setText('')
    // Прокручиваем список к новой карточке
    const list = taRef.current?.closest('.board-col')?.querySelector('.board-col-cards')
    if (list) requestAnimationFrame(() => list.scrollTo({ top: list.scrollHeight }))
    taRef.current?.focus()
  }

  if (!open) {
    return (
      <button className="board-add-card-btn" onClick={() => setOpen(true)}>
        + Добавить карточку
      </button>
    )
  }

  return (
    <div className="card-composer" ref={wrapRef}>
      <textarea
        ref={taRef}
        className="input"
        rows={2}
        placeholder="Введите название карточки…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
          if (e.key === 'Escape') close()
        }}
      />
      <div className="composer-actions">
        <button className="btn btn-primary btn-sm" onClick={submit}>
          Добавить
        </button>
        <button className="icon-btn" title="Отмена" aria-label="Отмена" onClick={close}>
          <IcoClose size={18} />
        </button>
      </div>
    </div>
  )
}

function AddColumn() {
  const store = useBoard()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const close = () => {
    setOpen(false)
    setTitle('')
  }

  const submit = () => {
    const t = title.trim()
    if (!t) {
      inputRef.current?.focus()
      return
    }
    store.addColumn(t)
    setTitle('')
    inputRef.current?.focus()
  }

  if (!open) {
    return (
      <div className="board-add-col">
        <button className="board-add-col-btn" onClick={() => setOpen(true)}>
          + Добавить колонку
        </button>
      </div>
    )
  }

  return (
    <div className="board-add-col">
      <div className="board-add-col-form">
        <input
          ref={inputRef}
          className="input"
          placeholder="Название колонки"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') close()
          }}
        />
        <div className="composer-actions">
          <button className="btn btn-primary btn-sm" onClick={submit}>
            Добавить
          </button>
          <button className="icon-btn" title="Отмена" aria-label="Отмена" onClick={close}>
            <IcoClose size={18} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------- Иконки ----------

function CheckIcon() {
  return <IcoCheck size={13} color="currentColor" aria-hidden />
}

function CalendarIcon() {
  return <IcoCalendar size={12} aria-hidden />
}

function PaperclipIcon() {
  return <IcoPaperclip size={12} aria-hidden />
}

function DescriptionIcon() {
  return <IcoDescription size={13} aria-hidden />
}
