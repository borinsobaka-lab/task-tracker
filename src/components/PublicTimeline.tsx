import { useEffect, useState } from 'react'
import type { TLItem } from '../timelineShare'
import { rawTimelineUrl } from '../timelineShare'
import { TimelineView } from './TimelineView'
import { IcoBrand } from '../icons'
import './calendar.css'

const REFRESH_MS = 60_000 // как часто перечитывать публичный timeline.json

/**
 * Публичная страница-демонстрация таймлайна: только просмотр, без авторизации,
 * без возможности нажимать/редактировать. Два режима:
 *  - live: сама подтягивает актуальный timeline.json и обновляется (для виджета);
 *  - снимок: показывает переданный items (старые одноразовые ссылки).
 */
export function PublicTimeline({ items, live }: { items?: TLItem[]; live?: boolean }) {
  const [data, setData] = useState<TLItem[] | null>(items ?? null)
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>(items ? 'ok' : 'loading')
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)

  useEffect(() => {
    if (!live) return
    let stopped = false
    const load = async () => {
      try {
        const res = await fetch(`${rawTimelineUrl()}?t=${Date.now()}`, { cache: 'no-store' })
        if (!res.ok) throw new Error(String(res.status))
        const json = await res.json()
        if (stopped) return
        const arr: TLItem[] = Array.isArray(json?.items) ? json.items : Array.isArray(json) ? json : []
        setData(arr)
        setUpdatedAt(typeof json?.generatedAt === 'string' ? json.generatedAt : null)
        setStatus('ok')
      } catch {
        // не затираем уже показанные данные при временной ошибке сети
        if (!stopped) setStatus((s) => (s === 'ok' ? 'ok' : 'error'))
      }
    }
    void load()
    const t = setInterval(load, REFRESH_MS)
    return () => {
      stopped = true
      clearInterval(t)
    }
  }, [live])

  const updLabel = updatedAt
    ? `обновлено ${new Date(updatedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
    : null

  return (
    <div className="public-tl">
      <header className="public-tl-head">
        <span className="public-tl-logo" aria-hidden>
          <IcoBrand size={18} />
        </span>
        <span className="public-tl-title">Таймлайн</span>
        {updLabel && <span className="public-tl-upd">{updLabel}</span>}
        <span className="public-tl-note">только просмотр</span>
      </header>
      {data ? (
        <TimelineView items={data} interactive={false} />
      ) : status === 'error' ? (
        <div className="tl-empty muted">Не удалось загрузить таймлайн. Он появится после первой публикации.</div>
      ) : (
        <div className="tl-empty muted">Загрузка…</div>
      )}
    </div>
  )
}
