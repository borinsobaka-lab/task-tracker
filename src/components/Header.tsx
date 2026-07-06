import type { ViewKind } from '../App'
import { useBoard } from '../store'
import type { ID } from '../types'
import { Avatar } from './Avatar'

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  synced: { text: 'Сохранено', cls: 'ok' },
  saving: { text: 'Сохранение…', cls: 'busy' },
  loading: { text: 'Загрузка…', cls: 'busy' },
  offline: { text: 'Офлайн — изменения сохранятся позже', cls: 'warn' },
  error: { text: 'Ошибка сохранения', cls: 'err' },
}

export function Header({
  view,
  onViewChange,
  onOpenSettings,
  memberFilter,
  onMemberFilterChange,
}: {
  view: ViewKind
  onViewChange: (v: ViewKind) => void
  onOpenSettings: () => void
  memberFilter: ReadonlySet<ID>
  onMemberFilterChange: (f: ReadonlySet<ID>) => void
}) {
  const store = useBoard()
  const status = STATUS_LABEL[store.status] ?? STATUS_LABEL.synced

  const toggleMember = (id: ID) => {
    const next = new Set(memberFilter)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onMemberFilterChange(next)
  }

  return (
    <header className="app-header">
      <nav className="view-tabs" aria-label="Вид">
        <button className={view === 'board' ? 'active' : ''} onClick={() => onViewChange('board')}>
          Доска
        </button>
        <button className={view === 'calendar' ? 'active' : ''} onClick={() => onViewChange('calendar')}>
          Календарь
        </button>
        <button className={view === 'matrix' ? 'active' : ''} onClick={() => onViewChange('matrix')}>
          Матрица
        </button>
      </nav>

      <div className="header-members" title="Фильтр по участникам">
        {store.members.map((m) => (
          <button
            key={m.id}
            className={`member-filter-btn${memberFilter.has(m.id) ? ' active' : ''}`}
            onClick={() => toggleMember(m.id)}
            title={`${m.name} — показать только эти задачи`}
          >
            <Avatar member={m} />
          </button>
        ))}
        {memberFilter.size > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={() => onMemberFilterChange(new Set())}>
            Сбросить
          </button>
        )}
      </div>

      <div className="header-right">
        <span
          className={`sync-status ${status.cls}`}
          title={store.lastError ?? (store.lastSyncAt ? `Синхронизировано: ${new Date(store.lastSyncAt).toLocaleTimeString('ru-RU')}` : '')}
        >
          <span className="sync-dot" />
          {status.text}
        </span>
        {store.identity && <Avatar member={store.identity} title={`Вы: ${store.identity.name}`} />}
        <button className="icon-btn" onClick={onOpenSettings} title="Настройки" aria-label="Настройки">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
    </header>
  )
}
