import { useCallback, useEffect, useMemo, useState } from 'react'
import { BoardProvider, useMaybeBoard, useSyncMeta } from './store'
import type { StorageAdapter } from './storage/adapter'
import { GitHubAdapter } from './storage/github'
import { LocalAdapter } from './storage/local'
import { getDataRepoConfig, getSavedView, getToken, isDemoMode, setSavedView, setToken } from './config'
import { getAuthState } from './auth'
import type { EncryptedBlob } from './crypto'
import { PasswordScreen } from './components/PasswordScreen'
import { OwnerSetupScreen } from './components/OwnerSetupScreen'
import { Header } from './components/Header'
import { BoardView } from './components/BoardView'
import { CalendarView } from './components/CalendarView'
import { EisenhowerView } from './components/EisenhowerView'
import { CardModal } from './components/CardModal'
import { SettingsModal } from './components/SettingsModal'
import { IdentityScreen } from './components/IdentityScreen'
import type { ID } from './types'
import './app.css'

type Phase =
  | { kind: 'loading' }
  | { kind: 'demo' }
  | { kind: 'token'; token: string }
  | { kind: 'password'; blob: EncryptedBlob }
  | { kind: 'setup' }
  | { kind: 'error'; message: string }

export default function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })

  const bootstrap = useCallback(async () => {
    if (isDemoMode()) {
      setPhase({ kind: 'demo' })
      return
    }
    const cached = getToken()
    if (cached) {
      setPhase({ kind: 'token', token: cached })
      return
    }
    setPhase({ kind: 'loading' })
    try {
      const state = await getAuthState()
      setPhase(state.kind === 'configured' ? { kind: 'password', blob: state.blob } : { kind: 'setup' })
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }, [])

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  const onAuthenticated = (token: string) => {
    setToken(token)
    setPhase({ kind: 'token', token })
  }

  const onLogout = () => {
    setToken(null)
    void bootstrap()
  }

  switch (phase.kind) {
    case 'loading':
      return (
        <div className="fullscreen-note">
          <div className="spinner" style={{ width: 28, height: 28 }} />
          <div>Загрузка…</div>
        </div>
      )
    case 'error':
      return (
        <div className="fullscreen-note">
          <div style={{ fontSize: 40 }}>😕</div>
          <div style={{ fontWeight: 600, fontSize: 16, color: 'var(--text)' }}>Не удалось открыть приложение</div>
          <div style={{ maxWidth: 440 }}>{phase.message}</div>
          <button className="btn btn-primary" onClick={() => void bootstrap()}>
            Повторить
          </button>
        </div>
      )
    case 'demo':
      return <AppWithSession adapterKind="demo" onLogout={onLogout} />
    case 'token':
      return <AppWithSession adapterKind="github" token={phase.token} onLogout={onLogout} />
    case 'password':
      return <PasswordScreen blob={phase.blob} onUnlock={onAuthenticated} onReconfigure={() => setPhase({ kind: 'setup' })} />
    case 'setup':
      return <OwnerSetupScreen onDone={onAuthenticated} />
  }
}

function AppWithSession({
  adapterKind,
  token,
  onLogout,
}: {
  adapterKind: 'demo' | 'github'
  token?: string
  onLogout: () => void
}) {
  const adapter = useMemo<StorageAdapter>(() => {
    if (adapterKind === 'demo') return new LocalAdapter()
    return new GitHubAdapter({ ...getDataRepoConfig(), token: token! })
  }, [adapterKind, token])

  return (
    <BoardProvider adapter={adapter}>
      <Shell onLogout={onLogout} />
    </BoardProvider>
  )
}

export type ViewKind = 'board' | 'calendar' | 'matrix'

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
              Выйти
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
        {view === 'board' && <BoardView memberFilter={memberFilter} onOpenCard={setSelectedCardId} />}
        {view === 'calendar' && <CalendarView memberFilter={memberFilter} onOpenCard={setSelectedCardId} />}
        {view === 'matrix' && <EisenhowerView memberFilter={memberFilter} onOpenCard={setSelectedCardId} />}
      </main>
      {selectedCardId && <CardModal cardId={selectedCardId} onClose={() => setSelectedCardId(null)} />}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} onLogout={onLogout} />}
    </div>
  )
}
