// Простой событийный канал «выпустить конфетти».
// Хранилище дёргает celebrate() при выполнении задачи (переход в «Готово»),
// а компонент <Confetti/> подписывается через onCelebrate() и рисует анимацию.
// Так вид не завязан на store, а store — на DOM.

type Listener = () => void

const listeners = new Set<Listener>()

/** Выпустить конфетти: уведомляет всех подписчиков (обычно один <Confetti/>). */
export function celebrate(): void {
  for (const fn of Array.from(listeners)) fn()
}

/** Подписаться на событие конфетти. Возвращает функцию отписки. */
export function onCelebrate(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
