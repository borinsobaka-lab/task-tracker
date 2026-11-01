// Фильтр по приоритету (квадрантам матрицы Эйзенхауэра) во втором хедере — общий
// для всех разделов с задачами (доска, календарь, матрица, регулярное). Можно
// отметить несколько приоритетов и «Без приоритета»; ничего не отмечено — все задачи.

import { useEffect, useRef, useState } from 'react'
import type { PriorityKey } from '../priorityFilter'
import { NO_PRIORITY_COLOR, QUADRANTS } from '../eisenhower'
import { IcoCheck, IcoChevronDown } from '../icons'

const OPTIONS: { key: PriorityKey; title: string; color: string }[] = [
  ...QUADRANTS.map((q) => ({ key: q.key as PriorityKey, title: q.title, color: q.color })),
  { key: 'none', title: 'Без приоритета', color: NO_PRIORITY_COLOR },
]

export function PriorityFilter({
  value,
  onChange,
}: {
  value: ReadonlySet<PriorityKey>
  onChange: (f: ReadonlySet<PriorityKey>) => void
}) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
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

  const toggleOpen = () => {
    if (pos) return setPos(null)
    const r = btnRef.current!.getBoundingClientRect()
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 268)), top: r.bottom + 6 })
  }

  const toggle = (key: PriorityKey) => {
    const next = new Set(value)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onChange(next)
  }

  const selected = OPTIONS.filter((o) => value.has(o.key))
  const label = selected.length === 0 ? 'Все приоритеты' : selected.length === 1 ? selected[0].title : `Приоритеты: ${selected.length}`

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={'btn prio-filter-btn' + (value.size ? ' active' : '')}
        onClick={toggleOpen}
        aria-haspopup="menu"
        aria-expanded={!!pos}
        title="Фильтр по приоритету"
      >
        <span className="prio-filter-dots" aria-hidden>
          {(selected.length ? selected : OPTIONS.slice(0, 4)).map((o) => (
            <span key={o.key} className="prio-dot" style={{ background: o.color }} />
          ))}
        </span>
        <span className="prio-filter-label">{label}</span>
        <IcoChevronDown size={14} />
      </button>
      {pos && (
        <div className="prio-filter-pop" role="menu" ref={popRef} style={{ left: pos.left, top: pos.top }}>
          <div className="prio-filter-sep">Показывать приоритеты</div>
          {OPTIONS.map((o) => {
            const on = value.has(o.key)
            return (
              <button
                key={o.key}
                type="button"
                className={'prio-filter-row' + (on ? ' active' : '')}
                role="menuitemcheckbox"
                aria-checked={on}
                onClick={() => toggle(o.key)}
              >
                <span className="prio-dot prio-dot-lg" style={{ background: o.color }} aria-hidden />
                <span className="prio-filter-name">{o.title}</span>
                {on && <span className="prio-filter-check"><IcoCheck size={15} /></span>}
              </button>
            )
          })}
          {value.size > 0 && (
            <button type="button" className="prio-filter-row prio-filter-reset" onClick={() => onChange(new Set())}>
              <span className="prio-filter-name">Показать все</span>
            </button>
          )}
        </div>
      )}
    </>
  )
}
