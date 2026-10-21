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
  /** Сохранённые фильтры этого участника (восстанавливаются при входе на любом устройстве).
   *  Пустой список / нет поля — «все». */
  filters?: { members?: ID[]; projects?: ID[] }
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
  /** Крошечное превью картинки (data-URL JPEG ~96px) — для списка заметок, без скачивания файла. */
  thumb?: string
  /** Размеры картинки в пикселях — чтобы заранее занять место под неё в тексте заметки. */
  w?: number
  h?: number
}

/** Комментарий к задаче или сделке. HTML из редактора (санитизируется при выводе). */
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
  /** Проект серии (наследуется экземплярами) */
  projectId?: ID
  /** Автор серии (наследуется экземплярами) — для доступа к личным задачам без проекта */
  createdBy?: ID
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
  /** Проект, к которому относится задача/встреча (id из BoardData.projects). Нет — «без проекта». */
  projectId?: ID
  /** Если задан — это экземпляр повторяющейся задачи (серии) */
  seriesId?: ID
  /** Кто создал задачу (id участника). Задачу без проекта видят только её исполнители
   *  и автор — это личная задача. Нет поля (старые карточки) — решают исполнители. */
  createdBy?: ID
  /** Зависимости (Гант): id задач, которые должны быть выполнены ДО этой —
   *  её «предшественники». Пока они не готовы, задача считается заблокированной.
   *  Кого блокирует сама эта задача — вычисляется перебором (обратные ссылки). */
  blockedBy?: ID[]
  /** HTML из редактора (санитизируется при выводе) */
  description: string
  columnId: ID
  assigneeIds: ID[]
  checklist: ChecklistItem[]
  attachments: Attachment[]
  /** id удалённых вложений — «надгробия» для слияния версий: без них вложение,
   *  ещё лежащее в чужой (или серверной) версии, возвращалось бы после удаления. */
  removedAttachmentIds?: ID[]
  /** Комментарии к задаче (может отсутствовать в старых данных) */
  comments?: Comment[]
  /** Дата в формате YYYY-MM-DD (локальная). Если нет — карточка не видна в календаре.
   *  Для многодневной задачи — дата НАЧАЛА диапазона. */
  date?: string
  /** Дата окончания YYYY-MM-DD (только для многодневных задач; > date). Если задана —
   *  задача «тянется» с date по endDate (без конкретного времени). */
  endDate?: string
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
 *  - 'inbox'  — входящие: сюда бот складывает задачи, добавленные через Telegram;
 *              в отчёты НЕ попадают (это «неразобранное»)
 *  - 'todo'   — нужно сделать
 *  - 'doing'  — в работе
 *  - 'review' — ожидает проверки
 *  - 'done'   — готово (карточка помечается выполненной)
 * Без роли — колонка не влияет на статус (считается «нужно сделать»).
 */
export type ColumnRole = 'inbox' | 'todo' | 'doing' | 'review' | 'done'

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
  /** ID Telegram-группы проекта — туда бот шлёт отчёты по задачам этого проекта. */
  tgGroupId?: string
  /** Участники проекта. Пусто/нет — проект видят все. Если задан — таб проекта и
   *  его задачи видят только перечисленные участники (владелец настраивает в
   *  настройках, вход в которые закрыт паролем владельца). */
  memberIds?: ID[]
  deleted?: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Заметка (раздел «Заметки»): название + текст с форматированием. Файлы и
 * картинки вставляются прямо в текст (узел <div data-note-att="id">), а их
 * метаданные лежат в attachments.
 */
export interface Note {
  id: ID
  title: string
  /** HTML из редактора */
  html: string
  attachments: Attachment[]
  /** id удалённых вложений — «надгробия» для слияния (как у карточек) */
  removedAttachmentIds?: ID[]
  /** Закреплена — показывается в самом верху списка */
  pinned?: boolean
  /** Проект заметки. Нет — заметку видят все; есть — только те, кому виден проект
   *  (у проекта без списка участников — тоже все). */
  projectId?: ID
  /** Кто создал заметку */
  authorId?: ID
  /** Надгробие для синхронизации удалений */
  deleted?: boolean
  createdAt: string
  updatedAt: string
}

// ---------- CRM (раздел «CRM»: сделки, задачи и история, партнёры) ----------
// Повторяет рабочую таблицу отдела продаж (листы «Сделки», «Задачи и история»,
// «Партнёрства», «Обзор»). Неизвестное оставляем пустым: пустая сумма — «не
// знаем», а 0 — настоящий ноль. Даты — 'YYYY-MM-DD'.

/** Этап сделки (порядок и подписи — CRM_STAGES в crm.ts) */
export type DealStage = 'new' | 'contact' | 'need' | 'solution' | 'proposal' | 'terms' | 'won' | 'lost' | 'paused'
export type LeadSource = 'inbound' | 'outbound' | 'referral' | 'partner' | 'repeat' | 'event' | 'other'
export type ContractStatus = 'none' | 'prep' | 'review' | 'signed'
export type PaymentStatus = 'none' | 'invoiced' | 'partial' | 'paid'
/** Актуальность данных: подтверждено / требует уточнения */
export type DataQuality = 'confirmed' | 'unclear'

export interface Deal {
  id: ID
  /** Постоянный ID сделки, который видят люди (например «А-1-10.26»). Не номер строки. */
  code?: string
  /** Компания / агентство */
  company: string
  /** Мероприятие клиента (в таблице — «Проект / мероприятие») */
  event?: string
  /** Проект в приложении (фильтр в шапке). Нет — сделку видят все. */
  projectId?: ID
  stage: DealStage
  /** Сумма предложения, ₽ */
  amount?: number
  /** Ответственный — участник */
  ownerId?: ID
  nextStep?: string
  /** Срок шага (для отложенной — дата возврата) */
  nextStepDate?: string
  /** Решение клиента до */
  decisionDate?: string
  /** Блокер / какое решение нужно от руководителя */
  blocker?: string
  lastContactDate?: string
  /** Подтверждённый итог последнего контакта */
  outcome?: string
  /** Контактное лицо — запись из справочника «Контакты». contactName — его имя
   *  (копия для поиска и таблиц, обновляется при переименовании контакта). */
  contactId?: ID
  contactName?: string
  /** Телефон / email из старых версий (до справочника контактов) — переносится в контакт */
  contactInfo?: string
  source?: LeadSource
  /** Потребность / модули */
  needs?: string
  eventDate?: string
  /** Участники мероприятия, чел. (текст: «до 2000») */
  attendees?: string
  /** КП: ссылка и версия */
  proposalLink?: string
  proposalDate?: string
  contractStatus?: ContractStatus
  /** Сумма заказа, ₽ */
  orderAmount?: number
  /** Дата выигрыша / проигрыша */
  closedDate?: string
  paymentStatus?: PaymentStatus
  /** Получено всего, ₽ — накопленная сумма, а не последний платёж */
  paidTotal?: number
  lastPaymentDate?: string
  /** Причина проигрыша / паузы */
  lossReason?: string
  /** Основание / ссылка */
  basis?: string
  quality?: DataQuality
  /** Компания / агентство — запись из раздела «Компании». company — её название
   *  (копия для поиска и таблиц, обновляется при переименовании компании). */
  partnerId?: ID
  /** Обсуждение сделки — как комментарии к задаче */
  comments?: Comment[]
  createdBy?: ID
  deleted?: boolean
  createdAt: string
  updatedAt: string
}

export type CrmRecordType = 'call' | 'email' | 'meeting' | 'proposal' | 'task' | 'payment' | 'stage' | 'other'
export type CrmTaskStatus = 'planned' | 'doing' | 'done' | 'cancelled'

/** Строка листа «Задачи и история»: контакт, задача или смена этапа. */
export interface CrmRecord {
  id: ID
  dealId?: ID
  partnerId?: ID
  /** Дата записи / контакта */
  date: string
  type: CrmRecordType
  /** Итог / подтверждённый факт */
  result?: string
  /** Следующее действие */
  nextAction?: string
  ownerId?: ID
  /** Срок следующего действия */
  due?: string
  status: CrmTaskStatus
  doneDate?: string
  createdBy?: ID
  deleted?: boolean
  createdAt: string
  updatedAt: string
}

export type PartnerStatus = 'contact' | 'discussion' | 'agreement' | 'active' | 'paused' | 'finished'

/** Тип компании: клиент, агентство или партнёр (у партнёра — свои договорённости и шаги). */
export type CompanyKind = 'client' | 'agency' | 'partner'

/** Компания (раздел «Компании», бывшие «Партнёры»). Исторически тип называется Partner:
 *  в данных это crm.partners. Выручку партнёрство не приносит само — коммерческие
 *  проекты заводятся сделками со ссылкой на компанию. */
export interface Partner {
  id: ID
  code?: string
  name: string
  /** Нет — старая запись раздела «Партнёры», считаем партнёром */
  kind?: CompanyKind
  /** Заметка о компании */
  note?: string
  contact?: string
  /** Формат сотрудничества */
  format?: string
  status: PartnerStatus
  /** Подтверждённые договорённости */
  agreements?: string
  nextStep?: string
  ownerId?: ID
  nextStepDate?: string
  blocker?: string
  basis?: string
  lastContactDate?: string
  quality?: DataQuality
  projectId?: ID
  deleted?: boolean
  createdAt: string
  updatedAt: string
}

/** Контакт (вкладка «Контакты»): человек со стороны клиента, агентства или партнёра. */
export interface Contact {
  id: ID
  name: string
  /** Должность / роль */
  role?: string
  phone?: string
  email?: string
  /** Компания из раздела «Компании» */
  companyId?: ID
  note?: string
  projectId?: ID
  createdBy?: ID
  deleted?: boolean
  createdAt: string
  updatedAt: string
}

export interface CrmData {
  deals: Record<ID, Deal>
  records: Record<ID, CrmRecord>
  partners: Record<ID, Partner>
  /** Контакты (может отсутствовать в данных до справочника контактов) */
  contacts?: Record<ID, Contact>
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
  /** Заметки (может отсутствовать в старых данных) */
  notes?: Record<ID, Note>
  /** CRM: сделки, задачи и история, партнёры (может отсутствовать в старых данных) */
  crm?: CrmData
  updatedAt: string
}
