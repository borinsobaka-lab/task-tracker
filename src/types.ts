// Модель данных доски. Всё хранится одним JSON-файлом (board.json)
// в отдельной ветке репозитория GitHub.

export type ID = string

export interface Member {
  id: ID
  name: string
  color: string // hex, например "#7c5cff"
  /** Аватарка: сжатая картинка data-URL (квадрат ~96px). Нет — показываем инициалы. */
  avatar?: string
  /** Ник в Telegram (например "@ivan") — подставляется в уведомления бота для упоминания. */
  tgUsername?: string
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

/** Комментарий к задаче. HTML из редактора (санитизируется при выводе). */
export interface Comment {
  id: ID
  /** Автор — id участника. Может отсутствовать, если участник неизвестен. */
  authorId?: ID
  /** Имя автора на момент написания (fallback, если участника удалили). */
  authorName: string
  html: string
  createdAt: string
  updatedAt: string
  /** Проставляется, если комментарий редактировали после создания. */
  editedAt?: string
  /** Надгробие для синхронизации удалений. */
  deleted?: boolean
}

/** Тип карточки: обычная задача или встреча (со ссылкой на созвон). */
export type CardKind = 'task' | 'meeting'

// ---------- Повторяющиеся (регулярные) задачи ----------

export type RecurFreq = 'daily' | 'weekly' | 'monthly' | 'yearly'

export interface RecurrenceRule {
  freq: RecurFreq
  /** для weekly: дни недели по Date.getDay() — 0=Вс … 6=Сб */
  weekdays?: number[]
  /** для monthly: числа месяца 1..31 */
  monthdays?: number[]
  /** для yearly: месяц 1..12 */
  month?: number
  /** для yearly: число месяца 1..31 (если такого дня в месяце нет — последний день) */
  day?: number
}

/** Шаблон повторяющейся задачи или встречи. Экземпляры — обычные Card со seriesId. */
export interface Series {
  id: ID
  title: string
  description: string
  assigneeIds: ID[]
  rule: RecurrenceRule
  /** 'meeting' — повторяющаяся встреча; отсутствует/'task' — регулярная задача */
  kind?: CardKind
  /** Ссылка на созвон (только у встреч) */
  meetingUrl?: string
  /** время 'HH:MM' (необязательно). Если задано — экземпляры попадают в сетку календаря */
  start?: string
  durationMin?: number
  /** Даты-исключения (YYYY-MM-DD): удалённые по одному экземпляры не пересоздаём */
  exdates?: string[]
  deleted?: boolean
  createdAt: string
  updatedAt: string
}

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
  /** Если задан — это экземпляр повторяющейся задачи (серии) */
  seriesId?: ID
  /** HTML из редактора (санитизируется при выводе) */
  description: string
  columnId: ID
  assigneeIds: ID[]
  checklist: ChecklistItem[]
  attachments: Attachment[]
  /** Комментарии к задаче (может отсутствовать в старых данных) */
  comments?: Comment[]
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
  /** Цвет колонки (hex). Рисуется полоской сверху подложки. Нет — без полоски. */
  color?: string
  deleted?: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Проект — визуальный таб-переключатель в шапке (пока без фильтрации).
 * Имя на табе не показывается (только иконка), но хранится для будущего фильтра.
 */
export interface Project {
  id: ID
  name: string
  /** Иконка проекта: data-URL (в т.ч. SVG). Нет — показываем заглушку с буквой. */
  icon?: string
  deleted?: boolean
  createdAt: string
  updatedAt: string
}

export interface BoardData {
  schemaVersion: 1
  members: Member[]
  columns: Column[]
  cards: Record<ID, Card>
  /** Шаблоны повторяющихся задач (может отсутствовать в старых данных) */
  series?: Record<ID, Series>
  /** Проекты для табов в шапке (может отсутствовать в старых данных) */
  projects?: Project[]
  updatedAt: string
}
