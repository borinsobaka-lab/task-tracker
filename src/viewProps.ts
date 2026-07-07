import type { ID } from './types'

/** Общие пропсы всех разделов: фильтр по участникам и открытие карточки.
 *  Поиск теперь глобальный и живёт в верхнем хедере (не в разделах). */
export interface ViewProps {
  memberFilter: ReadonlySet<ID>
  onMemberFilterChange: (f: ReadonlySet<ID>) => void
  onOpenCard: (id: ID) => void
}
