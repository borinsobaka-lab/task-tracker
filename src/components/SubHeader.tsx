import type { ReactNode } from 'react'
import { useBoard } from '../store'
import type { ID } from '../types'
import { IcoSearch } from '../icons'
import { Avatar } from './Avatar'
import './subheader.css'

/**
 * Второй хедер (панель раздела): слева поиск, затем аватарки-фильтры участников,
 * затем — элементы конкретного раздела (children).
 */
export function SubHeader({
  memberFilter,
  onMemberFilterChange,
  search,
  onSearchChange,
  children,
}: {
  memberFilter: ReadonlySet<ID>
  onMemberFilterChange: (f: ReadonlySet<ID>) => void
  search: string
  onSearchChange: (s: string) => void
  children?: ReactNode
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
      <div className="subheader-search">
        <span className="subheader-search-ico" aria-hidden>
          <IcoSearch size={16} />
        </span>
        <input
          className="subheader-search-input"
          type="search"
          placeholder="Поиск"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label="Поиск задач"
        />
      </div>

      <div className="subheader-members" title="Фильтр по участникам">
        {store.members.map((m) => (
          <button
            key={m.id}
            className={`member-filter-btn${memberFilter.has(m.id) ? ' active' : ''}`}
            onClick={() => toggleMember(m.id)}
            title={`${m.name} — показать только его задачи`}
          >
            <Avatar member={m} size="sm" />
          </button>
        ))}
        {memberFilter.size > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={() => onMemberFilterChange(new Set())}>
            Сбросить
          </button>
        )}
      </div>

      {children && <div className="subheader-controls">{children}</div>}
    </div>
  )
}
