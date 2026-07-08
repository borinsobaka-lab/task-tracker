// Полноэкранный слой конфетти. Появляется при выполнении задачи (переход в
// «Готово»): чекбокс в календаре/таймлайне, кнопка/смена статуса в модалке,
// отметка в разделе «Повтор». Рисуется на canvas, ничего не блокирует (клики
// проходят сквозь), не требует внешних зависимостей.
import { useEffect, useRef } from 'react'
import { onCelebrate } from '../confetti'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  vrot: number
  w: number
  h: number
  color: string
}

// Живые, но не кислотные цвета (в тон акцентам приложения и статусам).
const COLORS = ['#5b5bd6', '#22c55e', '#f59e0b', '#ef4444', '#3b82f6', '#ec4899', '#14b8a6', '#a855f7']

export function Confetti() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false
    let particles: Particle[] = []
    let raf: number | null = null
    let dpr = 1

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.floor(window.innerWidth * dpr)
      canvas.height = Math.floor(window.innerHeight * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const loop = () => {
      const H = window.innerHeight
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      for (const p of particles) {
        p.vy += 0.22 // гравитация
        p.vx *= 0.99
        p.x += p.vx
        p.y += p.vy
        p.rot += p.vrot
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.fillStyle = p.color
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
        ctx.restore()
      }
      particles = particles.filter((p) => p.y < H + 40)
      if (particles.length > 0) {
        raf = requestAnimationFrame(loop)
      } else {
        raf = null
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        canvas.removeAttribute('data-active') // анимация закончилась
      }
    }

    const burst = () => {
      const W = window.innerWidth
      const H = window.innerHeight
      const n = reduced ? 40 : 150
      const cx = W / 2
      const cy = H * 0.4
      for (let i = 0; i < n; i++) {
        // Фонтан вверх с разбросом в стороны; дальше падает под гравитацией.
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.3
        const speed = 7 + Math.random() * 9
        particles.push({
          x: cx + (Math.random() - 0.5) * 220,
          y: cy + (Math.random() - 0.5) * 80,
          vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 4,
          vy: Math.sin(angle) * speed,
          rot: Math.random() * Math.PI,
          vrot: (Math.random() - 0.5) * 0.32,
          w: 6 + Math.random() * 7,
          h: 9 + Math.random() * 9,
          color: COLORS[i % COLORS.length],
        })
      }
      canvas.setAttribute('data-active', '1') // идёт анимация конфетти
      if (raf == null) raf = requestAnimationFrame(loop)
    }

    const off = onCelebrate(burst)
    return () => {
      off()
      window.removeEventListener('resize', resize)
      if (raf != null) cancelAnimationFrame(raf)
    }
  }, [])

  return <canvas ref={canvasRef} className="confetti-canvas" aria-hidden="true" />
}
