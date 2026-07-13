import type { RecurFreq } from '../types'
import { WEEKDAYS, MONTHS, maxDayOfMonth } from '../recurrence'
import './recurring.css'

const FREQ_LABEL: Record<RecurFreq, string> = {
  daily: 'Ежедневно',
  weekly: 'Еженедельно',
  monthly: 'Ежемесячно',
  yearly: 'Ежегодно',
}

/** Общие поля выбора повторения: частота + дни недели / числа месяца / дата в году. */
export function RecurrenceFields({
  freq,
  setFreq,
  weekdays,
  setWeekdays,
  monthdays,
  setMonthdays,
  month,
  setMonth,
  day,
  setDay,
}: {
  freq: RecurFreq
  setFreq: (f: RecurFreq) => void
  weekdays: number[]
  setWeekdays: (a: number[]) => void
  monthdays: number[]
  setMonthdays: (a: number[]) => void
  month: number
  setMonth: (m: number) => void
  day: number
  setDay: (d: number) => void
}) {
  const toggle = (arr: number[], v: number, set: (a: number[]) => void) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])

  const maxDay = maxDayOfMonth(month)

  return (
    <>
      <div className="rec-freq">
        {(['daily', 'weekly', 'monthly', 'yearly'] as RecurFreq[]).map((f) => (
          <button key={f} type="button" className={'chip' + (freq === f ? ' active' : '')} onClick={() => setFreq(f)}>
            {FREQ_LABEL[f]}
          </button>
        ))}
      </div>

      {freq === 'yearly' && (
        <div className="rec-yearly">
          <select
            className="input"
            value={day}
            onChange={(e) => setDay(Number(e.target.value))}
            aria-label="День"
          >
            {Array.from({ length: maxDay }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <select
            className="input"
            value={month}
            onChange={(e) => {
              const m = Number(e.target.value)
              setMonth(m)
              // Число подрезаем под новый месяц (например, было 31, стал апрель → 30)
              if (day > maxDayOfMonth(m)) setDay(maxDayOfMonth(m))
            }}
            aria-label="Месяц"
          >
            {MONTHS.map((m) => (
              <option key={m.num} value={m.num}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {freq === 'weekly' && (
        <div className="rec-weekdays">
          {WEEKDAYS.map((w) => (
            <button
              key={w.day}
              type="button"
              className={'rec-wd' + (weekdays.includes(w.day) ? ' on' : '')}
              onClick={() => toggle(weekdays, w.day, setWeekdays)}
            >
              {w.short}
            </button>
          ))}
        </div>
      )}

      {freq === 'monthly' && (
        <div className="rec-monthdays">
          {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              className={'rec-md' + (monthdays.includes(n) ? ' on' : '')}
              onClick={() => toggle(monthdays, n, setMonthdays)}
            >
              {n}
            </button>
          ))}
        </div>
      )}
    </>
  )
}
