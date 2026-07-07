import { useState } from 'react'
import type { EncryptedBlob } from '../crypto'
import { WrongPasswordError } from '../crypto'
import { unlockToken } from '../auth'

/** Экран входа по паролю (для всех участников). */
export function PasswordScreen({
  blob,
  onUnlock,
}: {
  blob: EncryptedBlob
  onUnlock: (token: string) => void
}) {
  const [password, setPassword] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!password) return
    setChecking(true)
    setError(null)
    try {
      const token = await unlockToken(blob, password)
      onUnlock(token)
    } catch (e) {
      setError(e instanceof WrongPasswordError ? 'Неверный пароль. Попробуйте ещё раз.' : 'Не удалось расшифровать ключ доступа.')
      setChecking(false)
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo" aria-hidden>
          ▦
        </div>
        <h1>Задачи</h1>
        <p className="muted">Введите пароль, чтобы открыть общую доску и календарь.</p>

        <div className="login-form" style={{ marginTop: 16 }}>
          <input
            className="input"
            type="password"
            placeholder="Пароль"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
            autoFocus
          />
          <button className="btn btn-primary" onClick={() => void submit()} disabled={checking || !password}>
            {checking ? 'Проверяем…' : 'Войти'}
          </button>
        </div>

        {error && <div className="login-error">{error}</div>}

        <p className="muted login-note">
          Пароль вам сообщает владелец доски. Он открывает доступ к задачам, но нигде не сохраняется в открытом виде.
        </p>
      </div>
    </div>
  )
}
