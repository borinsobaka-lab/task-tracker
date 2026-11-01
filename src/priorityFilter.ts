// Фильтр по приоритету: логика (без UI), общая для App и разделов с задачами.
// Сам выпадающий список — components/PriorityFilter.tsx.

import type { Card, EisenhowerQuadrant } from './types'

/** Ключ фильтра: квадрант или 'none' — задачи без приоритета. */
export type PriorityKey = EisenhowerQuadrant | 'none'

const ALL_KEYS: PriorityKey[] = ['q1', 'q2', 'q3', 'q4', 'none']
const STORAGE_KEY = 'tt.prioFilter'

export function loadPriorityFilter(): ReadonlySet<PriorityKey> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (Array.isArray(raw)) return new Set(raw.filter((k): k is PriorityKey => ALL_KEYS.includes(k)))
  } catch {
    /* повреждённое значение — без фильтра */
  }
  return new Set()
}

export function savePriorityFilter(f: ReadonlySet<PriorityKey>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...f]))
  } catch {
    /* хранилище недоступно — фильтр просто не запомнится */
  }
}

export function matchesPriority(f: ReadonlySet<PriorityKey>, priority?: EisenhowerQuadrant): boolean {
  return f.size === 0 || f.has(priority ?? 'none')
}

/** Проходит ли карточка фильтр. Встречи и блоки — не задачи, у них нет приоритета:
 *  фильтр их не прячет (в календаре они остаются на месте). */
export function cardMatchesPriority(f: ReadonlySet<PriorityKey>, c: Card): boolean {
  return c.kind === 'meeting' || c.kind === 'block' || matchesPriority(f, c.priority)
}

/** Приоритет для новой задачи: отмечен ровно один приоритет — задача создаётся с ним,
 *  иначе она сразу пропала бы из-за фильтра. */
export function priorityForNew(f: ReadonlySet<PriorityKey>): EisenhowerQuadrant | undefined {
  const only = f.size === 1 ? [...f][0] : undefined
  return only && only !== 'none' ? only : undefined
}
