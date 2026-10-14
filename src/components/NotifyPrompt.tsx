// Плашка «Включить уведомления?»: браузер спрашивает разрешение на всплывающие
// уведомления только по нажатию кнопки, поэтому предлагаем это сами — пока
// разрешение ещё не дано и не запрещено. «Не сейчас» прячет плашку насовсем
// (включить можно в настройках → «Уведомления»).
import { useState } from 'react'
import { getNotifyOn, getNotifyPromptDismissed, setNotifyOn, setNotifyPromptDismissed } from '../config'
import { notifyPermission, notifyTest, requestNotifyPermission } from '../notify'

export function NotifyPrompt() {
  const [visible, setVisible] = useState(
    () => notifyPermission() === 'default' && getNotifyOn() && !getNotifyPromptDismissed(),
  )
  if (!visible) return null

  const enable = async () => {
    const p = await requestNotifyPermission()
    if (p === 'default') return // окно браузера закрыли без ответа — плашка остаётся
    setVisible(false)
    if (p === 'granted') {
      setNotifyOn(true)
      notifyTest()
    }
  }
  const dismiss = () => {
    setNotifyPromptDismissed()
    setVisible(false)
  }

  return (
    <div className="notify-prompt" role="status">
      <span className="notify-prompt-text">
        <span aria-hidden>🔔</span> Показывать уведомления в начале задач и встреч?
      </span>
      <span className="notify-prompt-actions">
        <button className="btn btn-primary btn-sm" onClick={enable}>
          Включить
        </button>
        <button className="btn btn-ghost btn-sm" onClick={dismiss}>
          Не сейчас
        </button>
      </span>
    </div>
  )
}
