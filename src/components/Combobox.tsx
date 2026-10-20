// Поле с подсказками: вводишь текст — ниже список подходящих записей из справочника
// (компании, контакты). Можно выбрать готовую запись или оставить свой текст —
// тогда по уходу из поля (onCommit) хозяин заводит новую запись.

import { useId, useMemo, useState } from 'react'

export interface ComboOption {
  id: string
  label: string
  /** Пояснение мелким шрифтом справа (тип, компания, телефон) */
  sub?: string
}

const MAX_SHOWN = 8
const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

export function Combobox({
  value,
  options,
  onText,
  onPick,
  onCommit,
  placeholder,
  newLabel,
}: {
  value: string
  options: ComboOption[]
  onText: (text: string) => void
  onPick: (id: string) => void
  /** Ушли из поля (или выбрали «новая …») — текст окончательный */
  onCommit?: () => void
  placeholder?: string
  /** Подпись строки «завести новую»: «Новая компания» */
  newLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listId = useId()

  const q = norm(value)
  const shown = useMemo(() => {
    const list = q ? options.filter((o) => norm(o.label).includes(q)) : options
    // Начинающиеся с введённого — выше
    return [...list].sort((a, b) => Number(norm(b.label).startsWith(q)) - Number(norm(a.label).startsWith(q))).slice(0, MAX_SHOWN)
  }, [options, q])
  const exact = !!q && options.some((o) => norm(o.label) === q)
  const offerNew = !!q && !exact && !!newLabel
  const rows = shown.length + (offerNew ? 1 : 0)

  const pick = (i: number) => {
    if (i < shown.length) onPick(shown[i].id)
    else onCommit?.()
    setOpen(false)
  }

  return (
    <div className="combo">
      <input
        className="input"
        value={value}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open && rows > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        onFocus={() => {
          setOpen(true)
          setActive(0)
        }}
        onBlur={() => {
          setOpen(false)
          onCommit?.()
        }}
        onChange={(e) => {
          onText(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onKeyDown={(e) => {
          if (!open || rows === 0) {
            if (e.key === 'ArrowDown') setOpen(true)
            return
          }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : rows - 1)) % rows)
          } else if (e.key === 'Enter') {
            e.preventDefault()
            pick(active)
          } else if (e.key === 'Escape') {
            // Закрываем только список, не всё окно
            e.nativeEvent.stopPropagation()
            setOpen(false)
          }
        }}
      />
      {open && rows > 0 && (
        <ul className="combo-list" id={listId} role="listbox">
          {shown.map((o, i) => (
            <li
              key={o.id}
              role="option"
              aria-selected={i === active}
              className={'combo-opt' + (i === active ? ' active' : '')}
              // mousedown, а не click: иначе поле теряет фокус раньше выбора
              onMouseDown={(e) => {
                e.preventDefault()
                pick(i)
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="combo-opt-label">{o.label}</span>
              {o.sub && <span className="combo-opt-sub">{o.sub}</span>}
            </li>
          ))}
          {offerNew && (
            <li
              role="option"
              aria-selected={active === shown.length}
              className={'combo-opt combo-new' + (active === shown.length ? ' active' : '')}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(shown.length)
              }}
              onMouseEnter={() => setActive(shown.length)}
            >
              + {newLabel}: «{value.trim()}»
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
