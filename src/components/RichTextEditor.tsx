// Редактор описания на TipTap v2: тулбар с базовым форматированием,
// onChange с debounce 700 мс и аккуратная синхронизация внешнего value
// (содержимое не перезаписывается, пока пользователь печатает).

import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { ChainedCommands, Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import Placeholder from '@tiptap/extension-placeholder'
import './modal.css'

const CHANGE_DEBOUNCE_MS = 700

/** Общий набор расширений редактора — для описания и для комментариев. */
export function richTextExtensions(placeholder?: string) {
  return [
    StarterKit.configure({ heading: { levels: [2, 3] } }),
    Underline,
    Link.configure({ openOnClick: false, autolink: true }),
    Placeholder.configure({ placeholder: placeholder ?? 'Добавьте описание…' }),
  ]
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (html: string) => void
  placeholder?: string
}) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // Последний HTML, порождённый самим редактором, — чтобы отличать
  // «своё» значение (round-trip через store) от внешних изменений.
  const localHtmlRef = useRef(value)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<string | null>(null)

  // Использует только ref'ы, поэтому её можно безопасно захватывать в замыканиях
  const flush = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (pendingRef.current !== null) {
      const html = pendingRef.current
      pendingRef.current = null
      onChangeRef.current(html)
    }
  }

  const editor = useEditor({
    extensions: richTextExtensions(placeholder),
    content: value,
    editorProps: {
      attributes: { class: 'rte-content' },
    },
    onUpdate: ({ editor: ed }) => {
      const html = ed.getHTML()
      localHtmlRef.current = html
      pendingRef.current = html
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(flush, CHANGE_DEBOUNCE_MS)
    },
    onBlur: () => flush(),
  })

  // Внешние изменения value (например, пришли по синхронизации):
  // применяем, только если редактор не в фокусе и это не наш же HTML.
  useEffect(() => {
    if (!editor || editor.isDestroyed || editor.isFocused) return
    if (value === localHtmlRef.current) return
    if (value === editor.getHTML()) {
      localHtmlRef.current = value
      return
    }
    editor.commands.setContent(value || '', false)
    localHtmlRef.current = value
  }, [value, editor])

  // При размонтировании досылаем несохранённые изменения
  useEffect(() => {
    return () => flush()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="rte">
      <EditorToolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  )
}

/** Тулбар форматирования — переиспользуется в описании и в комментариях. */
export function EditorToolbar({ editor }: { editor: Editor | null }) {
  const run = (fn: (chain: ChainedCommands) => ChainedCommands) => {
    if (editor) fn(editor.chain().focus()).run()
  }

  const active = (name: string, attrs?: Record<string, unknown>) => !!editor?.isActive(name, attrs)

  const editLink = () => {
    if (!editor) return
    const prev = (editor.getAttributes('link').href as string | undefined) ?? ''
    const input = window.prompt('Адрес ссылки:', prev || 'https://')
    if (input === null) return
    const url = input.trim()
    if (!url || url === 'https://') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    const href = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
  }

  return (
    <div className="rte-toolbar" role="toolbar" aria-label="Форматирование">
      <RteButton title="Полужирный" active={active('bold')} onClick={() => run((c) => c.toggleBold())}>
        <b>Ж</b>
      </RteButton>
      <RteButton title="Курсив" active={active('italic')} onClick={() => run((c) => c.toggleItalic())}>
        <i>К</i>
      </RteButton>
      <RteButton title="Подчёркнутый" active={active('underline')} onClick={() => run((c) => c.toggleUnderline())}>
        <u>Ч</u>
      </RteButton>
      <RteButton title="Зачёркнутый" active={active('strike')} onClick={() => run((c) => c.toggleStrike())}>
        <s>S</s>
      </RteButton>
      <span className="rte-sep" />
      <RteButton
        title="Заголовок"
        active={active('heading', { level: 2 })}
        onClick={() => run((c) => c.toggleHeading({ level: 2 }))}
      >
        H2
      </RteButton>
      <span className="rte-sep" />
      <RteButton
        title="Маркированный список"
        active={active('bulletList')}
        onClick={() => run((c) => c.toggleBulletList())}
      >
        <IconBullets />
      </RteButton>
      <RteButton
        title="Нумерованный список"
        active={active('orderedList')}
        onClick={() => run((c) => c.toggleOrderedList())}
      >
        <IconNumbers />
      </RteButton>
      <RteButton title="Цитата" active={active('blockquote')} onClick={() => run((c) => c.toggleBlockquote())}>
        <IconQuote />
      </RteButton>
      <span className="rte-sep" />
      <RteButton title="Ссылка" active={active('link')} onClick={editLink}>
        <IconLink />
      </RteButton>
      <RteButton title="Убрать форматирование" onClick={() => run((c) => c.clearNodes().unsetAllMarks())}>
        <IconClear />
      </RteButton>
    </div>
  )
}

function RteButton({
  title,
  active,
  onClick,
  children,
}: {
  title: string
  active?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className={'rte-btn' + (active ? ' active' : '')}
      title={title}
      aria-pressed={active ?? false}
      // preventDefault на mousedown — чтобы кнопка не отбирала фокус у редактора
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

// ---------- Иконки ----------

function IconBullets() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="2.6" cy="3.6" r="1.25" fill="currentColor" />
      <circle cx="2.6" cy="8" r="1.25" fill="currentColor" />
      <circle cx="2.6" cy="12.4" r="1.25" fill="currentColor" />
      <path d="M6.4 3.6h7.4M6.4 8h7.4M6.4 12.4h7.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function IconNumbers() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <text x="0.3" y="5.7" fontSize="5.8" fontWeight="700" fill="currentColor">
        1
      </text>
      <text x="0.3" y="10.4" fontSize="5.8" fontWeight="700" fill="currentColor">
        2
      </text>
      <text x="0.3" y="15.1" fontSize="5.8" fontWeight="700" fill="currentColor">
        3
      </text>
      <path d="M6.4 3.6h7.4M6.4 8h7.4M6.4 12.4h7.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function IconQuote() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3 9.4C3 6.5 4.6 4.6 7 4l.4 1.2c-1.4.5-2.2 1.4-2.4 2.6.2-.06.4-.1.7-.1 1 0 1.8.85 1.8 1.9 0 1.15-.9 2.1-2.1 2.1S3 10.7 3 9.4Zm6.6 0c0-2.9 1.6-4.8 4-5.4l.4 1.2c-1.4.5-2.2 1.4-2.4 2.6.2-.06.4-.1.7-.1 1 0 1.8.85 1.8 1.9 0 1.15-.9 2.1-2.1 2.1s-2.4-1-2.4-2.3Z"
        fill="currentColor"
      />
    </svg>
  )
}

function IconLink() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="M6.4 9.6 9.6 6.4" />
      <path d="M7.4 4.7 9 3.1a2.65 2.65 0 0 1 3.9 3.6l-.15.15-1.6 1.6" />
      <path d="M8.6 11.3 7 12.9a2.65 2.65 0 0 1-3.9-3.6l.15-.15 1.6-1.6" />
    </svg>
  )
}

function IconClear() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.3 3.1 2.8 9.6a1.2 1.2 0 0 0 0 1.7l1.9 1.9h3l5.5-5.5a1.2 1.2 0 0 0 0-1.7l-2.2-2.2a1.2 1.2 0 0 0-1.7 0Z" />
      <path d="m6.1 6.3 4.5 4.5" />
      <path d="M9.5 13.2h4" />
    </svg>
  )
}
