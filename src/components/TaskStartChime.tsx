// Звуковой сигнал в момент начала запланированной задачи, пока приложение открыто
// в браузере. Раз в несколько секунд проверяем задачи текущего пользователя на
// сегодня и «дзинькаем», когда наступает время начала. Ничего не рисует.
import { useEffect, useRef } from 'react'
import { useBoard } from '../store'
import type { BoardStore } from '../store'
import { getSoundOn } from '../config'
import { parseDateKey, toDateKey } from '../utils'
import { initAudioUnlock, playTaskChime } from '../sound'

const TICK_MS = 15_000
// Не «догоняем» задачи, начавшиеся давно (например, вкладка была в фоне/спала) —
// сигналим только про начало в пределах этого окна, чтобы не сыпать звуками пачкой.
const GRACE_MS = 90_000

export function TaskStartChime() {
  const store = useBoard()
  const storeRef = useRef<BoardStore>(store)
  storeRef.current = store
  const announced = useRef<Set<string>>(new Set())

  // Разблокировка звука по первому жесту пользователя (политика автоплея браузеров).
  useEffect(() => initAudioUnlock(), [])

  useEffect(() => {
    const check = () => {
      if (!getSoundOn()) return
      const s = storeRef.current
      const me = s.identity
      const nowMs = Date.now()
      const todayKey = toDateKey(new Date())
      for (const c of s.liveCards()) {
        if (c.done || !c.start || c.date !== todayKey) continue
        // Сигналим про свои задачи и общие (без исполнителя); чужие — не трогаем.
        if (me && c.assigneeIds.length > 0 && !c.assigneeIds.includes(me.id)) continue
        if (announced.current.has(c.id)) continue
        const d = parseDateKey(c.date)
        const [hh, mm] = c.start.split(':').map(Number)
        const startMs = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm).getTime()
        if (startMs <= nowMs && startMs > nowMs - GRACE_MS) {
          announced.current.add(c.id)
          playTaskChime()
        }
      }
    }
    const t = setInterval(check, TICK_MS)
    check()
    return () => clearInterval(t)
  }, [])

  return null
}
