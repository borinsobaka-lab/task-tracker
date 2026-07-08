import type { EisenhowerQuadrant } from './types'

/** Цвета приоритетов (кружочки на карточках и зоны матрицы). */
export const QUADRANT_COLOR: Record<EisenhowerQuadrant, string> = {
  q1: '#ef4444', // красный — срочно и важно
  q2: '#eab308', // жёлтый — важно, не срочно
  q3: '#3b82f6', // синий — срочно, не важно
  q4: '#22c55e', // зелёный — не срочно, не важно
}

export interface QuadrantMeta {
  key: EisenhowerQuadrant
  title: string
  hint: string
  color: string
}

/** Порядок совпадает с раскладкой сетки 2×2: q1 сверху-слева … q4 снизу-справа. */
export const QUADRANTS: QuadrantMeta[] = [
  { key: 'q1', title: 'Срочно и важно', hint: 'Сделать в первую очередь', color: QUADRANT_COLOR.q1 },
  { key: 'q2', title: 'Важно, не срочно', hint: 'Запланировать', color: QUADRANT_COLOR.q2 },
  { key: 'q3', title: 'Срочно, не важно', hint: 'Поручить / сделать быстро', color: QUADRANT_COLOR.q3 },
  { key: 'q4', title: 'Не срочно, не важно', hint: 'Может подождать', color: QUADRANT_COLOR.q4 },
]

export const QUADRANT_LABEL: Record<EisenhowerQuadrant, string> = {
  q1: 'Срочно и важно',
  q2: 'Важно, не срочно',
  q3: 'Срочно, не важно',
  q4: 'Не срочно, не важно',
}

/** Серый цвет левой полосы у задач без приоритета (как у «инбокса» матрицы). */
export const NO_PRIORITY_COLOR = 'var(--border-strong)'

/**
 * Единый цвет левой полосы карточки по приоритету — общий для всех разделов
 * (доска, календарь, матрица). Есть приоритет → его цвет, нет → серый.
 * Это единственный источник логики покраски полосы во всей системе.
 */
export function priorityStripeColor(priority?: EisenhowerQuadrant): string {
  return priority ? QUADRANT_COLOR[priority] : NO_PRIORITY_COLOR
}
