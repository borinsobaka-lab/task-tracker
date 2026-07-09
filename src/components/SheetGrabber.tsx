// Полоска-«грабер» вверху модалки на мобильном: по ней можно потянуть вниз
// (или просто нажать), чтобы закрыть окно. На десктопе скрыта (см. CSS).
import { useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

const CLOSE_DISTANCE = 90 // потянули ниже — закрываем
const TAP_SLOP = 8 // сдвиг меньше — это тап (тоже закрываем)

export function SheetGrabber({ onClose }: { onClose: () => void }) {
  const startY = useRef<number | null>(null)
  const dy = useRef(0)
  const modal = useRef<HTMLElement | null>(null)

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    startY.current = e.clientY
    dy.current = 0
    modal.current = e.currentTarget.closest('.modal')
    if (modal.current) modal.current.style.transition = 'none'
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (startY.current == null) return
    dy.current = e.clientY - startY.current
    if (modal.current) modal.current.style.transform = `translateY(${Math.max(0, dy.current)}px)`
  }

  const reset = () => {
    const m = modal.current
    if (!m) return
    m.style.transition = 'transform 0.2s ease'
    m.style.transform = ''
    window.setTimeout(() => {
      if (m) m.style.transition = ''
    }, 220)
  }

  const up = () => {
    if (startY.current == null) return
    const moved = dy.current
    startY.current = null
    if (Math.abs(moved) < TAP_SLOP || moved > CLOSE_DISTANCE) {
      onClose()
      return
    }
    reset()
  }

  const cancel = () => {
    startY.current = null
    reset()
  }

  return (
    <div
      className="sheet-grabber"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
      aria-label="Потяните вниз или нажмите, чтобы закрыть"
      role="button"
    >
      <span className="sheet-grabber-bar" />
    </div>
  )
}
