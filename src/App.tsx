import { lazy, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BoardProvider, useMaybeBoard, useSyncMeta } from './store'
import type { StorageAdapter } from './storage/adapter'
import { GitHubAdapter } from './storage/github'
import { LocalAdapter } from './storage/local'
import { getDataRepoConfig, getSavedView, getToken, isDemoMode, OWNER_PASSWORD, setSavedView, setToken } from './config'
import { getAuthState } from './auth'
import type { EncryptedBlob } from './crypto'
import { Header, BottomNav } from './components/Header'
import { Confetti } from './components/Confetti'
import { TaskStartChime } from './components/TaskStartChime'
import { QuickAddSheet } from './components/QuickAddSheet'
import { IdentityScreen } from './components/IdentityScreen'
import { CommentsSeenProvider } from './components/commentsSeen'
import { LazyBoundary as Lazy, ViewFallback } from './components/LazyBoundary'
import { BootScreen } from './components/BootScreen'
import { clearBoardCache } from './boardCache'
import { isLiveTimelineHash, parseTimelineHash } from './timelineShare'
import { reportIdentityToNative } from './nativeBridge'
import { buildTimelineItems, publishTimeline } from './publicTimelinePublisher'
import type { TLItem } from './timelineShare'
import type { Card, ID } from './types'
import { hasContent } from './utils'
// Стили разделов, которые грузятся лениво (ниже), остаются в общем CSS и в
// прежнем порядке — каскад не меняется и нет «вспышки» без стилей.
import './components/subheader.css'
import './components/modal.css'
import './components/board.css'
import './components/gantt.css'
import './components/calendar.css'
import './components/eisenhower.css'
import './components/recurring.css'
import './components/notes.css'
import './components/settings.css'
import './app.css'

// ---------- Ленивые части ----------
// Разделы, карточка задачи (редактор TipTap), настройки и экраны входа — в
// отдельных чанках: стартовый бандл меньше, PWA открывается быстрее. Раздел,
// который откроется первым, начинаем грузить сразу, остальное — в простое после
// старта (prefetchChunks), чтобы переходы и открытие задачи были мгновенными.
const chunks = {
  board: () => import('./components/BoardView'),
  calendar: () => import('./components/CalendarView'),
  matrix: () => import('./components/EisenhowerView'),
  recurring: () => import('./components/RecurringView'),
  notes: () => import('./components/NotesView'),
  card: () => import('./components/CardModal'),
  settings: () => import('./components/SettingsModal'),
}
const BoardView = lazy(() => chunks.board().then((m) => ({ default: m.BoardView })))
const CalendarView = lazy(() => chunks.calendar().then((m) => ({ default: m.CalendarView })))
const EisenhowerView = lazy(() => chunks.matrix().then((m) => ({ default: m.EisenhowerView })))
const RecurringView = lazy(() => chunks.recurring().then((m) => ({ default: m.RecurringView })))
const NotesView = lazy(() => chunks.notes().then((m) => ({ default: m.NotesView })))
const CardModal = lazy(() => chunks.card().then((m) => ({ default: m.CardModal })))
const SettingsModal = lazy(() => chunks.settings().then((m) => ({ default: m.SettingsModal })))
const PasswordScreen = lazy(() => import('./components/PasswordScreen').then((m) => ({ default: m.PasswordScreen })))
const OwnerSetupScreen = lazy(() => import('./components/OwnerSetupScreen').then((m) => ({ default: m.OwnerSetupScreen })))
const PublicTimeline = lazy(() => import('./components/PublicTimeline').then((m) => ({ default: m.PublicTimeline })))

// Первый раздел — сразу, параллельно с запуском React и чтением кэша данных
if (!isLiveTimelineHash(location.hash) && !parseTimelineHash(location.hash)) void chunks[getSavedView()]().catch(() => {})

let prefetched = false
/** Подгрузить все чанки в простое (после первого показа) */
function prefetchChunks(): void {
  if (prefetched) return
  prefetched = true
  const run = () => {
    for (const load of Object.values(chunks)) void load().catch(() => {})
  }
  const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
  if (ric) ric(run, { timeout: 2500 })
  else setTimeout(run, 1200)
}

/** Пустой черновик задачи (создан кнопкой «+», но ничего не заполнено) — такой при закрытии удаляем. */
function isEmptyDraft(card: Card): boolean {
  const title = card.title.trim()
  const titleEmpty = title === '' || title === 'Без названия'
  const liveComments = card.comments ? card.comments.filter((c) => !c.deleted).length : 0
  return (
    titleEmpty &&
    !hasContent(card.description) &&
    card.checklist.length === 0 &&
    card.attachments.length === 0 &&
    liveComments === 0 &&
    card.assigneeIds.length === 0 &&
    // Дату не проверяем: черновик, созданный кликом по календарю, получает дату
    // автоматически — без названия и прочего содержимого он всё равно «пустой».
    !card.priority &&
    // Пустой черновик встречи тоже удаляем (тип задача/встреча не важен). Но если
    // встречу успели сделать повторяющейся (появился seriesId) — это уже не черновик.
    !card.seriesId &&
    !card.meetingUrl
  )
}

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
  if (isLiveTimelineHash(hash)) return <Lazy><PublicTimeline live /></Lazy> // живая ссылка-виджет: сама обновляется
  const snapshot = parseTimelineHash(hash) // старые одноразовые ссылки-снимки
  if (snapshot) return <Lazy><PublicTimeline items={snapshot} /></Lazy>

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
    void clearBoardCache() // копия доски на устройстве — только для вошедшего
    void bootstrap()
  }

  switch (phase.kind) {
    case 'loading':
      return <BootScreen text="Загрузка…" />
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
      return <Lazy fallback={<BootScreen text="Загрузка…" />}><PasswordScreen blob={phase.blob} onUnlock={onAuthenticated} /></Lazy>
    case 'setup':
      return <Lazy fallback={<BootScreen text="Загрузка…" />}><OwnerSetupScreen onDone={onAuthenticated} /></Lazy>
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
    // Пока показана копия с устройства (сервер ещё не ответил) — не публикуем,
    // иначе виджет мог бы на миг получить устаревший таймлайн.
    if (!store?.fresh) return
    // Публичный таймлайн — общий файл для всех: собираем из ПОЛНОГО списка задач,
    // без фильтра доступа по проектам (иначе устройство участника с ограниченным
    // доступом перезаписало бы общий таймлайн урезанной версией).
    const items = buildTimelineItems({ liveCards: store.allLiveCards, members: store.members })
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

export type ViewKind = 'board' | 'calendar' | 'matrix' | 'recurring' | 'notes'

function Shell({ onLogout }: { onLogout: () => void }) {
  const store = useMaybeBoard()
  const { status, lastError } = useSyncMeta()
  const [view, setView] = useState<ViewKind>(getSavedView)
  const [selectedCardId, setSelectedCardId] = useState<ID | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Настройки — только для владельца: при каждом открытии спрашиваем пароль.
  // Это UI-барьер от случайных правок сотрудниками (не криптозащита данных).
  const openSettings = () => {
    const p = prompt('Настройки доступны только владельцу.\nВведите пароль владельца:')
    if (p === null) return // отмена
    if (p === OWNER_PASSWORD) setSettingsOpen(true)
    else alert('Неверный пароль.')
  }
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  // «+» в нижнем меню в разделе «Заметки» создаёт заметку (функцию кладёт NotesView)
  const composeNoteRef = useRef<(() => void) | null>(null)
  // Фильтры по участникам и проектам (пустой набор — «все»). Запоминаются за
  // выбранным участником в board.json и восстанавливаются при следующем входе.
  const [memberFilter, setMemberFilterState] = useState<ReadonlySet<ID>>(new Set())
  const [projectFilter, setProjectFilterState] = useState<ReadonlySet<ID>>(new Set())
  // Карточка, созданная кнопкой «+» и ещё не заполненная (черновик). Ref на
  // свежий store — чтобы после закрытия увидеть досохранённые название/описание.
  const draftIdRef = useRef<ID | null>(null)
  const storeRef = useRef(store)
  storeRef.current = store

  // При загрузке один раз пополняем будущие экземпляры повторяющихся встреч.
  // Только по свежим данным с сервера: по устаревшей копии с устройства можно
  // создать «пустой» экземпляр поверх уже заполненного на сервере.
  const toppedUp = useRef(false)
  useEffect(() => {
    if (store?.fresh && !toppedUp.current) {
      toppedUp.current = true
      store.topUpMeetings()
    }
  }, [store])

  // Вход (или смена участника): восстанавливаем его сохранённые фильтры. Участников,
  // которых уже нет (в архиве), отбрасываем; проекты проверяет ProjectTabs.
  const filtersLoadedFor = useRef<ID | null>(null)
  useEffect(() => {
    const me = store?.identity
    if (!store || !me || filtersLoadedFor.current === me.id) return
    filtersLoadedFor.current = me.id
    const alive = new Set(store.members.map((m) => m.id))
    setMemberFilterState(new Set((me.filters?.members ?? []).filter((id) => alive.has(id))))
    setProjectFilterState(new Set(me.filters?.projects ?? []))
  }, [store])

  // Кто выбран в «Кто вы?» — сообщаем Android-оболочке: виджет на рабочем столе
  // показывает задачи только этого участника. В браузере вызов ничего не делает.
  // Пока доска грузится (store == null) молчим, иначе виджет на секунду сбросил
  // бы фильтр и показал чужие задачи.
  const boardReady = !!store
  const identityId = store?.identity?.id ?? null
  const identityName = store?.identity?.name ?? null
  useEffect(() => {
    if (!boardReady) return
    reportIdentityToNative(identityId, identityName)
  }, [boardReady, identityId, identityName])

  // Доска показана — в простое подгружаем остальные разделы и карточку задачи
  useEffect(() => {
    if (boardReady) prefetchChunks()
  }, [boardReady])

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
          draftIdRef.current = id // черновик: удалим при закрытии, если останется пустым
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
    return <BootScreen text="Загружаем задачи…" />
  }

  if (!store.identity) {
    return <IdentityScreen />
  }

  // Сохраняем фильтры за текущим участником (если что-то изменилось)
  const saveFilters = (members: ReadonlySet<ID>, projects: ReadonlySet<ID>) => {
    const me = store.identity
    if (!me) return
    const next = { members: [...members].sort(), projects: [...projects].sort() }
    const prev = { members: [...(me.filters?.members ?? [])].sort(), projects: [...(me.filters?.projects ?? [])].sort() }
    if (JSON.stringify(next) === JSON.stringify(prev)) return
    store.updateMember(me.id, { filters: next })
  }
  const setMemberFilter = (f: ReadonlySet<ID>) => {
    setMemberFilterState(f)
    saveFilters(f, projectFilter)
  }
  const setProjectFilter = (f: ReadonlySet<ID>) => {
    setProjectFilterState(f)
    saveFilters(memberFilter, f)
  }

  // В переходе: пока чанк нового раздела грузится, остаётся видным текущий (без мигания)
  const changeView = (v: ViewKind) => {
    startTransition(() => setView(v))
    setSavedView(v)
  }

  // Создание задачи-черновика: пустой заголовок (курсор сразу в поле), в колонке
  // «Нужно сделать». Черновик удаляем при закрытии, если так и остался пустым.
  // schedule — сразу поставить дату/время (клик по календарю).
  const createDraft = (schedule?: { date: string; start: string | null }) => {
    const col = store.columns.find((c) => c.role === 'todo') ?? store.columns[0]
    if (!col) return
    const id = store.addCard(col.id, '')
    if (schedule) {
      if (schedule.start) store.scheduleCard(id, schedule.date, schedule.start, 60)
      else store.scheduleCard(id, schedule.date, null)
    }
    draftIdRef.current = id
    setSelectedCardId(id)
  }
  // Плавающая кнопка на десктопе / «+» в нижнем меню на телефоне.
  const createTask = () => createDraft()

  // Закрытие карточки. Если это был пустой черновик от кнопки «+» — не оставляем его.
  const closeCard = () => {
    const id = selectedCardId
    setSelectedCardId(null)
    if (id && id === draftIdRef.current) {
      draftIdRef.current = null
      // Небольшая задержка — чтобы модалка успела досохранить название/описание при закрытии.
      setTimeout(() => {
        const s = storeRef.current
        const card = s?.card(id)
        if (s && card && isEmptyDraft(card)) s.deleteCard(id)
      }, 60)
    }
  }

  return (
    <div className="app-shell">
      <Header
        view={view}
        onViewChange={changeView}
        onOpenSettings={openSettings}
        onOpenCard={setSelectedCardId}
        projectFilter={projectFilter}
        onProjectFilterChange={setProjectFilter}
      />
      <main className="app-main">
        <Lazy fallback={<ViewFallback />}>
        {(() => {
          const shared = {
            memberFilter,
            onMemberFilterChange: setMemberFilter,
            projectFilter,
            onOpenCard: setSelectedCardId,
            onCreateDraft: createDraft,
          }
          if (view === 'board') return <BoardView {...shared} />
          if (view === 'calendar') return <CalendarView {...shared} />
          if (view === 'matrix') return <EisenhowerView {...shared} />
          if (view === 'notes') return <NotesView composeRef={composeNoteRef} projectFilter={projectFilter} />
          return <RecurringView {...shared} />
        })()}
        </Lazy>
      </main>
      <BottomNav
        view={view}
        onViewChange={changeView}
        onNewTask={() => (view === 'notes' && composeNoteRef.current ? composeNoteRef.current() : setQuickAddOpen(true))}
      />
      {/* Десктоп: плавающая кнопка быстрого создания — в «Заметках» жёлтая «Добавить заметку»,
          в остальных разделах «Добавить задачу» */}
      {view === 'notes' ? (
        <button
          className="fab fab-note"
          onClick={() => composeNoteRef.current?.()}
          title="Добавить заметку"
          aria-label="Добавить заметку"
        >
          <span className="fab-plus" aria-hidden>+</span>
          <span className="fab-text">Добавить заметку</span>
        </button>
      ) : (
        <button className="fab" onClick={createTask} title="Добавить задачу" aria-label="Добавить задачу">
          <span className="fab-plus" aria-hidden>+</span>
          <span className="fab-text">Добавить задачу</span>
        </button>
      )}
      <Lazy>
        {selectedCardId && <CardModal cardId={selectedCardId} onClose={closeCard} onOpenCard={setSelectedCardId} />}
        {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} onLogout={onLogout} />}
      </Lazy>
      {quickAddOpen && <QuickAddSheet onClose={() => setQuickAddOpen(false)} />}
      <Confetti />
      <TaskStartChime />
    </div>
  )
}
