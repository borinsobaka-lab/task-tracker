// CRM: справочники, контроль сроков и статистика. Логика повторяет рабочую
// таблицу отдела продаж (EventBase_CRM.xlsx): листы «Сделки», «Задачи и
// история», «Партнёрства», «Обзор» и «Правила». Здесь только чистые функции —
// их же считает раздел «CRM» и проверяют тесты.

import type {
  ContractStatus,
  CrmRecord,
  CrmRecordType,
  CrmTaskStatus,
  DataQuality,
  Deal,
  DealStage,
  LeadSource,
  Partner,
  PartnerStatus,
  PaymentStatus,
} from './types'
import { addDays, parseDateKey, toDateKey } from './utils'

export const CRM_COLOR = '#8b5cf6' // фиолетовый — цвет раздела

export interface StageMeta {
  key: DealStage
  label: string
  color: string
  /** Что подтверждает переход на этап (лист «Правила») */
  criterion: string
}

export const CRM_STAGES: StageMeta[] = [
  { key: 'new', label: 'Новый контакт', color: '#94a3b8', criterion: 'Зафиксирована потенциальная сделка.' },
  { key: 'contact', label: 'Контакт установлен', color: '#3b82f6', criterion: 'Получен ответ, началось обсуждение.' },
  { key: 'need', label: 'Потребность подтверждена', color: '#06b6d4', criterion: 'Понятны задача, мероприятие и ориентир по срокам.' },
  { key: 'solution', label: 'Решение обсуждено', color: '#8b5cf6', criterion: 'Решение / состав модулей обсуждены, демо проведено при необходимости.' },
  { key: 'proposal', label: 'КП отправлено', color: '#f59e0b', criterion: 'КП отправлено: сохранены дата, версия, ссылка и сумма.' },
  { key: 'terms', label: 'Согласование условий', color: '#f97316', criterion: 'Клиент обсуждает цену, состав, договор или закупку.' },
  { key: 'won', label: 'Выиграна', color: '#22c55e', criterion: 'Подтверждён заказ: заполнены сумма заказа, дата и основание.' },
  { key: 'lost', label: 'Проиграна', color: '#ef4444', criterion: 'Получен отказ: зафиксированы дата и причина.' },
  { key: 'paused', label: 'Отложена', color: '#64748b', criterion: 'Зафиксированы причина паузы и следующий шаг с датой возврата.' },
]
export const STAGE_BY_KEY = Object.fromEntries(CRM_STAGES.map((s) => [s.key, s])) as Record<DealStage, StageMeta>
/** Этапы открытой воронки (до выигрыша / проигрыша / паузы) */
export const OPEN_STAGES: DealStage[] = ['new', 'contact', 'need', 'solution', 'proposal', 'terms']
export const isClosedStage = (s: DealStage): boolean => s === 'won' || s === 'lost'

export const LEAD_SOURCES: { key: LeadSource; label: string }[] = [
  { key: 'inbound', label: 'Входящий запрос' },
  { key: 'outbound', label: 'Исходящий контакт' },
  { key: 'referral', label: 'Рекомендация' },
  { key: 'partner', label: 'Партнёр' },
  { key: 'repeat', label: 'Повторный заказ' },
  { key: 'event', label: 'Мероприятие' },
  { key: 'other', label: 'Другое' },
]
export const CONTRACT_STATUSES: { key: ContractStatus; label: string }[] = [
  { key: 'none', label: 'Не начат' },
  { key: 'prep', label: 'Подготовка' },
  { key: 'review', label: 'На согласовании' },
  { key: 'signed', label: 'Подписан' },
]
export const PAYMENT_STATUSES: { key: PaymentStatus; label: string }[] = [
  { key: 'none', label: 'Не выставлено' },
  { key: 'invoiced', label: 'Счёт выставлен' },
  { key: 'partial', label: 'Частично оплачено' },
  { key: 'paid', label: 'Оплачено' },
]
export const QUALITY: { key: DataQuality; label: string }[] = [
  { key: 'confirmed', label: 'Подтверждено' },
  { key: 'unclear', label: 'Требует уточнения' },
]
export const RECORD_TYPES: { key: CrmRecordType; label: string }[] = [
  { key: 'call', label: 'Звонок' },
  { key: 'email', label: 'Письмо' },
  { key: 'meeting', label: 'Встреча / демо' },
  { key: 'proposal', label: 'КП' },
  { key: 'task', label: 'Задача' },
  { key: 'payment', label: 'Оплата' },
  { key: 'stage', label: 'Смена этапа' },
  { key: 'other', label: 'Другое' },
]
export const TASK_STATUSES: { key: CrmTaskStatus; label: string }[] = [
  { key: 'planned', label: 'Запланировано' },
  { key: 'doing', label: 'В работе' },
  { key: 'done', label: 'Выполнено' },
  { key: 'cancelled', label: 'Отменено' },
]
export const PARTNER_STATUSES: { key: PartnerStatus; label: string }[] = [
  { key: 'contact', label: 'Контакт' },
  { key: 'discussion', label: 'Обсуждение' },
  { key: 'agreement', label: 'Согласование' },
  { key: 'active', label: 'Действует' },
  { key: 'paused', label: 'Пауза' },
  { key: 'finished', label: 'Завершено' },
]

export function labelOf<K extends string>(list: { key: K; label: string }[], key: K | undefined): string {
  return list.find((x) => x.key === key)?.label ?? ''
}

// ---------- Форматирование ----------

const MONEY = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })
/** 650000 → «650 000 ₽»; нет суммы — «—» */
export function fmtMoney(v: number | undefined): string {
  return v === undefined || v === null || Number.isNaN(v) ? '—' : `${MONEY.format(v)} ₽`
}
/** Короткая сумма для заголовков колонок: «1,2 млн ₽», «650 тыс ₽» */
export function fmtMoneyShort(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн ₽`
  if (Math.abs(v) >= 1_000) return `${Math.round(v / 1_000).toLocaleString('ru-RU')} тыс ₽`
  return `${MONEY.format(v)} ₽`
}
const SHORT_DATE = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' })
const FULL_DATE = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
/** '2026-10-23' → «23 окт» */
export function fmtShortDate(key: string | undefined): string {
  return key ? SHORT_DATE.format(parseDateKey(key)).replace('.', '') : ''
}
/** '2026-10-23' → «23.10.2026» */
export function fmtDate(key: string | undefined): string {
  return key ? FULL_DATE.format(parseDateKey(key)) : ''
}
/** Строка суммы из поля ввода: пусто — неизвестно (undefined), «0» — настоящий ноль */
export function parseMoney(s: string): number | undefined {
  const t = s.replace(/[\s ₽]/g, '').replace(',', '.')
  if (!t) return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

/** Блокер, который на деле «нет»: в таблице так и пишут — «нет», «-» */
export function hasBlocker(b: string | undefined): boolean {
  const t = (b ?? '').trim().toLowerCase()
  return t !== '' && t !== 'нет' && t !== '-' && t !== '—' && t !== 'нет блокера'
}

// ---------- Контроль (формулы серых колонок таблицы) ----------

export type Tone = 'bad' | 'warn' | 'ok' | 'muted'
export interface Control {
  label: string
  tone: Tone
}

/** «Контроль шага»: у каждой открытой или отложенной сделки — конкретный шаг и срок. */
export function stepControl(d: Deal, today: string): Control | null {
  if (isClosedStage(d.stage)) return null
  if (!d.nextStep?.trim() || !d.nextStepDate) return { label: 'Нет шага / срока', tone: 'warn' }
  if (d.nextStepDate < today) return { label: 'Просрочено', tone: 'bad' }
  if (d.nextStepDate === today) return { label: 'Сегодня', tone: 'warn' }
  return { label: 'Запланировано', tone: 'ok' }
}

/** «Контроль решения»: когда клиент обещал решить. */
export function decisionControl(d: Deal, today: string): Control | null {
  if (isClosedStage(d.stage) || d.stage === 'paused') return null
  if (!d.decisionDate) return { label: 'Нет даты решения', tone: 'muted' }
  if (d.decisionDate < today) return { label: 'Срок прошёл', tone: 'bad' }
  if (d.decisionDate <= toDateKey(addDays(parseDateKey(today), 7))) return { label: 'В ближайшие 7 дней', tone: 'warn' }
  return { label: 'Позже', tone: 'ok' }
}

/** «Контроль записи»: чего не хватает в карточке сделки. dupCodes — ID, встречающиеся больше одного раза. */
export function recordIssue(d: Deal, dupCodes: ReadonlySet<string>): string {
  const code = d.code?.trim()
  if (code && dupCodes.has(code)) return 'Повтор ID'
  if (!d.company.trim()) return 'Нет компании'
  if (d.quality !== 'confirmed') return 'Уточнить данные'
  if ((d.stage === 'lost' || d.stage === 'paused') && !d.lossReason?.trim()) return 'Указать причину'
  if (d.stage === 'won' && (d.orderAmount === undefined || !d.closedDate)) return 'Нет суммы / даты заказа'
  return ''
}

export function duplicateCodes(deals: Deal[]): Set<string> {
  const seen = new Set<string>()
  const dup = new Set<string>()
  for (const d of deals) {
    const c = d.code?.trim()
    if (!c) continue
    if (seen.has(c)) dup.add(c)
    seen.add(c)
  }
  return dup
}

/** «Контроль» задачи: выполнена, просрочена, в срок или её надо уточнить. */
export function taskControl(r: CrmRecord, today: string): Control | null {
  if (r.status === 'cancelled') return null
  if (r.status === 'done') return r.doneDate ? { label: 'Выполнено', tone: 'ok' } : { label: 'Нет даты выполнения', tone: 'warn' }
  if (!r.nextAction?.trim() || !r.due || !r.ownerId) return { label: 'Уточнить задачу', tone: 'warn' }
  if (r.due < today) return { label: 'Просрочено', tone: 'bad' }
  return { label: 'В срок', tone: 'ok' }
}

/** «Контроль» партнёра: шаг и срок, как у сделки. */
export function partnerControl(p: Partner, today: string): Control | null {
  if (p.status === 'finished') return null
  if (!p.nextStep?.trim() || !p.ownerId || !p.nextStepDate) return { label: 'Нет шага / срока', tone: 'warn' }
  if (p.nextStepDate < today) return { label: 'Просрочено', tone: 'bad' }
  return { label: 'В срок', tone: 'ok' }
}

// ---------- Обзор (лист «Обзор») ----------

export interface StageStat {
  stage: StageMeta
  count: number
  /** Сумма предложений, ₽ (пустые суммы не считаются нулём — они идут в noAmount) */
  sum: number
  noAmount: number
}

/** Ключи счётчиков «Требует внимания» — по ним раздел открывает отфильтрованный список */
export type AttentionKey =
  | 'overdueSteps'
  | 'missingSteps'
  | 'decisionOverdue'
  | 'decisionSoon'
  | 'blockers'
  | 'issues'
  | 'overdueTasks'
  | 'overduePartners'

export interface CrmOverview {
  stages: StageStat[]
  open: { count: number; sum: number; noAmount: number }
  attention: Record<AttentionKey, number>
  wonOrders: number
  paidTotal: number
  /** Активность за последние 7 дней (сегодня и шесть дней до него) */
  week: { proposals: number; won: number }
}

export const ATTENTION_LABEL: Record<AttentionKey, string> = {
  overdueSteps: 'Просроченные шаги',
  missingSteps: 'Нет шага или срока',
  decisionOverdue: 'Срок решения прошёл',
  decisionSoon: 'Решения в ближайшие 7 дней',
  blockers: 'Открытые сделки с блокером',
  issues: 'Записи требуют уточнения',
  overdueTasks: 'Просроченные задачи',
  overduePartners: 'Просроченные шаги партнёров',
}

/** Попадает ли сделка в счётчик «Требует внимания» (для перехода из обзора к списку) */
export function dealMatchesAttention(d: Deal, key: AttentionKey, today: string, dup: ReadonlySet<string>): boolean {
  switch (key) {
    case 'overdueSteps':
      return stepControl(d, today)?.label === 'Просрочено'
    case 'missingSteps':
      return stepControl(d, today)?.label === 'Нет шага / срока'
    case 'decisionOverdue':
      return decisionControl(d, today)?.label === 'Срок прошёл'
    case 'decisionSoon':
      return decisionControl(d, today)?.label === 'В ближайшие 7 дней'
    case 'blockers':
      return !isClosedStage(d.stage) && hasBlocker(d.blocker)
    case 'issues':
      return recordIssue(d, dup) !== ''
    default:
      return false
  }
}

export function crmOverview(deals: Deal[], records: CrmRecord[], partners: Partner[], today: string): CrmOverview {
  const dup = duplicateCodes(deals)
  const stages: StageStat[] = CRM_STAGES.map((stage) => {
    const list = deals.filter((d) => d.stage === stage.key)
    return {
      stage,
      count: list.length,
      sum: list.reduce((s, d) => s + (d.amount ?? 0), 0),
      noAmount: list.filter((d) => d.amount === undefined).length,
    }
  })
  const openStats = stages.filter((s) => OPEN_STAGES.includes(s.stage.key))
  const count = (key: AttentionKey) => deals.filter((d) => dealMatchesAttention(d, key, today, dup)).length
  const weekFrom = toDateKey(addDays(parseDateKey(today), -6))
  const inWeek = (k: string | undefined) => !!k && k >= weekFrom && k <= today
  return {
    stages,
    open: {
      count: openStats.reduce((s, x) => s + x.count, 0),
      sum: openStats.reduce((s, x) => s + x.sum, 0),
      noAmount: openStats.reduce((s, x) => s + x.noAmount, 0),
    },
    attention: {
      overdueSteps: count('overdueSteps'),
      missingSteps: count('missingSteps'),
      decisionOverdue: count('decisionOverdue'),
      decisionSoon: count('decisionSoon'),
      blockers: count('blockers'),
      issues: count('issues'),
      overdueTasks: records.filter((r) => taskControl(r, today)?.label === 'Просрочено').length,
      overduePartners: partners.filter((p) => partnerControl(p, today)?.label === 'Просрочено').length,
    },
    wonOrders: deals.filter((d) => d.stage === 'won').reduce((s, d) => s + (d.orderAmount ?? 0), 0),
    paidTotal: deals.reduce((s, d) => s + (d.paidTotal ?? 0), 0),
    week: {
      proposals: deals.filter((d) => inWeek(d.proposalDate)).length,
      won: deals.filter((d) => d.stage === 'won' && inWeek(d.closedDate)).length,
    },
  }
}

/** Поиск по сделке: компания, мероприятие, ID, контакт, шаг */
export function dealMatchesQuery(d: Deal, q: string): boolean {
  const t = q.trim().toLowerCase()
  if (!t) return true
  return [d.code, d.company, d.event, d.contactName, d.contactInfo, d.nextStep, d.outcome, d.needs]
    .some((x) => x?.toLowerCase().includes(t))
}

/** Сделка, которую создали «+» и так и не заполнили — при закрытии её удаляем */
export function isEmptyDeal(d: Deal): boolean {
  return (
    !d.company.trim() &&
    !d.event?.trim() &&
    !d.code?.trim() &&
    d.amount === undefined &&
    !d.nextStep?.trim() &&
    !d.contactName?.trim() &&
    !d.contactInfo?.trim()
  )
}

// ---------- Правила ведения (лист «Правила», применительно к приложению) ----------

export const CRM_RULES: { title: string; text: string }[] = [
  { title: 'ID', text: 'У каждой сделки — постоянный уникальный ID, например «А-1-10.26» или «EB-0001». Повтор ID подсвечивается в контроле записи.' },
  { title: 'Подтверждение', text: 'Указывайте дату контакта, подтверждённый итог и источник. Неизвестное оставляйте пустым и выбирайте «Требует уточнения».' },
  { title: 'Следующий шаг', text: 'У каждой открытой или отложенной сделки должен быть конкретный шаг и срок. Для паузы срок означает дату возврата.' },
  { title: 'Суммы', text: 'Все суммы в рублях на одной базе: полная сумма к оплате, включая НДС при наличии. Неизвестная сумма — пустое поле, реальный ноль — 0.' },
  { title: 'Оплаты', text: '«Получено всего» — накопленная фактическая сумма по сделке, а не размер последнего платежа. Каждый платёж записывайте в историю сделки (тип «Оплата»).' },
  { title: 'Выигранная сделка', text: 'Переводите в «Выиграна» после подписания договора. Иное письменное подтверждение допустимо, только если вы приняли его как критерий заказа; укажите основание.' },
  { title: 'История', text: 'Выполненные задачи и контакты сохраняйте. При смене этапа приложение само добавляет запись с прежним и новым этапом. Обзор показывает текущую воронку, а не историческую конверсию.' },
  { title: 'Партнёрства', text: 'Во вкладке «Партнёры» фиксируйте договорённости. Выручку учитывайте только через отдельные сделки со ссылкой на партнёра — партнёрство не увеличивает сумму воронки.' },
  { title: 'Цвета', text: 'Красный — прошедший срок. Жёлтый — сведения или действия требуют внимания. Зелёный — всё в срок.' },
  { title: 'Недельный статус', text: 'Статистика — отправная точка. Подтверждённый прогресс берите из истории; риски и неизвестное отмечайте отдельно. Приоритеты выбирайте по ближайшим решениям и блокерам.' },
]
