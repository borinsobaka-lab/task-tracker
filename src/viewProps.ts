import type { ID } from './types'
import type { PriorityKey } from './priorityFilter'

/** Общие пропсы всех разделов: фильтр по участникам и открытие карточки.
 *  Поиск теперь глобальный и живёт в верхнем хедере (не в разделах). */
export interface ViewProps {
  memberFilter: ReadonlySet<ID>
  onMemberFilterChange: (f: ReadonlySet<ID>) => void
  /** Фильтр по приоритету (общий для разделов с задачами); пустой набор — все. */
  priorityFilter: ReadonlySet<PriorityKey>
  onPriorityFilterChange: (f: ReadonlySet<PriorityKey>) => void
  /** Выбранные в шапке проекты; пустой набор — «Все». */
  projectFilter: ReadonlySet<ID>
  onOpenCard: (id: ID) => void
  /** Создать новую задачу-черновик (пустой заголовок, курсор в поле) и открыть её.
   *  Можно сразу запланировать на дату/время (клик по календарю). */
  onCreateDraft: (schedule?: { date: string; start: string | null }) => void
}
