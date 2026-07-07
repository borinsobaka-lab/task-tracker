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

function dayMatches(d: Date, rule: RecurrenceRule): boolean {
  switch (rule.freq) {
    case 'daily':
      return true
    case 'weekly':
      return (rule.weekdays ?? []).includes(d.getDay())
    case 'monthly':
      return (rule.monthdays ?? []).includes(d.getDate())
  }
}

/** Подходит ли конкретная дата (ключ YYYY-MM-DD) под правило повторения. */
export function dateMatchesRule(dateKey: string, rule: RecurrenceRule): boolean {
  return dayMatches(parseDateKey(dateKey), rule)
}

export function ruleIsValid(rule: RecurrenceRule): boolean {
  if (rule.freq === 'weekly') return (rule.weekdays?.length ?? 0) > 0
  if (rule.freq === 'monthly') return (rule.monthdays?.length ?? 0) > 0
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
  // monthly
  const nums = (rule.monthdays ?? []).slice().sort((a, b) => a - b)
  return nums.length ? `по числам: ${nums.join(', ')}` : 'по месяцам'
}
