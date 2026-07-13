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

/** Мягкий двухнотный «дзинь» — сигнал о начале запланированной задачи. */
export function playTaskChime(): void {
  const c = getCtx()
  if (!c) return
  if (c.state === 'suspended') void c.resume()
  const t0 = c.currentTime
  // Две восходящие ноты (A5 → D6), короткие, с мягкой атакой и спадом.
  const notes = [880, 1174.66]
  notes.forEach((freq, i) => {
    const t = t0 + i * 0.16
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.22, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.34)
    osc.connect(gain)
    gain.connect(c.destination)
    osc.start(t)
    osc.stop(t + 0.38)
  })
}
