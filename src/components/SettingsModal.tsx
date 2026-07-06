import { useEffect, useState } from 'react'
import { useBoard } from '../store'
import { getDataRepoConfig, getToken, setDataRepoConfig } from '../config'
import { saveEncryptedToken } from '../auth'
import { MEMBER_COLORS } from '../utils'
import type { Member } from '../types'
import { Avatar } from './Avatar'
import './settings.css'

/** Модальное окно настроек: участники, идентификация, хранилище данных, аккаунт */
export function SettingsModal({ onClose, onLogout }: { onClose: () => void; onLogout: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal settings-modal" role="dialog" aria-modal="true" aria-label="Настройки">
        <header className="settings-header">
          <h2>Настройки</h2>
          <button className="icon-btn" onClick={onClose} title="Закрыть" aria-label="Закрыть">
            ✕
          </button>
        </header>

        <div className="settings-body">
          <MembersSection />
          <IdentitySection />
          <DataSection />
          <AccountSection onLogout={onLogout} />
        </div>
      </div>
    </div>
  )
}

// ---------- Участники ----------

function MembersSection() {
  const store = useBoard()
  return (
    <section className="settings-section">
      <h3 className="field-label settings-section-title">Участники</h3>
      {store.members.length > 0 ? (
        <div className="settings-members">
          {store.members.map((m) => (
            <MemberRow key={m.id} member={m} />
          ))}
        </div>
      ) : (
        <p className="muted settings-hint" style={{ marginBottom: 12 }}>
          Пока нет ни одного участника — добавьте первого ниже.
        </p>
      )}
      <AddMemberForm />
    </section>
  )
}

function MemberRow({ member }: { member: Member }) {
  const store = useBoard()
  const isYou = store.identity?.id === member.id
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(member.name)
  const [colorsOpen, setColorsOpen] = useState(false)

  const startEdit = () => {
    setDraft(member.name)
    setEditing(true)
  }

  const commit = () => {
    const name = draft.trim()
    if (name && name !== member.name) store.updateMember(member.id, { name })
    setEditing(false)
  }

  const archive = () => {
    const extra = isYou ? '\n\nВы архивируете себя — после этого приложение снова спросит, кто вы.' : ''
    const ok = confirm(
      `Архивировать участника «${member.name}»?\n\n` +
        `Он скроется из списков и назначений, но история — карточки, чек-листы и вложения — останется.${extra}`
    )
    if (ok) store.archiveMember(member.id)
  }

  return (
    <div>
      <div className="settings-member">
        <Avatar member={member} />
        {editing ? (
          <input
            className="input settings-name-input"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commit()
              } else if (e.key === 'Escape') {
                e.stopPropagation() // не закрывать модалку — только отменить редактирование
                setEditing(false)
              }
            }}
          />
        ) : (
          <button className="settings-member-name" onClick={startEdit} title="Нажмите, чтобы переименовать">
            <span className="settings-name-text">{member.name}</span>
            {isYou && <span className="settings-you">вы</span>}
          </button>
        )}
        <button
          className="settings-color-btn"
          style={{ background: member.color }}
          onClick={() => setColorsOpen((v) => !v)}
          title="Сменить цвет"
          aria-label={`Сменить цвет участника ${member.name}`}
        />
        <button className="btn btn-ghost btn-sm" onClick={archive}>
          Архивировать
        </button>
      </div>
      {colorsOpen && (
        <div className="color-row settings-swatch-row">
          {MEMBER_COLORS.map((c) => (
            <button
              key={c}
              className={`color-swatch${c === member.color ? ' active' : ''}`}
              style={{ background: c }}
              onClick={() => {
                store.updateMember(member.id, { color: c })
                setColorsOpen(false)
              }}
              aria-label={`Цвет ${c}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function AddMemberForm() {
  const store = useBoard()
  const [name, setName] = useState('')
  const [color, setColor] = useState(MEMBER_COLORS[store.members.length % MEMBER_COLORS.length])

  const add = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    store.addMember(trimmed, color)
    setName('')
    setColor(MEMBER_COLORS[(store.members.length + 1) % MEMBER_COLORS.length])
  }

  return (
    <div>
      <label className="field-label" htmlFor="settings-new-member">
        Новый участник
      </label>
      <div className="settings-add">
        <input
          id="settings-new-member"
          className="input"
          placeholder="Имя, например: Анна"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
          }}
        />
        <button className="btn btn-primary" onClick={add} disabled={!name.trim()}>
          Добавить
        </button>
      </div>
      <div className="color-row settings-add-colors">
        {MEMBER_COLORS.map((c) => (
          <button
            key={c}
            className={`color-swatch${c === color ? ' active' : ''}`}
            style={{ background: c }}
            onClick={() => setColor(c)}
            aria-label={`Цвет ${c}`}
          />
        ))}
      </div>
    </div>
  )
}

// ---------- Вы работаете как ----------

function IdentitySection() {
  const store = useBoard()
  return (
    <section className="settings-section">
      <h3 className="field-label settings-section-title">Вы работаете как</h3>
      <select
        className="input"
        value={store.identity?.id ?? ''}
        onChange={(e) => store.setIdentity(e.target.value || null)}
        aria-label="Вы работаете как"
      >
        {!store.identity && (
          <option value="" disabled>
            Выберите участника…
          </option>
        )}
        {store.members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      <p className="settings-hint">От этого зависит метка «вы» и авторство вложений.</p>
    </section>
  )
}

// ---------- Данные ----------

function DataSection() {
  const store = useBoard()
  const cfg = getDataRepoConfig()
  const [refreshing, setRefreshing] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [owner, setOwner] = useState(cfg.owner)
  const [repo, setRepo] = useState(cfg.repo)
  const [branch, setBranch] = useState(cfg.branch)

  const refresh = async () => {
    setRefreshing(true)
    try {
      await store.refresh()
    } finally {
      setRefreshing(false)
    }
  }

  const canSave = owner.trim() !== '' && repo.trim() !== '' && branch.trim() !== ''

  const saveAndReload = async () => {
    if (!canSave) return
    try {
      await store.flush() // досохраняем текущие изменения перед перезагрузкой
    } catch {
      /* не блокируем смену хранилища */
    }
    setDataRepoConfig({ owner: owner.trim(), repo: repo.trim(), branch: branch.trim() })
    location.reload()
  }

  const resetAndReload = async () => {
    try {
      await store.flush()
    } catch {
      /* не блокируем сброс */
    }
    setDataRepoConfig(null)
    location.reload()
  }

  return (
    <section className="settings-section">
      <h3 className="field-label settings-section-title">Данные</h3>
      <div className="settings-storage-line">
        <span>Хранилище:</span>
        <span className="settings-mono">
          {cfg.owner}/{cfg.repo}
        </span>
        <span>
          , ветка <span className="settings-mono">{cfg.branch}</span>
        </span>
      </div>
      <button className="btn btn-sm" onClick={() => void refresh()} disabled={refreshing}>
        {refreshing && <span className="spinner settings-btn-spinner" />}
        {refreshing ? 'Обновляем…' : 'Обновить с сервера'}
      </button>

      <div>
        <button
          className="settings-collapse-toggle"
          onClick={() => setAdvancedOpen((v) => !v)}
          aria-expanded={advancedOpen}
        >
          <span className={`settings-chevron${advancedOpen ? ' open' : ''}`}>▶</span>
          Сменить хранилище (для продвинутых)
        </button>
        {advancedOpen && (
          <div className="settings-advanced">
            <p className="settings-warning">
              Меняйте эти параметры только осознанно. После перезагрузки приложение будет читать и сохранять
              данные в указанном репозитории и ветке. Если репозиторий не существует или токен не имеет к нему
              доступа, доска перестанет загружаться.
            </p>
            <div className="settings-repo-grid">
              <div>
                <label className="field-label" htmlFor="settings-repo-owner">
                  Владелец (owner)
                </label>
                <input
                  id="settings-repo-owner"
                  className="input"
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                  placeholder="например, octocat"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="settings-repo-name">
                  Репозиторий (repo)
                </label>
                <input
                  id="settings-repo-name"
                  className="input"
                  value={repo}
                  onChange={(e) => setRepo(e.target.value)}
                  placeholder="например, task-tracker"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="settings-repo-branch">
                  Ветка (branch)
                </label>
                <input
                  id="settings-repo-branch"
                  className="input"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="например, tasks-data"
                />
              </div>
            </div>
            <div className="settings-actions">
              <button className="btn btn-primary btn-sm" onClick={() => void saveAndReload()} disabled={!canSave}>
                Сохранить и перезагрузить
              </button>
              <button className="btn btn-sm" onClick={() => void resetAndReload()}>
                Вернуть по умолчанию
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

// ---------- Пароль и аккаунт ----------

function AccountSection({ onLogout }: { onLogout: () => void }) {
  const token = getToken()
  const [p1, setP1] = useState('')
  const [p2, setP2] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const changePassword = async () => {
    if (!token) return
    if (p1.length < 8) return setErr('Пароль слишком короткий — минимум 8 символов.')
    if (p1 !== p2) return setErr('Пароли не совпадают.')
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      await saveEncryptedToken(token, p1)
      setMsg('Пароль обновлён. Сообщите новый пароль коллегам — старый больше не подойдёт.')
      setP1('')
      setP2('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const logout = () => {
    const ok = confirm('Выйти?\n\nНа этом устройстве потребуется снова ввести пароль. Данные останутся на месте.')
    if (ok) onLogout()
  }

  return (
    <section className="settings-section">
      <h3 className="field-label settings-section-title">Пароль и вход</h3>
      {token ? (
        <>
          <p className="settings-hint" style={{ marginTop: 0 }}>
            Сменить пароль для входа (например, если ушёл кто-то из команды):
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input className="input" style={{ flex: 1, minWidth: 140 }} type="password" placeholder="новый пароль" value={p1} onChange={(e) => setP1(e.target.value)} />
            <input className="input" style={{ flex: 1, minWidth: 140 }} type="password" placeholder="повторите" value={p2} onChange={(e) => setP2(e.target.value)} />
            <button className="btn" onClick={() => void changePassword()} disabled={busy || !p1 || !p2}>
              {busy && <span className="spinner settings-btn-spinner" />}
              {busy ? 'Сохраняем…' : 'Сменить пароль'}
            </button>
          </div>
          {msg && <p className="settings-hint" style={{ color: 'var(--ok)' }}>{msg}</p>}
          {err && <p className="settings-hint" style={{ color: 'var(--danger)' }}>{err}</p>}
        </>
      ) : (
        <p className="settings-hint" style={{ marginTop: 0 }}>Смена пароля недоступна в этом режиме.</p>
      )}
      <button className="btn btn-danger" style={{ marginTop: 12 }} onClick={logout}>
        Выйти с этого устройства
      </button>
    </section>
  )
}
