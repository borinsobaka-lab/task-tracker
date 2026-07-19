import type { ReactNode } from 'react'
import { useBoard } from '../store'
import type { ID } from '../types'
import { Avatar } from './Avatar'
import './subheader.css'

/**
 * Второй хедер (панель раздела): слева аватарки-фильтры участников,
 * затем — элементы конкретного раздела (children). Поиск вынесен в верхний хедер.
 */
export function SubHeader({
  memberFilter,
  onMemberFilterChange,
  children,
  right,
}: {
  memberFilter: ReadonlySet<ID>
  onMemberFilterChange: (f: ReadonlySet<ID>) => void
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
      {children && <div className="subheader-controls">{children}</div>}

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
