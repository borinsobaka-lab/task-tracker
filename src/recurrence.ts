import type { RecurrenceRule } from './types'
import { addDays, parseDateKey, toDateKey } from './utils'

// Дни недели в порядке отображения (понедельник первым). Значения — Date.getDay().
export const WEEKDAYS: { day: number; short: string; long: string }[] = [
  { day: 1, short: 'пн', long: 'понедельник' },
  { day: 2, short: 'вт', long: 'вторник' },
  { day: 3, short: 'ср', long: 'среда' },
  { day: 4, short: 'чт', long: 'четверг' },
  { day: 5, short: 'пт', long: 'пятница' },
  { day: 6, short: 'сб', long: 'суббота' },
  { day: 0, short: 'вс', long: 'воскресенье' },
]

// Месяцы: именительный (для выбора) и родительный (для описания «5 марта»).
export const MONTHS: { num: number; name: string; gen: string }[] = [
  { num: 1, name: 'Январь', gen: 'января' },
  { num: 2, name: 'Февраль', gen: 'февраля' },
  { num: 3, name: 'Март', gen: 'марта' },
  { num: 4, name: 'Апрель', gen: 'апреля' },
  { num: 5, name: 'Май', gen: 'мая' },
  { num: 6, name: 'Июнь', gen: 'июня' },
  { num: 7, name: 'Июль', gen: 'июля' },
  { num: 8, name: 'Август', gen: 'августа' },
  { num: 9, name: 'Сентябрь', gen: 'сентября' },
  { num: 10, name: 'Октябрь', gen: 'октября' },
  { num: 11, name: 'Ноябрь', gen: 'ноября' },
  { num: 12, name: 'Декабрь', gen: 'декабря' },
]

/** Сколько дней в месяце конкретного года (m — 1..12). */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

/** Максимум дней для выбора в месяце (февраль — 29, чтобы можно было указать 29 февраля). */
export function maxDayOfMonth(month: number): number {
  if (month === 2) return 29
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31
}

function dayMatches(d: Date, rule: RecurrenceRule): boolean {
  switch (rule.freq) {
    case 'daily':
      return true
    case 'weekly':
      return (rule.weekdays ?? []).includes(d.getDay())
    case 'monthly':
      return (rule.monthdays ?? []).includes(d.getDate())
    case 'yearly': {
      const m = rule.month ?? 1
      if (d.getMonth() + 1 !== m) return false
      // Если указанного числа в этом году нет (29 февраля в невисокосный год) —
      // срабатываем в последний день месяца.
      const eff = Math.min(rule.day ?? 1, daysInMonth(d.getFullYear(), m))
      return d.getDate() === eff
    }
  }
}

/** Подходит ли конкретная дата (ключ YYYY-MM-DD) под правило повторения. */
export function dateMatchesRule(dateKey: string, rule: RecurrenceRule): boolean {
  return dayMatches(parseDateKey(dateKey), rule)
}

export function ruleIsValid(rule: RecurrenceRule): boolean {
  if (rule.freq === 'weekly') return (rule.weekdays?.length ?? 0) > 0
  if (rule.freq === 'monthly') return (rule.monthdays?.length ?? 0) > 0
  if (rule.freq === 'yearly') {
    const m = rule.month ?? 0
    const dd = rule.day ?? 0
    return m >= 1 && m <= 12 && dd >= 1 && dd <= 31
  }
  return true
}

/** Первая дата, начиная с fromKey (включительно), подходящая под правило. */
export function firstOccurrence(fromKey: string, rule: RecurrenceRule): string | null {
  if (!ruleIsValid(rule)) return null
  let d = parseDateKey(fromKey)
  for (let i = 0; i < 400; i++) {
    if (dayMatches(d, rule)) return toDateKey(d)
    d = addDays(d, 1)
  }
  return null
}

/** Ближайшая дата строго после afterKey, подходящая под правило. */
export function nextOccurrence(afterKey: string, rule: RecurrenceRule): string | null {
  if (!ruleIsValid(rule)) return null
  let d = addDays(parseDateKey(afterKey), 1)
  for (let i = 0; i < 400; i++) {
    if (dayMatches(d, rule)) return toDateKey(d)
    d = addDays(d, 1)
  }
  return null
}

/** Человекочитаемое описание правила на русском. */
export function describeRule(rule: RecurrenceRule): string {
  if (rule.freq === 'daily') return 'каждый день'
  if (rule.freq === 'weekly') {
    const days = (rule.weekdays ?? [])
      .slice()
      .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
      .map((d) => WEEKDAYS.find((w) => w.day === d)?.short ?? '')
      .filter(Boolean)
    return days.length ? `по ${days.join(', ')}` : 'по неделям'
  }
  if (rule.freq === 'yearly') {
    const gen = MONTHS.find((x) => x.num === (rule.month ?? 1))?.gen ?? ''
    return `ежегодно, ${rule.day ?? 1} ${gen}`.trim()
  }
  // monthly
  const nums = (rule.monthdays ?? []).slice().sort((a, b) => a - b)
  return nums.length ? `по числам: ${nums.join(', ')}` : 'по месяцам'
}
