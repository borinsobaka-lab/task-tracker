// Короткий приятный сигнал «пора приступать к задаче» через Web Audio API
// (без внешних звуковых файлов). Браузеры не дают проигрывать звук до первого
// действия пользователя — поэтому AudioContext «разблокируем» на первый жест.

let ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  if (!ctx) {
    try {
      ctx = new AC()
    } catch {
      return null
    }
  }
  return ctx
}

/**
 * Разблокировать звук на первый клик/нажатие клавиши (политика автоплея браузеров).
 * Возвращает функцию для снятия слушателей.
 */
export function initAudioUnlock(): () => void {
  const unlock = () => {
    const c = getCtx()
    if (c && c.state === 'suspended') void c.resume()
  }
  window.addEventListener('pointerdown', unlock, { once: true })
  window.addEventListener('keydown', unlock, { once: true })
  return () => {
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
  }
}

/** Приятный трёхнотный «дзинь» — сигнал о начале запланированной задачи.
 *  Подольше и погромче прежнего (чистая синусоида терялась на ноутбучных
 *  динамиках): три восходящие ноты треугольной волной, последняя дольше звенит. */
export function playTaskChime(): void {
  const c = getCtx()
  if (!c) return
  if (c.state === 'suspended') void c.resume()
  const t0 = c.currentTime
  // Восходящее трезвучие A5 → D6 → G6.
  const notes = [880, 1174.66, 1567.98]
  notes.forEach((freq, i) => {
    const last = i === notes.length - 1
    const t = t0 + i * 0.2
    const osc = c.createOscillator()
    const gain = c.createGain()
    // Треугольник богаче обертонами, чем синус, — заметнее на слабых динамиках,
    // но мягче квадрата, так что сигнал остаётся приятным.
    osc.type = 'triangle'
    osc.frequency.value = freq
    const tail = last ? 0.8 : 0.5 // последняя нота звенит дольше — «хвост»
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(last ? 0.34 : 0.3, t + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + tail)
    osc.connect(gain)
    gain.connect(c.destination)
    osc.start(t)
    osc.stop(t + tail + 0.05)
  })
}
