import { useState } from 'react'
import { getDataRepoConfig, setDataRepoConfig, AUTH_REPO, type DataRepoConfig } from '../config'
import { GitHubAdapter, validateAccess } from '../storage/github'
import { saveEncryptedToken } from '../auth'
import { emptyBoard } from '../merge'
import { IcoBrand } from '../icons'

const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo&description=Task%20Tracker'
const MIN_PASSWORD = 8

/** Первичная настройка (делает владелец один раз): токен + пароль. */
export function OwnerSetupScreen({ onDone }: { onDone: (token: string) => void }) {
  const initial = getDataRepoConfig()
  const [token, setTokenValue] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [repo, setRepo] = useState<DataRepoConfig>(initial)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const t = token.trim()
    if (!t) return setError('Вставьте токен GitHub.')
    if (password.length < MIN_PASSWORD) return setError(`Пароль слишком короткий — минимум ${MIN_PASSWORD} символов.`)
    if (password !== password2) return setError('Пароли не совпадают.')

    setBusy(true)
    setError(null)
    try {
      // 1. Проверяем доступ токена к приватному репозиторию данных
      setStep('Проверяем доступ к репозиторию данных…')
      const access = await validateAccess({ ...repo, token: t })
      if (!access.ok) throw new Error(access.error ?? 'Репозиторий данных недоступен этому токену.')
      if (!access.canPush) throw new Error(`У токена нет прав на запись в ${repo.owner}/${repo.repo}. Проверьте, что это ваш репозиторий, а у токена есть право repo.`)

      // 2. Инициализируем доску в приватном репозитории
      setStep('Создаём доску в приватном репозитории…')
      await new GitHubAdapter({ ...repo, token: t }).init(emptyBoard())

      // 3. Шифруем токен паролем и сохраняем в публичный репозиторий
      setStep('Шифруем ключ доступа паролем…')
      await saveEncryptedToken(t, password)

      setDataRepoConfig(repo)
      onDone(t)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
      setStep('')
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo" aria-hidden>
          <IcoBrand size={30} color="currentColor" />
        </div>
        <h1>Настройка (один раз)</h1>
        <p className="muted">
          Похоже, приложение ещё не настроено. Если вы владелец — задайте пароль для входа. После этого вам и коллегам
          для входа будет нужен только он.
        </p>

        <ol className="login-steps">
          <li>
            Создайте приватный репозиторий для задач:{' '}
            <a href="https://github.com/new" target="_blank" rel="noreferrer">
              github.com/new
            </a>{' '}
            → имя <b>{initial.repo}</b>, отметьте <b>Private</b> и <b>Add a README</b>, создайте.
          </li>
          <li>
            Создайте{' '}
            <a href={TOKEN_URL} target="_blank" rel="noreferrer">
              токен GitHub
            </a>{' '}
            (галочка <b>repo</b> уже стоит) → <b>Generate token</b> → скопируйте <code>ghp_…</code>.
          </li>
          <li>Вставьте токен и придумайте пароль для входа:</li>
        </ol>

        <label className="field-label">Токен GitHub</label>
        <input
          className="input"
          type="password"
          placeholder="ghp_…"
          value={token}
          onChange={(e) => setTokenValue(e.target.value)}
          autoFocus
        />

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <div style={{ flex: 1 }}>
            <label className="field-label">Пароль для входа</label>
            <input className="input" type="password" placeholder={`минимум ${MIN_PASSWORD} символов`} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label className="field-label">Повторите пароль</label>
            <input
              className="input"
              type="password"
              placeholder="ещё раз"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit()
              }}
            />
          </div>
        </div>

        <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => setShowAdvanced((v) => !v)}>
          {showAdvanced ? 'Скрыть' : 'Репозиторий данных (по умолчанию подходит)'}
        </button>
        {showAdvanced && (
          <div className="setup-advanced">
            <input className="input" placeholder="owner" value={repo.owner} onChange={(e) => setRepo({ ...repo, owner: e.target.value.trim() })} />
            <input className="input" placeholder="repo" value={repo.repo} onChange={(e) => setRepo({ ...repo, repo: e.target.value.trim() })} />
            <input className="input" placeholder="branch" value={repo.branch} onChange={(e) => setRepo({ ...repo, branch: e.target.value.trim() })} />
          </div>
        )}

        <button className="btn btn-primary" style={{ marginTop: 16, width: '100%' }} onClick={() => void submit()} disabled={busy}>
          {busy ? step || 'Настраиваем…' : 'Сохранить и войти'}
        </button>

        {error && <div className="login-error">{error}</div>}

        <p className="muted login-note">
          Токен зашифруется вашим паролем и попадёт в служебную ветку <code>{AUTH_REPO.branch}</code>. Пароль нигде не
          сохраняется — запомните его и сообщайте коллегам лично.
        </p>
      </div>
    </div>
  )
}
