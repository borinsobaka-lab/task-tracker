import { useMemo, useState } from 'react'
import { BoardProvider, useMaybeBoard, useSyncMeta } from './store'
import type { StorageAdapter } from './storage/adapter'
import { GitHubAdapter } from './storage/github'
import { LocalAdapter } from './storage/local'
import { getDataRepoConfig, getSavedView, getToken, isDemoMode, setSavedView, setToken } from './config'
import { LoginScreen } from './components/LoginScreen'
import { IdentityScreen } from './components/IdentityScreen'
import { Header } from './components/Header'
import { BoardView } from './components/BoardView'
import { CalendarView } from './components/CalendarView'
import { CardModal } from './components/CardModal'
import { SettingsModal } from './components/SettingsModal'
import type { ID } from './types'
import './app.css'

type Session = { mode: 'demo' } | { mode: 'github'; token: string }

function detectSession(): Session | null {
  if (isDemoMode()) return { mode: 'demo' }
  const token = getToken()
  return token ? { mode: 'github', token } : null
}

export default function App() {
  const [session, setSession] = useState<Session | null>(detectSession)

  if (!session) {
    return (
      <LoginScreen
        onLogin={(token) => {
          setToken(token)
          setSession({ mode: 'github', token })
        }}
      />
    )
  }

  return <AppWithSession session={session} onLogout={() => logout(setSession)} />
}

function logout(setSession: (s: Session | null) => void) {
  setToken(null)
  setSession(null)
}

function AppWithSession({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const adapter = useMemo<StorageAdapter>(() => {
    if (session.mode === 'demo') return new LocalAdapter()
    return new GitHubAdapter({ ...getDataRepoConfig(), token: session.token })
  }, [session])

  return (
    <BoardProvider adapter={adapter}>
      <Shell onLogout={onLogout} />
    </BoardProvider>
  )
}

export type ViewKind = 'board' | 'calendar'

function Shell({ onLogout }: { onLogout: () => void }) {
  const store = useMaybeBoard()
  const { status, lastError } = useSyncMeta()
  const [view, setView] = useState<ViewKind>(getSavedView)
  const [selectedCardId, setSelectedCardId] = useState<ID | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [memberFilter, setMemberFilter] = useState<ReadonlySet<ID>>(new Set())

  if (!store) {
    if (status === 'error') {
      return (
        <div className="fullscreen-note">
          <div style={{ fontSize: 40 }}>😕</div>
          <div style={{ fontWeight: 600, fontSize: 16, color: 'var(--text)' }}>Не удалось загрузить данные</div>
          <div style={{ maxWidth: 420 }}>{lastError}</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-primary" onClick={() => location.reload()}>
              Повторить
            </button>
            <button className="btn" onClick={onLogout}>
              Сменить токен
            </button>
          </div>
        </div>
      )
    }
    return (
      <div className="fullscreen-note">
        <div className="spinner" style={{ width: 28, height: 28 }} />
        <div>Загружаем задачи…</div>
      </div>
    )
  }

  if (!store.identity) {
    return <IdentityScreen />
  }

  const changeView = (v: ViewKind) => {
    setView(v)
    setSavedView(v)
  }

  return (
    <div className="app-shell">
      <Header
        view={view}
        onViewChange={changeView}
        onOpenSettings={() => setSettingsOpen(true)}
        memberFilter={memberFilter}
        onMemberFilterChange={setMemberFilter}
      />
      <main className="app-main">
        {view === 'board' ? (
          <BoardView memberFilter={memberFilter} onOpenCard={setSelectedCardId} />
        ) : (
          <CalendarView memberFilter={memberFilter} onOpenCard={setSelectedCardId} />
        )}
      </main>
      {selectedCardId && <CardModal cardId={selectedCardId} onClose={() => setSelectedCardId(null)} />}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} onLogout={onLogout} />}
    </div>
  )
}
