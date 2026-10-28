// Раздел «Доска»: выпадающий список досок во втором хедере (общая, доски проектов,
// без проекта, свои доски) и окно создания/настройки своей доски.

import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { useBoard } from '../store'
import type { CustomBoard, ID } from '../types'
import { imageFileToIcon, NO_PROJECT } from '../utils'
import { IcoCamera, IcoCheck, IcoChevronDown, IcoClose, IcoNone, IcoSettings, IcoX } from '../icons'
import { Avatar, ProjectAvatar } from './Avatar'
import { SheetGrabber } from './SheetGrabber'

/** Что открыто на доске (значение getBoardSel): общая / без проекта / проект / своя доска. */
export type BoardSelection =
  | { kind: 'all' }
  | { kind: 'none' }
  | { kind: 'project'; id: ID }
  | { kind: 'board'; id: ID }

export function parseBoardSel(sel: string): BoardSelection {
  if (sel === NO_PROJECT) return { kind: 'none' }
  if (sel.startsWith('p:')) return { kind: 'project', id: sel.slice(2) }
  if (sel.startsWith('b:')) return { kind: 'board', id: sel.slice(2) }
  return { kind: 'all' }
}

export function BoardPicker({ value, onChange }: { value: string; onChange: (sel: string) => void }) {
  const store = useBoard()
  const sel = parseBoardSel(value)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [editor, setEditor] = useState<{ board?: CustomBoard } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!pos) return
    const close = (e: Event) => {
      const t = e.target as Node
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return
      setPos(null)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPos(null)
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [pos])

  const toggle = () => {
    if (pos) return setPos(null)
    const r = btnRef.current!.getBoundingClientRect()
    // Второй хедер прокручивается по горизонтали — список рисуем fixed, чтобы не обрезался
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 268)), top: r.bottom + 6 })
  }
  const pick = (next: string) => {
    onChange(next)
    setPos(null)
  }

  const project = sel.kind === 'project' ? store.projects.find((p) => p.id === sel.id) : undefined
  const board = sel.kind === 'board' ? store.boards.find((b) => b.id === sel.id) : undefined
  const label = project
    ? project.name?.trim() || 'Проект'
    : board
      ? board.name
      : sel.kind === 'none'
        ? 'Без проекта'
        : 'Все задачи'

  const row = (key: string, active: boolean, icon: ReactNode, text: string) => (
    <button key={key} type="button" className={'board-pick-row' + (active ? ' active' : '')} role="menuitemradio" aria-checked={active} onClick={() => pick(key)}>
      {icon}
      <span className="board-pick-name">{text}</span>
      {active && <span className="board-pick-check"><IcoCheck size={15} /></span>}
    </button>
  )

  return (
    <>
      <button ref={btnRef} type="button" className="btn board-pick-btn" onClick={toggle} aria-haspopup="menu" aria-expanded={!!pos} title="Выбрать доску">
        {project ? (
          <ProjectAvatar project={project} size="sm" />
        ) : board ? (
          <ProjectAvatar project={board} size="sm" />
        ) : (
          <span className="board-pick-ph" aria-hidden>
            {sel.kind === 'none' ? '∅' : '★'}
          </span>
        )}
        <span className="board-pick-label">{label}</span>
        <IcoChevronDown size={14} />
      </button>
      {board && (
        <button type="button" className="icon-btn board-pick-settings" onClick={() => setEditor({ board })} title="Настроить доску" aria-label="Настроить доску">
          <IcoSettings size={18} />
        </button>
      )}
      {pos && (
        <div className="board-pick-pop" role="menu" ref={popRef} style={{ left: pos.left, top: pos.top }}>
          {row('', sel.kind === 'all', <span className="board-pick-ph" aria-hidden>★</span>, 'Все задачи')}
          {store.projects.length > 0 && <div className="board-pick-label-sep">Проекты</div>}
          {store.projects.map((p, i) =>
            row('p:' + p.id, sel.kind === 'project' && sel.id === p.id, <ProjectAvatar project={p} size="sm" />, p.name?.trim() || `Проект ${i + 1}`),
          )}
          {store.projects.length > 0 &&
            row(NO_PROJECT, sel.kind === 'none', <span className="board-pick-ph" aria-hidden>∅</span>, 'Без проекта')}
          <div className="board-pick-label-sep">Доски</div>
          {store.boards.map((b) => row('b:' + b.id, sel.kind === 'board' && sel.id === b.id, <ProjectAvatar project={b} size="sm" />, b.name))}
          <button
            type="button"
            className="board-pick-row board-pick-add"
            onClick={() => {
              setPos(null)
              setEditor({})
            }}
          >
            <span className="board-pick-ph" aria-hidden>+</span>
            <span className="board-pick-name">Создать доску</span>
          </button>
        </div>
      )}
      {editor && (
        <BoardEditor
          board={editor.board}
          onClose={() => setEditor(null)}
          onCreated={(id) => onChange('b:' + id)}
          onDeleted={() => onChange('')}
        />
      )}
    </>
  )
}

/** Создание своей доски (название, аватарка, кто имеет доступ) и её настройка. */
function BoardEditor({
  board,
  onClose,
  onCreated,
  onDeleted,
}: {
  board?: CustomBoard
  onClose: () => void
  onCreated: (id: ID) => void
  onDeleted: () => void
}) {
  const store = useBoard()
  const me = store.identity
  const [name, setName] = useState(board?.name ?? '')
  const [icon, setIcon] = useState<string | undefined>(board?.icon)
  // Новая доска — по умолчанию доступна создателю (остальных отмечают сами)
  const [memberIds, setMemberIds] = useState<ID[]>(board ? board.memberIds ?? [] : me ? [me.id] : [])
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const pickIcon = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = '' // позволяем выбрать тот же файл снова
    if (!f) return
    try {
      setIcon(await imageFileToIcon(f))
    } catch {
      alert('Не удалось загрузить картинку. Попробуйте другой файл (SVG или PNG).')
    }
  }

  const save = () => {
    const nm = name.trim()
    if (!nm) {
      setError('Укажите название доски')
      return
    }
    // Себя оставляем в доступе, иначе доска пропадёт из списка сразу после сохранения
    const access = memberIds.length && me && !memberIds.includes(me.id) ? [...memberIds, me.id] : memberIds
    if (board) {
      store.updateBoard(board.id, { name: nm, icon, memberIds: access })
    } else {
      onCreated(store.addBoard({ name: nm, icon, memberIds: access }))
    }
    onClose()
  }

  const remove = () => {
    if (!board) return
    if (confirm(`Удалить доску «${board.name}»?\n\nВместе с ней удалятся все её задачи. Это действие нельзя отменить.`)) {
      store.deleteBoard(board.id)
      onDeleted()
      onClose()
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal rec-editor board-editor" role="dialog" aria-modal="true" aria-label={board ? 'Настройки доски' : 'Новая доска'}>
        <SheetGrabber onClose={onClose} />
        <header className="rec-editor-head">
          <h3>{board ? 'Настройки доски' : 'Новая доска'}</h3>
          <button type="button" className="cm-close" onClick={onClose} title="Закрыть" aria-label="Закрыть">
            <IcoX size={22} />
          </button>
        </header>
        <p className="muted board-editor-hint">
          Доска под процесс, который не нужно заводить проектом: спринт, марафон… Колонки —
          общие для всей системы, задачи доски видны в календаре и матрице.
        </p>

        <div className="board-editor-main">
          <span className="settings-avatar-wrap">
            <button
              type="button"
              className="settings-project-iconbtn"
              onClick={() => fileRef.current?.click()}
              title="Загрузить аватарку доски"
              aria-label="Загрузить аватарку доски"
            >
              {icon ? (
                <img className="settings-project-icon" src={icon} alt="" />
              ) : (
                <span className="settings-project-ph" aria-hidden>
                  {name.trim() ? name.trim().charAt(0).toUpperCase() : 'Д'}
                </span>
              )}
              <span className="settings-avatar-cam" aria-hidden>
                <IcoCamera size={16} />
              </span>
            </button>
            {icon && (
              <button type="button" className="settings-avatar-remove" onClick={() => setIcon(undefined)} title="Убрать аватарку" aria-label="Убрать аватарку">
                <IcoClose size={13} color="currentColor" />
              </button>
            )}
            <input ref={fileRef} type="file" accept=".svg,image/svg+xml,image/*" hidden onChange={pickIcon} />
          </span>
          <div className="board-editor-name">
            <label className="field-label">Название</label>
            <input
              className="input"
              placeholder="Например: Спринт 12"
              value={name}
              autoFocus={!board}
              onChange={(e) => {
                setName(e.target.value)
                setError(null)
              }}
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
          </div>
        </div>

        <label className="field-label" style={{ marginTop: 14 }}>
          Доступ
        </label>
        <p className="muted board-editor-hint">Доску и её задачи видят только отмеченные участники. Никто не отмечен — видят все.</p>
        <div className="rec-members">
          {store.members.map((m) => {
            const on = memberIds.includes(m.id)
            return (
              <button
                key={m.id}
                type="button"
                className={'rec-member' + (on ? ' on' : '')}
                aria-pressed={on}
                onClick={() => setMemberIds(on ? memberIds.filter((x) => x !== m.id) : [...memberIds, m.id])}
              >
                <Avatar member={m} size="sm" />
                {m.name}
                {on && <span className="rec-member-check"><IcoCheck size={15} /></span>}
              </button>
            )
          })}
          {memberIds.length === 0 && (
            <span className="muted board-editor-all">
              <IcoNone size={16} /> Видят все
            </span>
          )}
        </div>

        {error && <div className="login-error" style={{ marginTop: 12 }}>{error}</div>}

        <div className="rec-editor-actions">
          {board && (
            <button className="btn btn-danger" onClick={remove}>
              Удалить
            </button>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="btn" onClick={onClose}>
              Отмена
            </button>
            <button className="btn btn-primary" onClick={save}>
              {board ? 'Сохранить' : 'Создать доску'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
