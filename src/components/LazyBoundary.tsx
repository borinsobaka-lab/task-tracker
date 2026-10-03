// Граница для лениво загружаемых частей приложения (разделы, карточка задачи,
// настройки). Пока чанк грузится — fallback; если загрузить не удалось (нет
// сети и чанка нет в кэше, или вышла новая версия и старых файлов уже нет) —
// вместо белого экрана предлагаем обновить приложение.

import { Component, Suspense } from 'react'
import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

export class LazyBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="fullscreen-note lazy-failed">
          <div style={{ fontWeight: 600, fontSize: 16, color: 'var(--text)' }}>Не удалось загрузить раздел</div>
          <div>Проверьте интернет и обновите приложение.</div>
          <button className="btn btn-primary" onClick={() => location.reload()}>
            Обновить
          </button>
        </div>
      )
    }
    return <Suspense fallback={this.props.fallback ?? null}>{this.props.children}</Suspense>
  }
}

/** Заглушка раздела на долю секунды, пока грузится его чанк: спиннер появляется, только если ждать заметно. */
export function ViewFallback() {
  return (
    <div className="lazy-fallback" aria-busy="true">
      <div className="spinner" />
    </div>
  )
}
