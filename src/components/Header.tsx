import type { ComponentType } from 'react'
import type { IconProps } from '@solar-icons/react'
import type { ViewKind } from '../App'
import { useBoard } from '../store'
import { IcoBoard, IcoCalendar, IcoMatrix, IcoRecurring, IcoSettings } from '../icons'

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

/** Верхний хедер: только табы разделов и кнопка настроек. */
export function Header({
  view,
  onViewChange,
  onOpenSettings,
}: {
  view: ViewKind
  onViewChange: (v: ViewKind) => void
  onOpenSettings: () => void
}) {
  const store = useBoard()
  const status = STATUS_LABEL[store.status] ?? STATUS_LABEL.synced

  return (
    <header className="app-header">
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
