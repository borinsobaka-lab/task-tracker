// Модель данных доски. Всё хранится одним JSON-файлом (board.json)
// в отдельной ветке репозитория GitHub.

export type ID = string

export interface Member {
  id: ID
  name: string
  color: string // hex, например "#7c5cff"
  archived?: boolean
  createdAt: string // ISO
  updatedAt: string
}

export interface ChecklistItem {
  id: ID
  text: string
  done: boolean
}

export interface Attachment {
  id: ID
  name: string
  path: string // путь файла в ветке данных
  size: number
  mime: string
  uploadedAt: string
  uploadedBy?: ID
}

export interface Card {
  id: ID
  title: string
  /** HTML из редактора (санитизируется при выводе) */
  description: string
  columnId: ID
  assigneeIds: ID[]
  checklist: ChecklistItem[]
  attachments: Attachment[]
  /** Дата в формате YYYY-MM-DD (локальная). Если нет — карточка не видна в календаре */
  date?: string
  /** Время начала HH:MM. Если нет при заданной дате — задача «на весь день» (в шапке календаря) */
  start?: string
  /** Длительность в минутах (по умолчанию 60, когда задано start) */
  durationMin?: number
  done?: boolean
  /** Надгробие для синхронизации удалений */
  deleted?: boolean
  createdAt: string
  updatedAt: string
}

export interface Column {
  id: ID
  title: string
  /** Порядок карточек в колонке — источник истины для расположения */
  cardIds: ID[]
  deleted?: boolean
  createdAt: string
  updatedAt: string
}

export interface BoardData {
  schemaVersion: 1
  members: Member[]
  columns: Column[]
  cards: Record<ID, Card>
  updatedAt: string
}
