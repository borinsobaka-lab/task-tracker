import type { RecurFreq } from '../types'
import { WEEKDAYS } from '../recurrence'
import './recurring.css'

/** Общие поля выбора повторения: частота + дни недели / числа месяца. */
export function RecurrenceFields({
  freq,
  setFreq,
  weekdays,
  setWeekdays,
  monthdays,
  setMonthdays,
}: {
  freq: RecurFreq
  setFreq: (f: RecurFreq) => void
  weekdays: number[]
  setWeekdays: (a: number[]) => void
  monthdays: number[]
  setMonthdays: (a: number[]) => void
}) {
  const toggle = (arr: number[], v: number, set: (a: number[]) => void) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])

  return (
    <>
      <div className="rec-freq">
        {(['daily', 'weekly', 'monthly'] as RecurFreq[]).map((f) => (
          <button key={f} type="button" className={'chip' + (freq === f ? ' active' : '')} onClick={() => setFreq(f)}>
            {f === 'daily' ? 'Каждый день' : f === 'weekly' ? 'Раз в неделю' : 'Раз в месяц'}
          </button>
        ))}
      </div>

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
