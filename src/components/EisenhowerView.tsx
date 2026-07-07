import { useMemo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  pointerWithin,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import { useBoard } from '../store'
import type { Card, EisenhowerQuadrant, ID, Member } from '../types'
import { QUADRANTS } from '../eisenhower'
import { IcoMeeting } from '../icons'
import { AvatarStack } from './Avatar'
import './eisenhower.css'

const INBOX = 'inbox'

export function EisenhowerView({
  memberFilter,
  onOpenCard,
}: {
  memberFilter: ReadonlySet<ID>
  onOpenCard: (id: ID) => void
}) {
  const store = useBoard()
  const memberById = useMemo(() => new Map(store.members.map((m) => [m.id, m])), [store.members])
  const [activeId, setActiveId] = useState<ID | null>(null)
  const suppressClickRef = useRef(false)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const inFilter = (c: Card) => memberFilter.size === 0 || c.assigneeIds.some((id) => memberFilter.has(id))
  // В матрице только обычные задачи: без встреч, без регулярных и без готовых
  const cards = store.liveCards().filter((c) => c.kind !== 'meeting' && !c.seriesId && !c.done && inFilter(c))

  const inbox = cards.filter((c) => !c.priority)
  const byQuadrant: Record<EisenhowerQuadrant, Card[]> = { q1: [], q2: [], q3: [], q4: [] }
  for (const c of cards) if (c.priority) byQuadrant[c.priority].push(c)
  for (const q of Object.keys(byQuadrant) as EisenhowerQuadrant[]) {
    byQuadrant[q].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  const assigneesOf = (c: Card): Member[] =>
    c.assigneeIds.map((id) => memberById.get(id)).filter((m): m is Member => !!m)

  const onDragStart = (e: DragStartEvent) => {
    setActiveId(e.active.id as ID)
    suppressClickRef.current = true
  }
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null)
    window.setTimeout(() => (suppressClickRef.current = false), 0)
    const cardId = e.active.id as ID
    const over = e.over?.id as string | undefined
    if (!over) return
    const target = over === INBOX ? undefined : (over as EisenhowerQuadrant)
    const card = store.card(cardId)
    if (!card) return
    if ((card.priority ?? undefined) !== target) store.setPriority(cardId, target)
  }

  const activeCard = activeId ? store.card(activeId) : undefined

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="eis-root">
        <Zone id={INBOX} className="eis-inbox">
          <div className="eis-inbox-head">
            <span className="field-label">Без приоритета</span>
            <span className="eis-count">{inbox.length}</span>
          </div>
          <div className="eis-inbox-body">
            {inbox.length === 0 && <div className="eis-empty">Все задачи распределены 👍</div>}
            {inbox.map((c) => (
              <EisCard key={c.id} card={c} members={assigneesOf(c)} onOpen={onOpenCard} suppressClickRef={suppressClickRef} />
            ))}
          </div>
        </Zone>

        <div className="eis-grid">
          {QUADRANTS.map((q) => (
            <Zone key={q.key} id={q.key} className="eis-quadrant" style={{ ['--q-color' as string]: q.color }}>
              <div className="eis-quadrant-head">
                <span className="eis-quadrant-dot" />
                <span className="eis-quadrant-title">{q.title}</span>
                <span className="eis-quadrant-hint">{q.hint}</span>
                <span className="eis-count">{byQuadrant[q.key].length}</span>
              </div>
              <div className="eis-quadrant-body">
                {byQuadrant[q.key].map((c) => (
                  <EisCard
                    key={c.id}
                    card={c}
                    members={assigneesOf(c)}
                    color={q.color}
                    onOpen={onOpenCard}
                    suppressClickRef={suppressClickRef}
                  />
                ))}
              </div>
            </Zone>
          ))}
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {activeCard ? <EisCardBody card={activeCard} members={assigneesOf(activeCard)} dragging /> : null}
      </DragOverlay>
    </DndContext>
  )
}

function Zone({
  id,
  className,
  style,
  children,
}: {
  id: string
  className: string
  style?: React.CSSProperties
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div ref={setNodeRef} className={className + (isOver ? ' is-over' : '')} style={style}>
      {children}
    </div>
  )
}

function EisCard({
  card,
  members,
  color,
  onOpen,
  suppressClickRef,
}: {
  card: Card
  members: Member[]
  color?: string
  onOpen: (id: ID) => void
  suppressClickRef: MutableRefObject<boolean>
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.id })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={'eis-card' + (isDragging ? ' dragging' : '')}
      onClick={() => {
        if (suppressClickRef.current) return
        onOpen(card.id)
      }}
    >
      <EisCardBody card={card} members={members} color={color} />
    </div>
  )
}

function EisCardBody({
  card,
  members,
  color,
  dragging,
}: {
  card: Card
  members: Member[]
  color?: string
  dragging?: boolean
}) {
  return (
    <div className={'eis-card-body' + (dragging ? ' overlay' : '')} style={color ? { borderLeftColor: color } : undefined}>
      <div className="eis-card-title">
        {card.kind === 'meeting' && <span className="inline-ico" aria-hidden><IcoMeeting size={13} /></span>}
        {card.title}
      </div>
      {members.length > 0 && (
        <div className="eis-card-meta">
          <AvatarStack members={members} size="sm" />
        </div>
      )}
    </div>
  )
}
