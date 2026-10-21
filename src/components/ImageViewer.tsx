// Просмотр картинки-вложения на весь экран (заметки и задачи): картинка
// открывается прямо в приложении, скачивать файл не нужно. Рендерится в
// document.body, чтобы не зависеть от модалки, из которой его открыли.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Attachment } from '../types'
import { attachmentUrl } from '../notes'
import { IcoX } from '../icons'
import './image-viewer.css'

export function ImageViewer({
  att,
  load,
  onClose,
  onDownload,
  onRemove,
  removeLabel = 'Убрать',
}: {
  att: Attachment
  load: (att: Attachment) => Promise<Blob>
  onClose: () => void
  onDownload: () => void
  onRemove?: () => void
  removeLabel?: string
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    setUrl(null)
    setFailed(false)
    attachmentUrl(att, load)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [att, load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="note-viewer" role="dialog" aria-modal="true" aria-label={att.name} onClick={onClose}>
      <div className="note-viewer-bar" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="note-viewer-btn" onClick={onClose} aria-label="Закрыть">
          <IcoX size={24} />
        </button>
        <span className="note-viewer-name">{att.name}</span>
        <button type="button" className="note-viewer-btn text" onClick={onDownload}>
          Скачать
        </button>
        {onRemove && (
          <button type="button" className="note-viewer-btn text danger" onClick={onRemove}>
            {removeLabel}
          </button>
        )}
      </div>
      <div className="note-viewer-body">
        {url ? (
          <img src={url} alt={att.name} onClick={(e) => e.stopPropagation()} />
        ) : failed ? (
          <span className="note-viewer-error">Не удалось загрузить картинку</span>
        ) : att.thumb ? (
          <img src={att.thumb} alt="" className="natt-img-blur" />
        ) : (
          <span className="spinner" />
        )}
      </div>
    </div>,
    document.body,
  )
}
