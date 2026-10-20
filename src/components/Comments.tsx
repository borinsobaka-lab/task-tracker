// Комментарии к задаче и к сделке: панель со списком (автор, аватар, дата-время, текст с
// форматированием), формой добавления и правкой/удалением своих. Контекст
// «прочитанного» — в commentsSeen.tsx.

import { useEffect, useMemo, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { useBoard } from '../store'
import type { Card, Comment, Deal, ID, Member } from '../types'
import { fmtDateTime, initials } from '../utils'
import { sanitizeCommentHtml } from '../richText'
import { Avatar } from './Avatar'
import { IcoComment } from '../icons'
import { EditorToolbar, richTextExtensions } from './RichTextEditor'
import { liveComments, useCommentsSeen } from './commentsSeen'

// ---------- Панель комментариев ----------

/** Что умеет делать с комментариями хозяин списка (задача или сделка) */
interface CommentsApi {
  add: (html: string) => void
  update: (commentId: ID, html: string) => void
  remove: (commentId: ID) => void
}

export function CommentsPanel({ card }: { card: Card }) {
  const store = useBoard()
  return (
    <CommentsThread
      ownerId={card.id}
      comments={card.comments}
      api={{
        add: (html) => store.addComment(card.id, html),
        update: (id, html) => store.updateComment(card.id, id, html),
        remove: (id) => store.removeComment(card.id, id),
      }}
    />
  )
}

export function DealCommentsPanel({ deal }: { deal: Deal }) {
  const store = useBoard()
  return (
    <CommentsThread
      ownerId={deal.id}
      comments={deal.comments}
      placeholder="Пока нет комментариев. Обсудите сделку здесь."
      api={{
        add: (html) => store.addDealComment(deal.id, html),
        update: (id, html) => store.updateDealComment(deal.id, id, html),
        remove: (id) => store.removeDealComment(deal.id, id),
      }}
    />
  )
}

function CommentsThread({
  ownerId,
  comments: all,
  api,
  placeholder = 'Пока нет комментариев. Напишите первый.',
}: {
  ownerId: ID
  comments: Comment[] | undefined
  api: CommentsApi
  placeholder?: string
}) {
  const store = useBoard()
  const { markSeen } = useCommentsSeen()
  const myId = store.identity?.id ?? null

  const comments = useMemo(
    () => liveComments({ comments: all }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [all],
  )

  // Открыли панель / появились новые комментарии — считаем прочитанными здесь
  useEffect(() => {
    markSeen(ownerId)
  }, [ownerId, all, markSeen])

  return (
    <aside className="cm-comments">
      <div className="cm-comments-head">
        <span className="field-label"><span className="inline-ico" aria-hidden><IcoComment size={14} /></span>Комментарии{comments.length ? ` · ${comments.length}` : ''}</span>
      </div>
      <CommentComposer onSubmit={api.add} />
      <div className="comment-list">
        {comments.length === 0 ? (
          <div className="muted comment-empty">{placeholder}</div>
        ) : (
          comments.map((c) => (
            <CommentItem
              key={c.id}
              comment={c}
              api={api}
              members={store.members}
              isMine={!!myId && c.authorId === myId}
            />
          ))
        )}
      </div>
    </aside>
  )
}

// ---------- Один комментарий ----------

function CommentItem({
  comment,
  api,
  members,
  isMine,
}: {
  comment: Comment
  api: CommentsApi
  members: Member[]
  isMine: boolean
}) {
  const [editing, setEditing] = useState(false)
  const author = comment.authorId ? members.find((m) => m.id === comment.authorId) : undefined
  const html = useMemo(() => sanitizeCommentHtml(comment.html), [comment.html])
  const when = fmtDateTime(new Date(comment.createdAt))

  const remove = () => {
    if (confirm('Удалить комментарий?')) api.remove(comment.id)
  }

  return (
    <div className="comment">
      <div className="comment-avatar">
        {author ? (
          <Avatar member={author} size="sm" />
        ) : (
          <span className="avatar sm" style={{ background: 'var(--text-faint)' }}>
            {initials(comment.authorName)}
          </span>
        )}
      </div>
      <div className="comment-body">
        <div className="comment-head">
          <span className="comment-author">{author?.name ?? comment.authorName}</span>
          <span className="comment-time">
            {when}
            {comment.editedAt ? ' · изменён' : ''}
          </span>
        </div>
        {editing ? (
          <CommentComposer
            initialHtml={comment.html}
            submitLabel="Сохранить"
            autoFocus
            onSubmit={(h) => {
              api.update(comment.id, h)
              setEditing(false)
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <>
            <div className="comment-content rte-content" dangerouslySetInnerHTML={{ __html: html }} />
            {isMine && (
              <div className="comment-actions">
                <button type="button" className="comment-action" onClick={() => setEditing(true)}>
                  Изменить
                </button>
                <button type="button" className="comment-action danger" onClick={remove}>
                  Удалить
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ---------- Форма (создание/правка) ----------

function CommentComposer({
  initialHtml = '',
  submitLabel = 'Отправить',
  autoFocus = false,
  onSubmit,
  onCancel,
}: {
  initialHtml?: string
  submitLabel?: string
  autoFocus?: boolean
  onSubmit: (html: string) => void
  onCancel?: () => void
}) {
  const editor = useEditor({
    extensions: richTextExtensions('Написать комментарий…'),
    content: initialHtml,
    autofocus: autoFocus ? 'end' : false,
    editorProps: { attributes: { class: 'rte-content comment-input' } },
  })

  const submit = () => {
    if (!editor || editor.isEmpty) return
    onSubmit(editor.getHTML())
    // Режим создания (нет «Отмены») — очищаем поле и оставляем фокус
    if (!onCancel) {
      editor.commands.clearContent()
      editor.commands.focus()
    }
  }

  return (
    <div
      className="rte comment-composer"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          submit()
        }
      }}
    >
      <EditorToolbar editor={editor} />
      <EditorContent editor={editor} />
      <div className="comment-composer-actions">
        {onCancel && (
          <button type="button" className="btn btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={onCancel}>
            Отмена
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onMouseDown={(e) => e.preventDefault()}
          onClick={submit}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  )
}
