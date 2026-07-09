// Модалка «История проекта»: журнал всех событий (создание/изменение/удаление
// задач, перемещения, комментарии, чек-листы, встречи, повтор, приоритеты…).
// Новые события сверху, сгруппированы по дням; клик по событию с задачей
// открывает её.

import { useEffect, useMemo } from 'react'
import { useBoard } from '../store'
import type { ActivityEntry, ActivityKind, ID } from '../types'
import { fmtFullDate, parseDateKey, toDateKey } from '../utils'
import { IcoX } from '../icons'
import { SheetGrabber } from './SheetGrabber'
import './history.css'

const ACT: Record<ActivityKind, { icon: string; verb: string }> = {
  'card.create': { icon: '🆕', verb: 'создал(а) задачу' },
  'card.delete': { icon: '🗑️', verb: 'удалил(а) задачу' },
  'card.rename': { icon: '✏️', verb: 'переименовал(а) задачу' },
  'card.describe': { icon: '📝', verb: 'изменил(а) описание' },
  'card.move': { icon: '↔️', verb: 'переместил(а) задачу' },
  'card.done': { icon: '✅', verb: 'выполнил(а) задачу' },
  'card.undone': { icon: '↩️', verb: 'вернул(а) в работу задачу' },
  'card.schedule': { icon: '📅', verb: 'изменил(а) срок' },
  'card.assign': { icon: '👥', verb: 'изменил(а) участников' },
  'comment.add': { icon: '💬', verb: 'оставил(а) комментарий к' },
  'comment.edit': { icon: '💬', verb: 'изменил(а) комментарий к' },
  'comment.delete': { icon: '💬', verb: 'удалил(а) комментарий к' },
  'checklist.add': { icon: '☑️', verb: 'добавил(а) пункт в' },
  'meeting.create': { icon: '📹', verb: 'добавил(а) встречу' },
  'meeting.delete': { icon: '🗑️', verb: 'удалил(а) встречу' },
  'meeting.recurring': { icon: '🔁', verb: 'сделал(а) встречу повторяющейся' },
  'series.add': { icon: '🔁', verb: 'добавил(а) повторяющуюся задачу' },
  'series.delete': { icon: '🔁', verb: 'удалил(а) повторение' },
  'priority.change': { icon: '⭐', verb: 'изменил(а) приоритет' },
  'attachment.add': { icon: '📎', verb: 'прикрепил(а) файл к' },
}

function detailPrefix(kind: ActivityKind): string {
  return kind === 'card.move' ? '→ ' : ''
}

function dayLabel(key: string, todayKey: string, yestKey: string): string {
  if (key === todayKey) return 'Сегодня'
  if (key === yestKey) return 'Вчера'
  return fmtFullDate(parseDateKey(key))
}

export function HistoryModal({ onClose, onOpenCard }: { onClose: () => void; onOpenCard: (id: ID) => void }) {
  const store = useBoard()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Новые сверху
  const entries = useMemo(() => [...store.activity()].reverse(), [store])

  const groups = useMemo(() => {
    const out: { key: string; items: ActivityEntry[] }[] = []
    for (const e of entries) {
      const key = toDateKey(new Date(e.ts))
      const g = out[out.length - 1]
      if (g && g.key === key) g.items.push(e)
      else out.push({ key, items: [e] })
    }
    return out
  }, [entries])

  const todayKey = toDateKey(new Date())
  const yestKey = toDateKey(new Date(Date.now() - 86400000))

  const openCard = (e: ActivityEntry) => {
    if (e.cardId && store.card(e.cardId)) {
      onOpenCard(e.cardId)
      onClose()
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal history-modal" role="dialog" aria-modal="true" aria-label="История проекта">
        <SheetGrabber onClose={onClose} />
        <header className="history-header">
          <h2>История проекта</h2>
          <button className="cm-close" onClick={onClose} title="Закрыть" aria-label="Закрыть">
            <IcoX size={22} />
          </button>
        </header>
        <div className="history-body">
          {entries.length === 0 ? (
            <div className="muted history-empty">
              Пока нет событий. Как только вы что-то измените на доске — здесь появится запись.
            </div>
          ) : (
            groups.map((g) => (
              <div className="history-group" key={g.key}>
                <div className="history-daylabel">{dayLabel(g.key, todayKey, yestKey)}</div>
                {g.items.map((e) => {
                  const meta = ACT[e.kind]
                  const clickable = !!(e.cardId && store.card(e.cardId))
                  const time = new Date(e.ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
                  return (
                    <div
                      key={e.id}
                      className={'history-row' + (clickable ? ' clickable' : '')}
                      onClick={() => openCard(e)}
                    >
                      <span className="history-ico" aria-hidden>
                        {meta?.icon ?? '•'}
                      </span>
                      <div className="history-main">
                        <div className="history-text">
                          <b>{e.actorName}</b> {meta?.verb ?? e.kind}
                          {e.cardTitle && <span className="history-card"> «{e.cardTitle}»</span>}
                        </div>
                        {e.detail && (
                          <div className="history-detail muted">
                            {detailPrefix(e.kind)}
                            {e.detail}
                          </div>
                        )}
                      </div>
                      <span className="history-time">{time}</span>
                    </div>
                  )
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
