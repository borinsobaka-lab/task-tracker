import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { RecurringView } from './components/RecurringView'
import { CardModal } from './components/CardModal'
import { SettingsModal } from './components/SettingsModal'
import { IdentityScreen } from './components/IdentityScreen'
import { PublicTimeline } from './components/PublicTimeline'
import { CommentsSeenProvider } from './components/Comments'
import { isLiveTimelineHash, parseTimelineHash } from './timelineShare'
import { buildTimelineItems, publishTimeline } from './publicTimelinePublisher'
import type { TLItem } from './timelineShare'
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
  // Публичный таймлайн (только просмотр) — до всякой авторизации и загрузки данных.
  const hash = location.hash
  if (isLiveTimelineHash(hash)) return <PublicTimeline live /> // живая ссылка-виджет: сама обновляется
  const snapshot = parseTimelineHash(hash) // старые одноразовые ссылки-снимки
  if (snapshot) return <PublicTimeline items={snapshot} />

  return <MainApp />
}

function MainApp() {
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
    // Скрытый вход владельца для перенастройки: ...?setup=1 (кнопки на экране больше нет)
    if (new URLSearchParams(location.search).has('setup')) {
      setPhase({ kind: 'setup' })
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
      return <PasswordScreen blob={phase.blob} onUnlock={onAuthenticated} />
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
      {adapterKind === 'github' && token && <TimelinePublisher token={token} />}
      <CommentsSeenProvider>
        <Shell onLogout={onLogout} />
      </CommentsSeenProvider>
    </BoardProvider>
  )
}

/** Публикует публичный timeline.json при изменениях (для виджета на телефоне). */
function TimelinePublisher({ token }: { token: string }) {
  const store = useMaybeBoard()
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pending = useRef<TLItem[] | null>(null)
  const lastJson = useRef<string>('')

  useEffect(() => {
    if (!store) return
    const items = buildTimelineItems(store)
    const json = JSON.stringify(items)
    if (json === lastJson.current) return
    lastJson.current = json
    pending.current = items
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const it = pending.current
      pending.current = null
      if (it) void publishTimeline(token, it)
    }, 4000)
  }, [store, token])

  // Уходим в фон (например, назад к виджету) — публикуем сразу, не ждём дебаунс
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === 'hidden' && pending.current) {
        const it = pending.current
        pending.current = null
        clearTimeout(timer.current)
        void publishTimeline(token, it)
      }
    }
    document.addEventListener('visibilitychange', flush)
    return () => document.removeEventListener('visibilitychange', flush)
  }, [token])

  return null
}

export type ViewKind = 'board' | 'calendar' | 'matrix' | 'recurring'

function Shell({ onLogout }: { onLogout: () => void }) {
  const store = useMaybeBoard()
  const { status, lastError } = useSyncMeta()
  const [view, setView] = useState<ViewKind>(getSavedView)
  const [selectedCardId, setSelectedCardId] = useState<ID | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [memberFilter, setMemberFilter] = useState<ReadonlySet<ID>>(new Set())

  // При загрузке один раз пополняем будущие экземпляры повторяющихся встреч
  const toppedUp = useRef(false)
  useEffect(() => {
    if (store && !toppedUp.current) {
      toppedUp.current = true
      store.topUpMeetings()
    }
  }, [store])

  // Диплинки из виджета Android: ...#card=<id> открывает задачу, ...#new — новая задача.
  useEffect(() => {
    const clearHash = () => history.replaceState(null, '', location.pathname + location.search)
    const openFromHash = () => {
      if (!store) return
      const cardM = location.hash.match(/^#card=(.+)$/)
      if (cardM) {
        const id = decodeURIComponent(cardM[1])
        if (store.card(id)) {
          setSelectedCardId(id)
          clearHash()
        }
        return
      }
      if (location.hash === '#new') {
        clearHash()
        const col = store.columns.find((c) => c.role === 'todo') ?? store.columns[0]
        if (col) {
          const id = store.addCard(col.id, '')
          setView('board')
          setSavedView('board')
          setSelectedCardId(id)
        }
      }
    }
    openFromHash()
    window.addEventListener('hashchange', openFromHash)
    return () => window.removeEventListener('hashchange', openFromHash)
  }, [store])

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
        onOpenCard={setSelectedCardId}
      />
      <main className="app-main">
        {(() => {
          const shared = {
            memberFilter,
            onMemberFilterChange: setMemberFilter,
            onOpenCard: setSelectedCardId,
          }
          if (view === 'board') return <BoardView {...shared} />
          if (view === 'calendar') return <CalendarView {...shared} />
          if (view === 'matrix') return <EisenhowerView {...shared} />
          return <RecurringView {...shared} />
        })()}
      </main>
      {selectedCardId && <CardModal cardId={selectedCardId} onClose={() => setSelectedCardId(null)} />}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} onLogout={onLogout} />}
    </div>
  )
}
