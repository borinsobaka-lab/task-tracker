import { useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentType } from 'react'
import type { IconProps } from '@solar-icons/react'
import type { ViewKind } from '../App'
import { useBoard } from '../store'
import type { ID } from '../types'
import { QUADRANT_COLOR, QUADRANT_LABEL } from '../eisenhower'
import { cardMatchesQuery } from '../utils'
import { IcoBoard, IcoCalendar, IcoMatrix, IcoRecurring, IcoSearch, IcoSettings } from '../icons'
import './header.css'

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  synced: { text: 'Сохранено', cls: 'ok' },
  saving: { text: 'Сохранение…', cls: 'busy' },
  loading: { text: 'Загрузка…', cls: 'busy' },
  offline: { text: 'Офлайн — изменения сохранятся позже', cls: 'warn' },
  error: { text: 'Ошибка сохранения', cls: 'err' },
}

const VIEWS: { key: ViewKind; label: string; Icon: ComponentType<IconProps>; color: string }[] = [
  { key: 'board', label: 'Доска', Icon: IcoBoard, color: '#3b82f6' }, // синий
  { key: 'calendar', label: 'Календарь', Icon: IcoCalendar, color: '#f97316' }, // оранжевый
  { key: 'matrix', label: 'Матрица', Icon: IcoMatrix, color: '#ef4444' }, // красный
  { key: 'recurring', label: 'Повтор', Icon: IcoRecurring, color: '#22c55e' }, // зелёный
]

/** Верхний хедер: табы разделов, глобальный поиск и кнопка настроек. */
export function Header({
  view,
  onViewChange,
  onOpenSettings,
  onOpenCard,
}: {
  view: ViewKind
  onViewChange: (v: ViewKind) => void
  onOpenSettings: () => void
  onOpenCard: (id: ID) => void
}) {
  const store = useBoard()
  const status = STATUS_LABEL[store.status] ?? STATUS_LABEL.synced

  return (
    <header className="app-header">
      {/* Мобильная версия: разделы переехали в нижнюю навигацию, в шапке — название текущего */}
      <div className="header-title-mobile">{VIEWS.find((v) => v.key === view)?.label}</div>
      <nav className="view-tabs" aria-label="Вид">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            className={v.key === view ? 'active' : ''}
            onClick={() => onViewChange(v.key)}
            title={v.label}
          >
            <span className="view-ico" aria-hidden>
              <v.Icon size={17} color={v.color} />
            </span>
            <span className="view-tab-label">{v.label}</span>
          </button>
        ))}
      </nav>

      <SearchBox onOpenCard={onOpenCard} />

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

/** Нижняя навигация по разделам — только в мобильной версии (иконка + подпись).
 *  Справа после разделов — кнопка «+» для быстрого создания задачи. */
export function BottomNav({
  view,
  onViewChange,
  onNewTask,
}: {
  view: ViewKind
  onViewChange: (v: ViewKind) => void
  onNewTask: () => void
}) {
  return (
    <nav className="bottom-nav" aria-label="Разделы">
      {VIEWS.map((v) => {
        const active = v.key === view
        return (
          <button
            key={v.key}
            type="button"
            className={'bottom-nav-item' + (active ? ' active' : '')}
            style={active ? { color: v.color } : undefined}
            onClick={() => onViewChange(v.key)}
            aria-current={active ? 'page' : undefined}
          >
            <span className="bottom-nav-ico" aria-hidden>
              <v.Icon size={23} />
            </span>
            <span className="bottom-nav-label">{v.label}</span>
          </button>
        )
      })}
      <button
        type="button"
        className="bottom-nav-item bottom-nav-add"
        onClick={onNewTask}
        title="Добавить задачу"
        aria-label="Добавить задачу"
      >
        <span className="bottom-nav-add-circle" aria-hidden>+</span>
      </button>
    </nav>
  )
}

/** Глобальный поиск задач: поле на десктопе, кнопка+полноэкранный оверлей на телефоне. */
function SearchBox({ onOpenCard }: { onOpenCard: (id: ID) => void }) {
  const store = useBoard()
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  const results = useMemo(() => {
    const q = query.trim()
    if (!q) return []
    const cols = new Map(store.columns.map((c) => [c.id, c]))
    // Ищем задачи на доске (у них есть статус-колонка); встречи и регулярные вне доски пропускаем
    return store
      .liveCards()
      .filter((c) => cols.has(c.columnId) && cardMatchesQuery(c, q))
      .slice(0, 30)
      .map((c) => ({ card: c, column: cols.get(c.columnId)! }))
  }, [query, store])

  // Клик вне — закрыть выпадашку на десктопе
  useEffect(() => {
    if (!focused) return
    const onDown = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setFocused(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [focused])

  const pick = (id: ID) => {
    onOpenCard(id)
    setQuery('')
    setFocused(false)
    setMobileOpen(false)
  }

  const closeMobile = () => {
    setMobileOpen(false)
    setQuery('')
  }

  const list = (
    <div className="search-results" role="listbox">
      {results.length === 0 ? (
        <div className="search-empty muted">{query.trim() ? 'Ничего не найдено' : 'Начните вводить название задачи'}</div>
      ) : (
        results.map(({ card, column }) => (
          <button key={card.id} type="button" className="search-result" role="option" onClick={() => pick(card.id)}>
            <span className="search-result-title">{card.title}</span>
            <span className="search-result-tags">
              <span className="search-result-status" title="Статус">
                {column.color && <span className="search-status-dot" style={{ background: column.color }} />}
                {column.title}
              </span>
              {card.priority && (
                <span className="search-result-prio" style={{ color: QUADRANT_COLOR[card.priority] }} title="Приоритет">
                  ● {QUADRANT_LABEL[card.priority]}
                </span>
              )}
            </span>
          </button>
        ))
      )}
    </div>
  )

  return (
    <div className="header-search" ref={boxRef}>
      {/* Десктоп: поле после табов */}
      <div className="header-search-field">
        <span className="header-search-ico" aria-hidden>
          <IcoSearch size={16} />
        </span>
        <input
          className="header-search-input"
          type="search"
          placeholder="Поиск задач"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          aria-label="Поиск задач"
        />
        {focused && query.trim() && list}
      </div>

      {/* Мобильный: квадратная кнопка → полноэкранный поиск */}
      <button className="icon-btn header-search-btn" onClick={() => setMobileOpen(true)} title="Поиск" aria-label="Поиск">
        <IcoSearch size={20} />
      </button>
      {mobileOpen && (
        <div className="search-overlay" role="dialog" aria-modal="true">
          <div className="search-overlay-bar">
            <span className="header-search-ico" aria-hidden>
              <IcoSearch size={18} />
            </span>
            <input
              className="search-overlay-input"
              type="search"
              placeholder="Поиск задач"
              value={query}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Поиск задач"
            />
            <button className="btn btn-ghost btn-sm" onClick={closeMobile}>
              Отмена
            </button>
          </div>
          <div className="search-overlay-results">{list}</div>
        </div>
      )}
    </div>
  )
}
