import type { TLItem } from '../timelineShare'
import { TimelineView } from './TimelineView'
import { IcoBrand } from '../icons'
import './calendar.css'

/**
 * Публичная страница-демонстрация таймлайна: только просмотр, без авторизации,
 * без возможности нажимать/редактировать задачи. Открывается по ссылке-снимку.
 */
export function PublicTimeline({ items }: { items: TLItem[] }) {
  return (
    <div className="public-tl">
      <header className="public-tl-head">
        <span className="public-tl-logo" aria-hidden>
          <IcoBrand size={18} />
        </span>
        <span className="public-tl-title">Таймлайн</span>
        <span className="public-tl-note">только просмотр</span>
      </header>
      <TimelineView items={items} interactive={false} />
    </div>
  )
}
