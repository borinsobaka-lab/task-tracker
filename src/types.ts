// Модель данных доски. Всё хранится одним JSON-файлом (board.json)
// в отдельной ветке репозитория GitHub.

export type ID = string

export interface Member {
  id: ID
  name: string
  color: string // hex, например "#7c5cff"
  /** До скольки часов спит (0–12). Слоты 00:00–это_время в календаре серые. */
  sleepUntil?: number
  archived?: boolean
  createdAt: string // ISO
  updatedAt: string
}

export interface ChecklistItem {
  id: ID
  text: string
  done: boolean
  /** Для слияния правок двух участников на уровне пункта (LWW). Может
   *  отсутствовать у пунктов, созданных ранними версиями — тогда «самый старый». */
  updatedAt?: string
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

/** Тип карточки: обычная задача или встреча (со ссылкой на созвон). */
export type CardKind = 'task' | 'meeting'

/**
 * Квадрант матрицы Эйзенхауэра (приоритет):
 *  - q1 — срочно и важно (красный)
 *  - q2 — важно, не срочно (жёлтый)
 *  - q3 — срочно, не важно (синий)
 *  - q4 — не срочно, не важно (зелёный)
 * Отсутствует — задача ещё не распределена по приоритету.
 */
export type EisenhowerQuadrant = 'q1' | 'q2' | 'q3' | 'q4'

export interface Card {
  id: ID
  title: string
  /** 'meeting' — встреча; отсутствует/'task' — обычная задача */
  kind?: CardKind
  /** Ссылка на созвон (только у встреч) */
  meetingUrl?: string
  /** Приоритет по матрице Эйзенхауэра (если распределён) */
  priority?: EisenhowerQuadrant
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

/**
 * Роль колонки для отчётов Telegram-бота и статуса задачи:
 *  - 'todo'   — нужно сделать
 *  - 'doing'  — в работе
 *  - 'review' — ожидает проверки
 *  - 'done'   — готово (карточка помечается выполненной)
 * Без роли — колонка не влияет на статус (считается «нужно сделать»).
 */
export type ColumnRole = 'todo' | 'doing' | 'review' | 'done'

export interface Column {
  id: ID
  title: string
  /** Порядок карточек в колонке — источник истины для расположения */
  cardIds: ID[]
  role?: ColumnRole
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
