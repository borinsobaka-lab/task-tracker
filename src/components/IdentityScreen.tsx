import { useState } from 'react'
import { useBoard } from '../store'
import { MEMBER_COLORS } from '../utils'
import { Avatar } from './Avatar'

/** Экран «Кто вы?» — выбор существующего участника или создание нового */
export function IdentityScreen() {
  const store = useBoard()
  const [name, setName] = useState('')
  const [color, setColor] = useState(MEMBER_COLORS[store.members.length % MEMBER_COLORS.length])

  const create = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    const member = store.addMember(trimmed, color)
    store.setIdentity(member.id)
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1>Кто вы?</h1>
        <p className="muted">Выберите себя из списка — или добавьте нового участника.</p>

        {store.members.length > 0 && (
          <div className="identity-list">
            {store.members.map((m) => (
              <button key={m.id} className="identity-item" onClick={() => store.setIdentity(m.id)}>
                <Avatar member={m} size="lg" />
                <span>{m.name}</span>
              </button>
            ))}
          </div>
        )}

        <div className="identity-new">
          <label className="field-label">Новый участник</label>
          <div className="login-form">
            <input
              className="input"
              placeholder="Имя, например: Анна"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') create()
              }}
            />
            <button className="btn btn-primary" onClick={create} disabled={!name.trim()}>
              Добавить
            </button>
          </div>
          <div className="color-row">
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
      </div>
    </div>
  )
}
