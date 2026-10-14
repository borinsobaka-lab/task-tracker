// Всплывающие уведомления браузера (Notification API) о начале задачи/встречи.
// Разрешение браузер спрашивает только по действию пользователя — по кнопке в
// плашке «Включить уведомления» или в настройках. В Android-оболочке (WebView) и
// в Safari на iPhone вне PWA API нет — там всё тихо выключено.

import type { Card } from './types'

export type NotifyPermission = NotificationPermission | 'unsupported'

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function notifyPermission(): NotifyPermission {
  return notificationsSupported() ? Notification.permission : 'unsupported'
}

/** Спросить разрешение (вызывать из обработчика клика). */
export async function requestNotifyPermission(): Promise<NotifyPermission> {
  if (!notificationsSupported()) return 'unsupported'
  if (Notification.permission !== 'default') return Notification.permission
  try {
    return await Notification.requestPermission()
  } catch {
    // Старый Safari: requestPermission только с колбэком
    return new Promise((resolve) => Notification.requestPermission((p) => resolve(p)))
  }
}

/** Открыть задачу по клику на уведомление — через тот же диплинк, что у виджета. */
export function openCardFromNotification(cardId: string): void {
  window.focus()
  location.hash = `card=${encodeURIComponent(cardId)}`
}

interface ShowOptions {
  title: string
  body: string
  /** Одинаковый tag заменяет уведомление, а не дублирует (несколько вкладок) */
  tag: string
  cardId?: string
}

async function show({ title, body, tag, cardId }: ShowOptions): Promise<void> {
  if (notifyPermission() !== 'granted') return
  const icon = `${import.meta.env.BASE_URL}icon-192.png`
  // Висит, пока не закроют, — чтобы не пропустить, если отошли от компьютера.
  const options: NotificationOptions & { requireInteraction?: boolean } = {
    body,
    tag,
    icon,
    requireInteraction: true,
    data: cardId ? { cardId } : undefined,
  }
  try {
    const n = new Notification(title, options)
    n.onclick = () => {
      n.close()
      if (cardId) openCardFromNotification(cardId)
      else window.focus()
    }
    return
  } catch {
    // Chrome на Android: new Notification запрещён — только через service worker
  }
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    await reg?.showNotification(title, options)
  } catch {
    /* не получилось — останется звуковой сигнал */
  }
}

/** Уведомление «началась задача/встреча». */
export function notifyTaskStart(card: Card): void {
  const meeting = card.kind === 'meeting'
  const time = card.start ? `${card.start}–${endTime(card.start, card.durationMin ?? 60)}` : ''
  const body = [meeting ? 'Встреча начинается' : 'Пора начинать задачу', time].filter(Boolean).join(' · ')
  void show({
    title: card.title.trim() || (meeting ? 'Встреча' : 'Задача'),
    body,
    tag: `tt-start-${card.id}`,
    cardId: card.id,
  })
}

/** Пробное уведомление сразу после включения — видно, что всё работает. */
export function notifyTest(): void {
  void show({
    title: 'Уведомления включены',
    body: 'В начале задачи или встречи здесь появится напоминание.',
    tag: 'tt-test',
  })
}

function endTime(start: string, durationMin: number): string {
  const [h, m] = start.split(':').map(Number)
  const total = (h * 60 + m + durationMin) % (24 * 60)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
