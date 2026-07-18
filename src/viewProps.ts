import type { ID } from './types'

/** Общие пропсы всех разделов: фильтр по участникам и открытие карточки.
 *  Поиск теперь глобальный и живёт в верхнем хедере (не в разделах). */
export interface ViewProps {
  memberFilter: ReadonlySet<ID>
  onMemberFilterChange: (f: ReadonlySet<ID>) => void
  /** Активный проект-фильтр (id) или null — «Все». Управляется табами в шапке. */
  projectFilter: ID | null
  onOpenCard: (id: ID) => void
  /** Создать новую задачу-черновик (пустой заголовок, курсор в поле) и открыть её.
   *  Можно сразу запланировать на дату/время (клик по календарю). */
  onCreateDraft: (schedule?: { date: string; start: string | null }) => void
}
