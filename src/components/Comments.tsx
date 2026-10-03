// Комментарии к задаче: панель со списком (автор, аватар, дата-время, текст с
// форматированием), формой добавления и правкой/удалением своих. Контекст
// «прочитанного» — в commentsSeen.tsx.

import { useEffect, useMemo, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { useBoard } from '../store'
import type { Card, Comment, Member } from '../types'
import { fmtDateTime, initials } from '../utils'
import { sanitizeCommentHtml } from '../richText'
import { Avatar } from './Avatar'
import { IcoComment } from '../icons'
import { EditorToolbar, richTextExtensions } from './RichTextEditor'
import { liveComments, useCommentsSeen } from './commentsSeen'

// ---------- Панель комментариев ----------

export function CommentsPanel({ card }: { card: Card }) {
  const store = useBoard()
  const { markSeen } = useCommentsSeen()
  const myId = store.identity?.id ?? null

  const comments = useMemo(
    () => liveComments(card).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [card],
  )

  // Открыли панель / появились новые комментарии — считаем прочитанными здесь
  useEffect(() => {
    markSeen(card.id)
  }, [card.id, card.comments, markSeen])

  return (
    <aside className="cm-comments">
      <div className="cm-comments-head">
        <span className="field-label"><span className="inline-ico" aria-hidden><IcoComment size={14} /></span>Комментарии{comments.length ? ` · ${comments.length}` : ''}</span>
      </div>
      <CommentComposer onSubmit={(html) => store.addComment(card.id, html)} />
      <div className="comment-list">
        {comments.length === 0 ? (
          <div className="muted comment-empty">Пока нет комментариев. Напишите первый.</div>
        ) : (
          comments.map((c) => (
            <CommentItem
              key={c.id}
              card={card}
              comment={c}
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
  card,
  comment,
  members,
  isMine,
}: {
  card: Card
  comment: Comment
  members: Member[]
  isMine: boolean
}) {
  const store = useBoard()
  const [editing, setEditing] = useState(false)
  const author = comment.authorId ? members.find((m) => m.id === comment.authorId) : undefined
  const html = useMemo(() => sanitizeCommentHtml(comment.html), [comment.html])
  const when = fmtDateTime(new Date(comment.createdAt))

  const remove = () => {
    if (confirm('Удалить комментарий?')) store.removeComment(card.id, comment.id)
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
              store.updateComment(card.id, comment.id, h)
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
