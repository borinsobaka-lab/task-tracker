import { useEffect, useRef, useState } from 'react'
import type { ComponentType } from 'react'
import type { IconProps } from '@solar-icons/react'
import type { ViewKind } from '../App'
import { useBoard } from '../store'
import type { ID } from '../types'
import { Avatar } from './Avatar'
import { IcoBoard, IcoCalendar, IcoCheck, IcoChevronDown, IcoMatrix, IcoRecurring, IcoSettings } from '../icons'

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
  // Меню позиционируем fixed по координатам кнопки, чтобы оно не обрезалось
  // прокруткой шапки (overflow) на мобильном и было поверх всего.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const cur = VIEWS.find((v) => v.key === view) ?? VIEWS[0]
  const open = !!pos

  const toggle = () => {
    if (pos) {
      setPos(null)
      return
    }
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom + 5, left: r.left })
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPos(null)
    const onScroll = () => setPos(null)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  return (
    <div className="view-switch">
      <button
        ref={btnRef}
        className="view-switch-btn"
        onClick={toggle}
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
      {pos && (
        <>
          <div className="view-switch-backdrop" onClick={() => setPos(null)} />
          <div className="view-switch-menu" role="menu" style={{ position: 'fixed', top: pos.top, left: pos.left }}>
            {VIEWS.map((v) => (
              <button
                key={v.key}
                className={'view-switch-item' + (v.key === view ? ' active' : '')}
                role="menuitemradio"
                aria-checked={v.key === view}
                onClick={() => {
                  onViewChange(v.key)
                  setPos(null)
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
