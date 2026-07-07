import { useEffect, useState } from 'react'
import type { ComponentType } from 'react'
import type { IconProps } from '@solar-icons/react'
import type { ViewKind } from '../App'
import { useBoard } from '../store'
import type { ID } from '../types'
import { Avatar } from './Avatar'
import { IcoBoard, IcoBrand, IcoCalendar, IcoCheck, IcoChevronDown, IcoMatrix, IcoRecurring, IcoSettings } from '../icons'

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  synced: { text: 'Сохранено', cls: 'ok' },
  saving: { text: 'Сохранение…', cls: 'busy' },
  loading: { text: 'Загрузка…', cls: 'busy' },
  offline: { text: 'Офлайн — изменения сохранятся позже', cls: 'warn' },
  error: { text: 'Ошибка сохранения', cls: 'err' },
}

const VIEWS: { key: ViewKind; label: string; Icon: ComponentType<IconProps> }[] = [
  { key: 'board', label: 'Доска', Icon: IcoBoard },
  { key: 'calendar', label: 'Календарь', Icon: IcoCalendar },
  { key: 'matrix', label: 'Матрица', Icon: IcoMatrix },
  { key: 'recurring', label: 'Регулярное', Icon: IcoRecurring },
]

/** Компактный выбор вида вместо ряда табов — экономит место в шапке. */
function ViewSwitch({ view, onViewChange }: { view: ViewKind; onViewChange: (v: ViewKind) => void }) {
  const [open, setOpen] = useState(false)
  const cur = VIEWS.find((v) => v.key === view) ?? VIEWS[0]

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className="view-switch">
      <button
        className="view-switch-btn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Сменить вид"
      >
        <span className="view-ico" aria-hidden>
          <cur.Icon size={17} />
        </span>
        <span className="view-switch-label">{cur.label}</span>
        <span className="view-switch-caret" aria-hidden>
          <IcoChevronDown size={14} />
        </span>
      </button>
      {open && (
        <>
          <div className="view-switch-backdrop" onClick={() => setOpen(false)} />
          <div className="view-switch-menu" role="menu">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                className={'view-switch-item' + (v.key === view ? ' active' : '')}
                role="menuitemradio"
                aria-checked={v.key === view}
                onClick={() => {
                  onViewChange(v.key)
                  setOpen(false)
                }}
              >
                <span className="view-ico" aria-hidden>
                  <v.Icon size={18} />
                </span>
                {v.label}
                {v.key === view && (
                  <span className="view-switch-check">
                    <IcoCheck size={16} />
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
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
      <span className="app-brand" title="Task Tracker" aria-hidden>
        <IcoBrand size={22} />
      </span>
      {/* На десктопе — табы, на мобильном — выпадающий список (переключается в CSS) */}
      <nav className="view-tabs" aria-label="Вид">
        {VIEWS.map((v) => (
          <button key={v.key} className={v.key === view ? 'active' : ''} onClick={() => onViewChange(v.key)}>
            <span className="view-ico" aria-hidden>
              <v.Icon size={17} />
            </span>
            <span className="view-tab-label">{v.label}</span>
          </button>
        ))}
      </nav>
      <ViewSwitch view={view} onViewChange={onViewChange} />

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
        <button className="icon-btn" onClick={onOpenSettings} title="Настройки" aria-label="Настройки">
          <IcoSettings size={20} />
        </button>
      </div>
    </header>
  )
}
