// Вложение внутри текста заметки: картинка показывается прямо в тексте, прочие
// файлы — карточкой с иконкой (как в Apple Notes). В HTML хранится пустой
// <div data-note-att="id" …>, а сам файл лежит в хранилище вложений.

import { createContext, useContext, useEffect, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { Extension, Node, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import type { Attachment } from '../types'
import { attachmentUrl, isImageMime, usePendingUpload } from '../notes'
import { formatBytes } from '../utils'
import { IcoFile, IcoX } from '../icons'

export interface NoteAttContextValue {
  attachments: Attachment[]
  load: (att: Attachment) => Promise<Blob>
  openImage: (id: string) => void
  download: (att: Attachment) => void
}

export const NoteAttContext = createContext<NoteAttContextValue | null>(null)

export interface NoteAttAttrs {
  id: string
  name: string
  mime: string
  size: number
  w: number | null
  h: number | null
}

export const NoteAttachment = Node.create({
  name: 'noteAttachment',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    const data = (name: string, num = false) => ({
      default: null,
      parseHTML: (el: HTMLElement) => {
        const v = el.getAttribute(`data-${name}`)
        return num ? (v ? Number(v) : null) : v
      },
      renderHTML: (attrs: Record<string, unknown>) => {
        const key = name === 'note-att' ? 'id' : name
        const v = attrs[key]
        return v === null || v === undefined || v === '' ? {} : { [`data-${name}`]: String(v) }
      },
    })
    return {
      id: data('note-att'),
      name: data('name'),
      mime: data('mime'),
      size: data('size', true),
      w: data('w', true),
      h: data('h', true),
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-note-att]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(NoteAttachmentView)
  },
})

/** После вложения в самом конце всегда есть пустой абзац — чтобы было куда писать дальше. */
export const TrailingParagraph = Extension.create({
  name: 'trailingParagraph',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('trailingParagraph'),
        appendTransaction: (_trs, _old, state) => {
          const last = state.doc.lastChild
          if (!last || last.type.name !== 'noteAttachment') return null
          return state.tr.insert(state.doc.content.size, state.schema.nodes.paragraph.create())
        },
      }),
    ]
  },
})

function NoteAttachmentView({ node, selected, deleteNode }: NodeViewProps) {
  const ctx = useContext(NoteAttContext)
  const { id, name, mime, size, w, h } = node.attrs as NoteAttAttrs
  const att = ctx?.attachments.find((a) => a.id === id)
  const pend = usePendingUpload(id)
  const image = isImageMime(mime ?? '')
  const [url, setUrl] = useState<string | undefined>(pend?.url)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!image) return
    if (pend?.url && !pend.failed) {
      setUrl(pend.url)
      return
    }
    if (!att || !ctx) return
    let alive = true
    attachmentUrl(att, ctx.load)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, att?.id, pend?.url, pend?.failed])

  const uploading = !!pend && !pend.failed
  const uploadFailed = !!pend?.failed
  // Узел есть, а метаданных нет и загрузка идёт не у нас — файл ещё грузится на другом устройстве
  const missing = !att && !pend

  const remove = (e: ReactMouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    deleteNode()
  }

  const cls =
    'natt' + (image ? ' natt-image' : ' natt-file') + (selected ? ' natt-selected' : '') + (uploading ? ' natt-uploading' : '')

  const del = (
    <button type="button" className="natt-del" title="Убрать из заметки" aria-label="Убрать из заметки" onClick={remove}>
      <IcoX size={16} />
    </button>
  )

  if (image) {
    const ratio = w && h ? `${w} / ${h}` : undefined
    return (
      <NodeViewWrapper className={cls} data-drag-handle="" contentEditable={false}>
        <div
          role="button"
          tabIndex={-1}
          className="natt-img-box"
          style={{ aspectRatio: ratio, width: w ? Math.min(w, 720) : undefined }}
          onClick={() => att && ctx?.openImage(id)}
          title={name ?? ''}
        >
          {url ? (
            <img src={url} alt={name ?? ''} draggable={false} />
          ) : att?.thumb ? (
            <img src={att.thumb} alt="" className="natt-img-blur" draggable={false} />
          ) : (
            <span className="natt-img-ph">{failed ? 'Не удалось загрузить картинку' : missing ? 'Картинка загружается…' : ''}</span>
          )}
          {uploading && (
            <span className="natt-progress">
              <span className="spinner" />
            </span>
          )}
          {uploadFailed && <span className="natt-failed">Не загрузилось</span>}
          {del}
        </div>
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper className={cls} data-drag-handle="" contentEditable={false}>
      <div
        role="button"
        tabIndex={-1}
        className={'natt-file-box' + (att ? '' : ' disabled')}
        onClick={() => att && ctx?.download(att)}
        title={att ? 'Скачать' : undefined}
      >
        <span className="natt-file-ico" aria-hidden>
          {uploading ? <span className="spinner" /> : <IcoFile size={24} />}
        </span>
        <span className="natt-file-text">
          <span className="natt-file-name">{name ?? 'Файл'}</span>
          <span className="natt-file-meta">
            {uploadFailed ? 'Не загрузилось' : uploading ? 'Загрузка…' : missing ? 'Загружается…' : formatBytes(size ?? 0)}
          </span>
        </span>
        {del}
      </div>
    </NodeViewWrapper>
  )
}
