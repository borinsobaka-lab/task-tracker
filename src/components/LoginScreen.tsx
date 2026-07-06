import { useState } from 'react'
import { getDataRepoConfig } from '../config'
import { validateAccess } from '../storage/github'

const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo&description=Task%20Tracker'

export function LoginScreen({ onLogin }: { onLogin: (token: string) => void }) {
  const [token, setTokenValue] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cfg = getDataRepoConfig()

  const submit = async () => {
    const t = token.trim()
    if (!t) return
    setChecking(true)
    setError(null)
    const res = await validateAccess({ ...cfg, token: t })
    setChecking(false)
    if (!res.ok) {
      setError(res.error ?? 'Не удалось проверить токен')
      return
    }
    if (!res.canPush) {
      setError('Токен подошёл, но у этого аккаунта нет прав на запись в репозиторий. Попросите владельца добавить вас как соавтора (Settings → Collaborators).')
      return
    }
    onLogin(t)
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo" aria-hidden>
          ▦
        </div>
        <h1>Задачи</h1>
        <p className="muted">
          Общая доска задач и календарь. Данные хранятся в вашем GitHub-репозитории{' '}
          <b>
            {cfg.owner}/{cfg.repo}
          </b>
          , поэтому для входа нужен токен GitHub.
        </p>

        <ol className="login-steps">
          <li>
            Откройте страницу{' '}
            <a href={TOKEN_URL} target="_blank" rel="noreferrer">
              создания токена GitHub
            </a>{' '}
            (вы должны быть залогинены в GitHub).
          </li>
          <li>
            Поле «Note» уже заполнено, галочка <b>repo</b> уже стоит. Внизу нажмите зелёную кнопку{' '}
            <b>Generate token</b>. Срок действия (Expiration) можно поставить «No expiration».
          </li>
          <li>Скопируйте появившийся токен (начинается с «ghp_») и вставьте его сюда:</li>
        </ol>

        <div className="login-form">
          <input
            className="input"
            type="password"
            placeholder="ghp_…"
            value={token}
            onChange={(e) => setTokenValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
            autoFocus
          />
          <button className="btn btn-primary" onClick={() => void submit()} disabled={checking || !token.trim()}>
            {checking ? 'Проверяем…' : 'Войти'}
          </button>
        </div>

        {error && <div className="login-error">{error}</div>}

        <p className="muted login-note">
          Токен сохраняется только в этом браузере и используется для чтения и записи задач напрямую в GitHub.
          Никому его не пересылайте.
        </p>
      </div>
    </div>
  )
}
