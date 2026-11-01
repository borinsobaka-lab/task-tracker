import type { ReactNode } from 'react'
import { useBoard } from '../store'
import type { ID } from '../types'
import { Avatar } from './Avatar'
import { PriorityFilter } from './PriorityFilter'
import type { PriorityKey } from '../priorityFilter'
import './subheader.css'

/**
 * Второй хедер (панель раздела): слева аватарки-фильтры участников,
 * затем — элементы конкретного раздела (children). Поиск вынесен в верхний хедер.
 */
export function SubHeader({
  memberFilter,
  onMemberFilterChange,
  priorityFilter,
  onPriorityFilterChange,
  children,
  right,
}: {
  memberFilter: ReadonlySet<ID>
  onMemberFilterChange: (f: ReadonlySet<ID>) => void
  /** Есть в разделах с задачами: фильтр по приоритету после элементов раздела */
  priorityFilter?: ReadonlySet<PriorityKey>
  onPriorityFilterChange?: (f: ReadonlySet<PriorityKey>) => void
  children?: ReactNode
  right?: ReactNode
}) {
  const store = useBoard()

  const toggleMember = (id: ID) => {
    const next = new Set(memberFilter)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onMemberFilterChange(next)
  }

  return (
    <div className="subheader">
      {(children || priorityFilter) && (
        <div className="subheader-controls">
          {children}
          {priorityFilter && onPriorityFilterChange && <PriorityFilter value={priorityFilter} onChange={onPriorityFilterChange} />}
        </div>
      )}

      <div className="subheader-members" title="Фильтр по участникам">
        {store.members.map((m) => (
          <button
            key={m.id}
            className={`member-filter-btn${memberFilter.has(m.id) ? ' active' : ''}`}
            style={{ ['--mc' as string]: m.color }}
            onClick={() => toggleMember(m.id)}
            title={`${m.name} — показать только его задачи`}
          >
            <Avatar member={m} size="sm" />
          </button>
        ))}
        {memberFilter.size > 0 && (
          <button className="btn btn-sm member-filter-reset" onClick={() => onMemberFilterChange(new Set())}>
            Сбросить
          </button>
        )}
      </div>

      {right && <div className="subheader-right">{right}</div>}
    </div>
  )
}
