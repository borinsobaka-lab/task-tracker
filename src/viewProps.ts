import type { ID } from './types'

/** Общие пропсы всех разделов: фильтры (участники + поиск) и открытие карточки. */
export interface ViewProps {
  memberFilter: ReadonlySet<ID>
  onMemberFilterChange: (f: ReadonlySet<ID>) => void
  search: string
  onSearchChange: (s: string) => void
  onOpenCard: (id: ID) => void
}
