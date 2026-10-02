// Раздел «Заметки» — по мотивам Apple Notes.
// Десктоп: слева список (закреплённые сверху, дальше группы по дате изменения),
// справа открытая заметка. Телефон: список на весь экран, заметка открывается
// поверх (кнопка «‹ Заметки» и системное «назад» возвращают к списку), панель
// форматирования стоит над клавиатурой. Всё сохраняется само, пустые заметки
// при уходе удаляются.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties, MutableRefObject, PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { NodeSelection, Selection } from '@tiptap/pm/state'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { useBoard } from '../store'
import type { Attachment, ID, Note, Project } from '../types'
import { isMobileViewport } from '../config'
import {
  addPendingUpload,
  attachmentUrl,
  finishPendingUpload,
  NOTE_MAX_FILE_SIZE,
  noteDisplayTitle,
  noteGroupLabel,
  noteLongDate,
  noteMatchesQuery,
  notePreview,
  noteShortDate,
  noteThumb,
  NOTES_COLOR,
  prepareNoteFile,
} from '../notes'
import { formatBytes, inProjectFilter, uid } from '../utils'
import { EditorToolbar, RteButton, richTextExtensions, useSyncedEditor } from './RichTextEditor'
import { NoteAttachment, NoteAttContext, TrailingParagraph } from './NoteAttachmentNode'
import type { NoteAttContextValue } from './NoteAttachmentNode'
import { ProjectAvatar } from './Avatar'
import {
  IcoArrowLeft,
  IcoCamera,
  IcoCheck,
  IcoChecklist,
  IcoChevronDown,
  IcoCompose,
  IcoFile,
  IcoGallery,
  IcoNone,
  IcoNotes,
  IcoPaperclip,
  IcoPin,
  IcoSearch,
  IcoTrash,
  IcoX,
} from '../icons'
import './notes.css'

/** Загрузки файлов идут по одной: параллельные коммиты в одну ветку GitHub конфликтуют. */
let uploadQueue: Promise<unknown> = Promise.resolve()
function enqueueUpload<T>(fn: () => Promise<T>): Promise<T> {
  const run = uploadQueue.then(fn, fn)
  uploadQueue = run.catch(() => {})
  return run
}

/**
 * composeRef — сюда раздел кладёт функцию «новая заметка», чтобы кнопка «+» в нижнем
 * меню вызывала её прямо в обработчике нажатия (важно для клавиатуры на iOS).
 * projectFilter — выбранные в шапке проекты (пустой набор — «Все»): показываем только их заметки.
 */
export function NotesView({
  composeRef,
  projectFilter,
}: {
  composeRef: MutableRefObject<(() => void) | null>
  projectFilter: ReadonlySet<ID>
}) {
  const store = useBoard()
  const [openId, setOpenId] = useState<ID | null>(null)
  const [query, setQuery] = useState('')
  const [swipedId, setSwipedId] = useState<ID | null>(null)
  const [freshId, setFreshId] = useState<ID | null>(null) // только что созданная — фокус в название
  const openIdRef = useRef(openId)
  openIdRef.current = openId
  const pushedRef = useRef(false) // на телефоне открытие заметки кладёт шаг в историю («назад» закрывает)

  // store.notes — уже без заметок закрытых для участника проектов
  const notes = useMemo(
    () => (projectFilter.size === 0 ? store.notes : store.notes.filter((n) => inProjectFilter(n.projectId, projectFilter))),
    [store.notes, projectFilter],
  )
  const visible = useMemo(() => notes.filter((n) => noteMatchesQuery(n, query)), [notes, query])
  const openNote = openId ? store.note(openId) : undefined

  // Уход из заметки: пустую удаляем, вложения, убранные из текста, стираем.
  // С задержкой — чтобы редактор успел досохранить текст при размонтировании.
  const leave = (id: ID | null) => {
    if (!id) return
    setTimeout(() => store.cleanupNote(id), 80)
  }

  // «Назад» по истории асинхронный: пока он не отработал, новую заметку не
  // открываем (иначе запоздалый popstate закрыл бы уже её) — откладываем.
  const backPending = useRef(false)
  const deferred = useRef<(() => void) | null>(null)
  const goBackInHistory = () => {
    pushedRef.current = false
    backPending.current = true
    history.back()
    setTimeout(settleBack, 700) // на случай, если popstate так и не придёт
  }
  const settleBack = () => {
    if (!backPending.current) return
    backPending.current = false
    const fn = deferred.current
    deferred.current = null
    fn?.()
  }

  const open = (id: ID) => {
    setSwipedId(null)
    if (backPending.current) {
      deferred.current = () => open(id)
      return
    }
    if (openIdRef.current === id) return
    leave(openIdRef.current)
    setOpenId(id)
    if (isMobileViewport() && !pushedRef.current) {
      history.pushState({ ttNote: true }, '')
      pushedRef.current = true
    }
  }

  const close = () => {
    leave(openIdRef.current)
    setOpenId(null)
    if (pushedRef.current) goBackInHistory()
  }

  // iOS показывает клавиатуру, только если фокус поставлен прямо в обработчике
  // нажатия. Заметка появится чуть позже — поэтому сразу фокусируем невидимое поле,
  // а название заметки перехватит фокус (клавиатура при этом не закрывается).
  const kbProxyRef = useRef<HTMLInputElement>(null)

  const compose = () => {
    if (isMobileViewport()) kbProxyRef.current?.focus({ preventScroll: true })
    // Выбраны проекты в шапке — новая заметка сразу относится к первому из них
    // (иначе пропала бы из отфильтрованного списка)
    const id = store.addNote(store.projects.find((p) => projectFilter.has(p.id))?.id)
    setFreshId(id)
    setQuery('')
    open(id)
  }

  // Системное «назад» (телефон, Android-оболочка) закрывает открытую заметку
  useEffect(() => {
    const onPop = () => {
      if (backPending.current) {
        settleBack() // это наш собственный шаг назад
        return
      }
      if (!pushedRef.current) return
      pushedRef.current = false
      leave(openIdRef.current)
      setOpenId(null)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Уходим из раздела — прибираем открытую заметку и шаг истории
  useEffect(() => {
    return () => {
      leave(openIdRef.current)
      if (pushedRef.current) {
        pushedRef.current = false
        history.back()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // «+» в нижнем меню телефона в этом разделе создаёт заметку
  useEffect(() => {
    composeRef.current = compose
    return () => {
      composeRef.current = null
    }
  })

  // Десктоп: как в Apple Notes, сразу открыта самая свежая заметка
  useEffect(() => {
    if (!openId && !isMobileViewport() && visible.length > 0) setOpenId(visible[0].id)
  }, [openId, visible])

  // Открытую заметку удалили (здесь или на другом устройстве) — закрываем
  useEffect(() => {
    if (openId && !openNote) {
      setOpenId(null)
      if (pushedRef.current) goBackInHistory()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, openNote])

  const remove = (note: Note) => {
    setSwipedId(null)
    const t = noteDisplayTitle(note)
    if (!confirm(`Удалить заметку «${t}»?`)) return
    store.deleteNote(note.id)
  }

  const togglePin = (note: Note) => {
    setSwipedId(null)
    store.setNotePinned(note.id, !note.pinned)
  }

  // Группы: «Закреплённые», затем по дате изменения
  const groups = useMemo(() => {
    const out: { label: string; items: Note[] }[] = []
    const now = new Date()
    for (const n of visible) {
      const label = n.pinned ? 'Закреплённые' : noteGroupLabel(n.updatedAt, now)
      const last = out[out.length - 1]
      if (last && last.label === label) last.items.push(n)
      else out.push({ label, items: [n] })
    }
    return out
  }, [visible])

  return (
    <div className={'notes' + (openNote ? ' notes-has-open' : '')} style={{ '--notes-color': NOTES_COLOR } as CSSProperties}>
      <input ref={kbProxyRef} className="notes-kb-proxy" aria-hidden tabIndex={-1} />
      <aside className="notes-list-pane">
        <div className="notes-list-head">
          <div className="notes-list-title">
            <span className="notes-list-ico" aria-hidden>
              <IcoNotes size={20} color={NOTES_COLOR} />
            </span>
            Заметки
            <span className="notes-count">{notes.length || ''}</span>
          </div>
          <button type="button" className="icon-btn notes-compose" onClick={compose} title="Новая заметка" aria-label="Новая заметка">
            <IcoCompose size={22} color={NOTES_COLOR} />
          </button>
        </div>
        <div className="notes-search">
          <span className="notes-search-ico" aria-hidden>
            <IcoSearch size={16} />
          </span>
          <input
            type="search"
            className="notes-search-input"
            placeholder="Поиск"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Поиск заметок"
          />
        </div>
        <div className="notes-list" onScroll={() => swipedId && setSwipedId(null)}>
          {notes.length === 0 ? (
            <div className="notes-empty">
              <div className="notes-empty-ico" aria-hidden>
                <IcoNotes size={44} color={NOTES_COLOR} />
              </div>
              <div className="notes-empty-title">{projectFilter.size ? 'В выбранных проектах заметок пока нет' : 'Заметок пока нет'}</div>
              <div className="muted">Записывайте мысли, списки, фото и файлы — всё сохранится само.</div>
              <button type="button" className="btn btn-primary notes-empty-btn" onClick={compose}>
                Новая заметка
              </button>
            </div>
          ) : visible.length === 0 ? (
            <div className="notes-empty muted">Ничего не найдено</div>
          ) : (
            groups.map((g) => (
              <section className="notes-group" key={g.label}>
                <h3 className="notes-group-title">
                  {g.label === 'Закреплённые' && (
                    <span className="notes-group-pin" aria-hidden>
                      <IcoPin size={13} />
                    </span>
                  )}
                  {g.label}
                </h3>
                <div className="notes-group-items">
                  {g.items.map((n) => (
                    <NoteRow
                      key={n.id}
                      note={n}
                      active={n.id === openId}
                      swiped={n.id === swipedId}
                      onSwipe={(open) => setSwipedId(open ? n.id : null)}
                      onOpen={() => open(n.id)}
                      onPin={() => togglePin(n)}
                      onDelete={() => remove(n)}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </aside>

      <section className="notes-editor-pane">
        {openNote ? (
          <NoteEditor
            key={openNote.id}
            note={openNote}
            autoFocus={openNote.id === freshId}
            onBack={close}
            onPin={() => togglePin(openNote)}
            onDelete={() => remove(openNote)}
          />
        ) : (
          <div className="notes-editor-empty muted">
            {notes.length ? 'Выберите заметку слева' : 'Создайте первую заметку'}
          </div>
        )}
      </section>
    </div>
  )
}

// ---------- Строка списка (со свайпом на телефоне) ----------

const ACTIONS_W = 148 // ширина кнопок, открывающихся свайпом влево

function NoteRow({
  note,
  active,
  swiped,
  onSwipe,
  onOpen,
  onPin,
  onDelete,
}: {
  note: Note
  active: boolean
  swiped: boolean
  onSwipe: (open: boolean) => void
  onOpen: () => void
  onPin: () => void
  onDelete: () => void
}) {
  const store = useBoard()
  const author = note.authorId ? store.members.find((m) => m.id === note.authorId) : undefined
  const project = note.projectId ? store.projects.find((p) => p.id === note.projectId) : undefined
  const thumb = noteThumb(note)
  const contentRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; dx: number; axis: 'x' | 'y' | null } | null>(null)
  const suppressClick = useRef(false)

  const setX = (x: number, animate: boolean) => {
    const el = contentRef.current
    if (!el) return
    el.style.transition = animate ? 'transform 0.2s ease' : 'none'
    el.style.transform = x ? `translateX(${x}px)` : ''
  }

  useEffect(() => {
    setX(swiped ? -ACTIONS_W : 0, true)
  }, [swiped])

  const down = (e: ReactPointerEvent) => {
    if (e.pointerType === 'mouse') return // на десктопе — кнопки при наведении
    drag.current = { x: e.clientX, y: e.clientY, dx: 0, axis: null }
  }
  const move = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      d.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      if (d.axis === 'x') (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    }
    if (d.axis !== 'x') return
    const base = swiped ? -ACTIONS_W : 0
    d.dx = dx
    setX(Math.min(0, Math.max(-ACTIONS_W - 40, base + dx)), false)
  }
  const up = () => {
    const d = drag.current
    drag.current = null
    if (!d || d.axis !== 'x') return
    suppressClick.current = true
    const base = swiped ? -ACTIONS_W : 0
    const openNow = base + d.dx < -ACTIONS_W / 2
    setX(openNow ? -ACTIONS_W : 0, true)
    onSwipe(openNow)
  }

  const click = () => {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    if (swiped) {
      onSwipe(false)
      return
    }
    onOpen()
  }

  return (
    <div className={'note-row' + (active ? ' active' : '')}>
      <div className="note-row-actions" aria-hidden={!swiped}>
        <button type="button" className="note-row-act pin" onClick={onPin} tabIndex={swiped ? 0 : -1}>
          <IcoPin size={20} />
          <span>{note.pinned ? 'Открепить' : 'Закрепить'}</span>
        </button>
        <button type="button" className="note-row-act del" onClick={onDelete} tabIndex={swiped ? 0 : -1}>
          <IcoTrash size={20} />
          <span>Удалить</span>
        </button>
      </div>
      <div
        ref={contentRef}
        className="note-row-main"
        role="button"
        tabIndex={0}
        onClick={click}
        onKeyDown={(e) => e.key === 'Enter' && onOpen()}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <div className="note-row-text">
          <div className="note-row-title">{noteDisplayTitle(note)}</div>
          <div className="note-row-sub">
            <span className="note-row-date">{noteShortDate(note.updatedAt)}</span>
            <span className="note-row-preview">{notePreview(note)}</span>
          </div>
          {(project || author) && (
            <div className="note-row-author">
              {project && (
                <span className="note-row-project">
                  <ProjectAvatar project={project} size="xs" />
                  {project.name || 'Проект'}
                </span>
              )}
              {project && author && ' · '}
              {author?.name}
            </div>
          )}
        </div>
        {thumb && <img className="note-row-thumb" src={thumb} alt="" draggable={false} />}
        <div className="note-row-hover" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="icon-btn" title={note.pinned ? 'Открепить' : 'Закрепить'} onClick={onPin}>
            <IcoPin size={16} />
          </button>
          <button type="button" className="icon-btn" title="Удалить" onClick={onDelete}>
            <IcoTrash size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------- Открытая заметка ----------

/** Видимая часть экрана над клавиатурой (телефон) — чтобы панель форматирования стояла над ней. */
function useVisualViewportBox(): { top: number; height: number } | null {
  const [box, setBox] = useState<{ top: number; height: number } | null>(null)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => setBox({ top: vv.offsetTop, height: vv.height })
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])
  return box
}

const TITLE_DEBOUNCE_MS = 500
const isTouch = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

function NoteEditor({
  note,
  autoFocus,
  onBack,
  onPin,
  onDelete,
}: {
  note: Note
  autoFocus: boolean
  onBack: () => void
  onPin: () => void
  onDelete: () => void
}) {
  const store = useBoard()
  const storeRef = useRef(store)
  storeRef.current = store
  const noteId = note.id
  const box = useVisualViewportBox()

  // --- название: локальное состояние + отложенное сохранение ---
  const [title, setTitle] = useState(note.title)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const titleFocused = useRef(false)
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingTitle = useRef<string | null>(null)
  const flushTitle = () => {
    if (titleTimer.current) clearTimeout(titleTimer.current)
    titleTimer.current = null
    if (pendingTitle.current !== null) {
      storeRef.current.updateNote(noteId, { title: pendingTitle.current })
      pendingTitle.current = null
    }
  }
  const changeTitle = (v: string) => {
    const clean = v.replace(/\n/g, ' ')
    setTitle(clean)
    pendingTitle.current = clean
    if (titleTimer.current) clearTimeout(titleTimer.current)
    titleTimer.current = setTimeout(flushTitle, TITLE_DEBOUNCE_MS)
  }
  useEffect(() => {
    if (!titleFocused.current && pendingTitle.current === null) setTitle(note.title)
  }, [note.title])
  useEffect(() => () => flushTitle(), []) // eslint-disable-line react-hooks/exhaustive-deps

  // Высота поля названия по содержимому
  useEffect(() => {
    const el = titleRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [title])

  // --- вставка файлов (кнопки, вставка из буфера, перетаскивание) ---
  const editorRef = useRef<Editor | null>(null)
  const insertFiles = async (files: File[], pos?: number) => {
    const ed = editorRef.current
    if (!ed) return
    let at = pos
    for (const raw of files) {
      if (raw.size > NOTE_MAX_FILE_SIZE) {
        alert(`Файл «${raw.name}» весит ${formatBytes(raw.size)}. Максимальный размер — 15 МБ.`)
        continue
      }
      const { file, thumb, w, h } = await prepareNoteFile(raw)
      const id = uid()
      addPendingUpload(id, file)
      const node = {
        type: 'noteAttachment',
        attrs: { id, name: file.name, mime: file.type || 'application/octet-stream', size: file.size, w: w ?? null, h: h ?? null },
      }
      if (ed.isDestroyed) break
      if (at !== undefined) {
        ed.chain().insertContentAt(at, node).run()
        at = undefined // следующие — сразу после вставленного
      } else {
        ed.chain().focus().insertContent(node).run()
      }
      // После вставки выделен сам узел — переносим курсор за него, иначе следующая
      // вставка (или набранный текст) заменила бы только что вставленный файл.
      const sel = ed.state.selection
      if (sel instanceof NodeSelection) {
        ed.view.dispatch(ed.state.tr.setSelection(Selection.near(ed.state.doc.resolve(sel.to), 1)))
      }
      const store = storeRef.current
      enqueueUpload(() => store.uploadNoteAttachment(noteId, file, { id, thumb, w, h }))
        .then(() => finishPendingUpload(id))
        .catch((e) => {
          finishPendingUpload(id, true)
          alert(`Не удалось загрузить «${file.name}»: ${e instanceof Error ? e.message : String(e)}`)
        })
    }
  }
  const insertRef = useRef(insertFiles)
  insertRef.current = insertFiles

  const htmlRef = useRef(note.html)
  const editor = useSyncedEditor({
    value: note.html,
    onChange: (html) => storeRef.current.updateNote(noteId, { html }),
    onLocalUpdate: (html) => {
      htmlRef.current = html
    },
    className: 'rte-content note-content',
    extensions: [
      ...richTextExtensions('Начните писать…'),
      TaskList,
      TaskItem.configure({ nested: true }),
      NoteAttachment,
      TrailingParagraph,
    ],
    editorProps: {
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? [])
        if (files.length === 0) return false
        event.preventDefault()
        void insertRef.current(files)
        return true
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false
        const files = Array.from(event.dataTransfer?.files ?? [])
        if (files.length === 0) return false
        event.preventDefault()
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
        void insertRef.current(files, pos)
        return true
      },
    },
  })
  editorRef.current = editor

  // Новая заметка — курсор сразу в названии (до отрисовки, чтобы не терялись первые буквы)
  useLayoutEffect(() => {
    if (autoFocus) titleRef.current?.focus({ preventScroll: true })
  }, [autoFocus])

  // --- меню «Прикрепить» ---
  const [attachOpen, setAttachOpen] = useState(false)
  const photoInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const pick = (input: RefObject<HTMLInputElement>) => {
    setAttachOpen(false)
    input.current?.click()
  }
  const onPicked = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.currentTarget.files ? Array.from(e.currentTarget.files) : []
    e.currentTarget.value = ''
    if (files.length) void insertFiles(files)
  }

  // --- просмотр картинки ---
  const [viewerId, setViewerId] = useState<string | null>(null)
  const viewerAtt = viewerId ? note.attachments.find((a) => a.id === viewerId) : undefined

  const download = (att: Attachment) => {
    store.downloadAttachment(att).catch((e) => alert(`Не удалось скачать файл: ${e instanceof Error ? e.message : String(e)}`))
  }

  const removeNodeById = (id: string) => {
    const ed = editorRef.current
    if (!ed) return
    let from = -1
    let size = 0
    ed.state.doc.descendants((n, pos) => {
      if (from < 0 && n.type.name === 'noteAttachment' && n.attrs.id === id) {
        from = pos
        size = n.nodeSize
      }
      return from < 0
    })
    if (from >= 0) ed.view.dispatch(ed.state.tr.delete(from, from + size))
  }

  const ctx: NoteAttContextValue = {
    attachments: note.attachments,
    load: store.attachmentBlob,
    openImage: setViewerId,
    download,
  }

  const author = note.authorId ? store.members.find((m) => m.id === note.authorId) : undefined
  const style = box ? ({ '--vv-top': `${box.top}px`, '--vv-h': `${box.height}px` } as CSSProperties) : undefined

  return (
    <div className="note-editor" style={style}>
      <div className="note-topbar">
        <button type="button" className="note-back" onClick={onBack}>
          <IcoArrowLeft size={22} />
          Заметки
        </button>
        <div className="note-topbar-actions">
          <button
            type="button"
            className={'icon-btn note-pin-btn' + (note.pinned ? ' on' : '')}
            onClick={onPin}
            title={note.pinned ? 'Открепить' : 'Закрепить'}
            aria-label={note.pinned ? 'Открепить' : 'Закрепить'}
            aria-pressed={!!note.pinned}
          >
            <IcoPin size={20} />
          </button>
          <button type="button" className="icon-btn" onClick={onDelete} title="Удалить заметку" aria-label="Удалить заметку">
            <IcoTrash size={20} />
          </button>
        </div>
      </div>

      <NoteAttContext.Provider value={ctx}>
        <div className="note-scroll">
          <div className="note-paper">
            <div className="note-date">
              {noteLongDate(note.updatedAt)}
              {author ? ` · ${author.name}` : ''}
            </div>
            <NoteProjectPicker note={note} />
            <textarea
              ref={titleRef}
              className="note-title"
              rows={1}
              placeholder="Название"
              value={title}
              onChange={(e) => changeTitle(e.target.value)}
              onFocus={() => (titleFocused.current = true)}
              onBlur={() => {
                titleFocused.current = false
                flushTitle()
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && editor) {
                  e.preventDefault()
                  editor.view.focus() // сразу (commands.focus откладывает до следующего кадра)
                  editor.commands.focus('start')
                }
              }}
              aria-label="Название заметки"
            />
            <EditorContent editor={editor} />
          </div>
        </div>
      </NoteAttContext.Provider>

      <div className="note-format">
        {/* Чек-лист и вложения — первыми: на телефоне панель узкая и прокручивается */}
        <EditorToolbar
          editor={editor}
          compact
          leading={
            <>
              <RteButton title="Чек-лист" active={!!editor?.isActive('taskList')} onClick={() => editor?.chain().focus().toggleTaskList().run()}>
                <IcoChecklist size={17} />
              </RteButton>
              <span className="note-attach-wrap">
                <RteButton title="Прикрепить фото или файл" active={attachOpen} onClick={() => setAttachOpen((v) => !v)}>
                  <IcoPaperclip size={17} />
                </RteButton>
                {attachOpen && (
                  <>
                    <div className="note-attach-backdrop" onClick={() => setAttachOpen(false)} />
                    <div className="note-attach-menu" role="menu">
                      <button type="button" role="menuitem" onClick={() => pick(photoInput)}>
                        <IcoGallery size={18} /> Фото или видео
                      </button>
                      {isTouch() && (
                        <button type="button" role="menuitem" onClick={() => pick(cameraInput)}>
                          <IcoCamera size={18} /> Сделать фото
                        </button>
                      )}
                      <button type="button" role="menuitem" onClick={() => pick(fileInput)}>
                        <IcoFile size={18} /> Файл
                      </button>
                    </div>
                  </>
                )}
              </span>
              <span className="rte-sep" />
            </>
          }
        />
        <input ref={photoInput} type="file" accept="image/*,video/*" multiple hidden onChange={onPicked} />
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={onPicked} />
        <input ref={fileInput} type="file" multiple hidden onChange={onPicked} />
      </div>

      {viewerAtt && (
        <ImageViewer
          att={viewerAtt}
          load={store.attachmentBlob}
          onClose={() => setViewerId(null)}
          onDownload={() => download(viewerAtt)}
          onRemove={() => {
            if (!confirm('Убрать картинку из заметки?')) return
            removeNodeById(viewerAtt.id)
            setViewerId(null)
          }}
        />
      )}
    </div>
  )
}

// ---------- Проект заметки (кто её видит) ----------

/** Кто видит заметку: без проекта — только автор; с проектом — «все» или участники проекта. */
function useAudience(): (project: Project | undefined, note?: Note) => string {
  const store = useBoard()
  return (project, note) => {
    if (!project) return note && !note.authorId ? 'видят все' : 'видите только вы'
    if (!project.memberIds?.length) return 'видят все'
    const names = project.memberIds
      .map((id) => store.members.find((m) => m.id === id)?.name)
      .filter(Boolean)
    return names.length ? `видят только: ${names.join(', ')}` : 'видят только участники проекта'
  }
}

/**
 * Выбор проекта заметки. Без проекта заметка личная — её видит только автор;
 * с проектом — те, кому виден проект (участники проекта; у проекта без
 * участников — все).
 */
function NoteProjectPicker({ note }: { note: Note }) {
  const store = useBoard()
  const audience = useAudience()
  const [open, setOpen] = useState(false)
  const projects = store.projects
  const current = note.projectId ? projects.find((p) => p.id === note.projectId) : undefined
  // Проектов нет — выбирать не из чего, но кто видит заметку, всё равно подскажем
  if (projects.length === 0 && !current) {
    return (
      <div className="note-project">
        <span className="note-project-who">{audience(undefined, note)}</span>
      </div>
    )
  }

  const pick = (projectId: ID | null) => {
    setOpen(false)
    store.updateNote(note.id, { projectId })
  }

  return (
    <div className="note-project">
      <button
        type="button"
        className={'note-project-btn' + (current ? ' set' : '')}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Проект заметки — от него зависит, кто её видит"
      >
        {current ? <ProjectAvatar project={current} size="xs" /> : <IcoNone size={16} />}
        <span className="note-project-name">{current ? current.name || 'Проект' : 'Без проекта'}</span>
        <IcoChevronDown size={14} />
      </button>
      <span className="note-project-who">{audience(current, note)}</span>
      {open && (
        <>
          <div className="note-attach-backdrop" onClick={() => setOpen(false)} />
          <div className="note-project-menu" role="menu">
            <button type="button" role="menuitemradio" aria-checked={!current} onClick={() => pick(null)}>
              <span className="note-project-opt-ico">
                <IcoNone size={18} />
              </span>
              <span className="note-project-opt-text">
                <span className="note-project-opt-name">Без проекта</span>
                <span className="note-project-opt-who">видите только вы</span>
              </span>
              {!current && <IcoCheck size={16} />}
            </button>
            {projects.map((p) => (
              <button key={p.id} type="button" role="menuitemradio" aria-checked={current?.id === p.id} onClick={() => pick(p.id)}>
                <span className="note-project-opt-ico">
                  <ProjectAvatar project={p} size="xs" />
                </span>
                <span className="note-project-opt-text">
                  <span className="note-project-opt-name">{p.name || 'Проект'}</span>
                  <span className="note-project-opt-who">{audience(p)}</span>
                </span>
                {current?.id === p.id && <IcoCheck size={16} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ---------- Просмотр картинки на весь экран ----------

function ImageViewer({
  att,
  load,
  onClose,
  onDownload,
  onRemove,
}: {
  att: Attachment
  load: (att: Attachment) => Promise<Blob>
  onClose: () => void
  onDownload: () => void
  onRemove: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    attachmentUrl(att, load)
      .then((u) => alive && setUrl(u))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [att, load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="note-viewer" role="dialog" aria-modal="true" aria-label={att.name} onClick={onClose}>
      <div className="note-viewer-bar" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="note-viewer-btn" onClick={onClose} aria-label="Закрыть">
          <IcoX size={24} />
        </button>
        <span className="note-viewer-name">{att.name}</span>
        <button type="button" className="note-viewer-btn text" onClick={onDownload}>
          Скачать
        </button>
        <button type="button" className="note-viewer-btn text danger" onClick={onRemove}>
          Убрать
        </button>
      </div>
      <div className="note-viewer-body">
        {url ? (
          <img src={url} alt={att.name} onClick={(e) => e.stopPropagation()} />
        ) : att.thumb ? (
          <img src={att.thumb} alt="" className="natt-img-blur" />
        ) : (
          <span className="spinner" />
        )}
      </div>
    </div>
  )
}
