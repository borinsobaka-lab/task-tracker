import type { ColumnRole } from './types'

/** Подписи и эмодзи ролей колонок — используются на доске и в отчётах. */
export const ROLE_META: Record<ColumnRole, { emoji: string; label: string }> = {
  inbox: { emoji: '📥', label: 'Входящие' },
  todo: { emoji: '⬜', label: 'Нужно сделать' },
  doing: { emoji: '🔧', label: 'В работе' },
  review: { emoji: '👀', label: 'Ожидает проверки' },
  done: { emoji: '✅', label: 'Готово' },
}

export const ROLE_ORDER: ColumnRole[] = ['inbox', 'todo', 'doing', 'review', 'done']
