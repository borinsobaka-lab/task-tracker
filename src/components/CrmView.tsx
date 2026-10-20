// Раздел «CRM» — рабочая таблица отдела продаж внутри приложения. Вкладки:
//  • Воронка — доска сделок по этапам (перетаскивание меняет этап и пишет историю);
//  • Сделки — таблица со всеми контролями (шаг, решение, запись) и сортировкой;
//  • Статистика — лист «Обзор»: этапы, «Требует внимания», деньги, неделя;
//  • Компании (бывшие «Партнёры»), Контакты, Задачи (лист «Задачи и история») и Правила.
// Перевод сделки на этап, для которого не заполнены нужные поля, не проходит:
// доска показывает, чего не хватает, и предлагает открыть карточку.
// Фильтр проектов из шапки и фильтр участников (ответственный) действуют на всё.

import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, MutableRefObject, ReactNode } from 'react'
import { DndContext, DragOverlay, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { useBoard } from '../store'
import type { Contact, CrmRecord, Deal, DealStage, ID, Partner } from '../types'
import {
  ATTENTION_LABEL,
  COMPANY_KINDS,
  companyKind,
  CRM_COLOR,
  CRM_RULES,
  CRM_STAGES,
  crmOverview,
  dealMatchesAttention,
  dealFieldLabel,
  dealMatchesQuery,
  decisionControl,
  fmtMoney,
  fmtMoneyShort,
  fmtShortDate,
  hasBlocker,
  isEmptyDeal,
  labelOf,
  missingForStage,
  OPEN_STAGES,
  partnerControl,
  recordIssue,
  RECORD_TYPES,
  STAGE_BY_KEY,
  stageFields,
  stepControl,
  TASK_STATUSES,
  taskControl,
} from '../crm'
import type { AttentionKey, DealFieldKey } from '../crm'
import { inProjectFilter } from '../utils'
import { SubHeader } from './SubHeader'
import { Avatar, ProjectAvatar } from './Avatar'
import { CompanyModal, ContactModal, ControlBadge, DealModal, RecordModal, todayKey } from './CrmModals'
import { hasUnseenComments, liveComments, useCommentsSeen } from './commentsSeen'
import { IcoBoard, IcoChart, IcoChecklist, IcoComment, IcoCrm, IcoFile, IcoMeeting, IcoSearch } from '../icons'
import './crm.css'

/** 'partners' — вкладка «Компании» (ключ прежний, чтобы запомненная вкладка не сбилась) */
export type CrmTab = 'funnel' | 'deals' | 'stats' | 'partners' | 'contacts' | 'tasks' | 'rules'

const TABS: { key: CrmTab; label: string; Icon: typeof IcoBoard }[] = [
  { key: 'funnel', label: 'Воронка', Icon: IcoBoard },
  { key: 'deals', label: 'Сделки', Icon: IcoFile },
  { key: 'stats', label: 'Статистика', Icon: IcoChart },
  { key: 'partners', label: 'Компании', Icon: IcoCrm },
  { key: 'contacts', label: 'Контакты', Icon: IcoMeeting },
  { key: 'tasks', label: 'Задачи', Icon: IcoChecklist },
  { key: 'rules', label: 'Правила', Icon: IcoFile },
]

const TAB_KEY = 'tt.crmTab'
function readTab(): CrmTab {
  try {
    const v = localStorage.getItem(TAB_KEY)
    if (TABS.some((t) => t.key === v)) return v as CrmTab
  } catch {
    /* нет доступа к хранилищу — открываем воронку */
  }
  return 'funnel'
}

/** Открытое окно: сделка, компания, контакт или запись истории (поверх них) */
type RecordEdit = { record: CrmRecord } | { init: Partial<CrmRecord> }

/**
 * composeRef — сюда раздел кладёт «новая сделка»: её вызывают кнопка «+» в нижнем
 * меню и плавающая кнопка «Добавить сделку».
 */
export function CrmView({
  memberFilter,
  onMemberFilterChange,
  projectFilter,
  composeRef,
}: {
  memberFilter: ReadonlySet<ID>
  onMemberFilterChange: (f: ReadonlySet<ID>) => void
  projectFilter: ReadonlySet<ID>
  composeRef: MutableRefObject<(() => void) | null>
}) {
  const store = useBoard()
  const [tab, setTabState] = useState<CrmTab>(readTab)
  const [query, setQuery] = useState('')
  const [dealId, setDealIdState] = useState<ID | null>(null)
  // Этап, в который сделку не пустили с доски, — карточка откроется с этим переходом
  const [dealTarget, setDealTarget] = useState<DealStage | undefined>(undefined)
  const [partnerId, setPartnerId] = useState<ID | null>(null)
  const [contactId, setContactId] = useState<ID | null>(null)
  const [recordEdit, setRecordEdit] = useState<RecordEdit | null>(null)
  const [draftId, setDraftId] = useState<ID | null>(null)
  const [attention, setAttention] = useState<AttentionKey | null>(null)
  const [stageFilter, setStageFilter] = useState<'all' | 'open' | DealStage>('all')
  const [taskFilter, setTaskFilter] = useState<'open' | 'overdue' | 'all'>('open')

  const setTab = (t: CrmTab) => {
    setTabState(t)
    try {
      localStorage.setItem(TAB_KEY, t)
    } catch {
      /* не запомним — не страшно */
    }
  }

  const setDealId = (id: ID | null, target?: DealStage) => {
    setDealTarget(target)
    setDealIdState(id)
  }

  // Компании и контакты из сделок, заведённых до справочников, — в справочники (один раз)
  useEffect(() => {
    store.migrateCrmLinks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const today = todayKey()
  const byOwner = (ownerId: ID | undefined) => memberFilter.size === 0 || (!!ownerId && memberFilter.has(ownerId))

  // Фильтры шапки (проекты) и участников (ответственный) — на всё в разделе
  const deals = useMemo(
    () => store.deals.filter((d) => inProjectFilter(d.projectId, projectFilter) && byOwner(d.ownerId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.deals, projectFilter, memberFilter],
  )
  const partners = useMemo(
    () => store.partners.filter((p) => inProjectFilter(p.projectId, projectFilter) && byOwner(p.ownerId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.partners, projectFilter, memberFilter],
  )
  const records = useMemo(() => {
    const dealIds = new Set(store.deals.filter((d) => inProjectFilter(d.projectId, projectFilter)).map((d) => d.id))
    const partnerIds = new Set(store.partners.filter((p) => inProjectFilter(p.projectId, projectFilter)).map((p) => p.id))
    return store.crmRecords.filter((r) => {
      if (!byOwner(r.ownerId)) return false
      if (r.dealId) return dealIds.has(r.dealId)
      if (r.partnerId) return partnerIds.has(r.partnerId)
      return projectFilter.size === 0
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.crmRecords, store.deals, store.partners, projectFilter, memberFilter])

  const contacts = useMemo(() => store.contacts.filter((c) => inProjectFilter(c.projectId, projectFilter)), [store.contacts, projectFilter])

  const shownDeals = useMemo(() => deals.filter((d) => dealMatchesQuery(d, query)), [deals, query])
  const q = query.trim().toLowerCase()
  const shownPartners = useMemo(() => (q ? partners.filter((p) => [p.name, p.note].some((x) => x?.toLowerCase().includes(q))) : partners), [partners, q])
  const shownContacts = useMemo(
    () => (q ? contacts.filter((c) => [c.name, c.role, c.phone, c.email, c.companyId ? store.partner(c.companyId)?.name : ''].some((x) => x?.toLowerCase().includes(q))) : contacts),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contacts, q, store.partners],
  )

  // Проект новой сделки — выбранный в шапке (если выбран)
  const defaultProject = store.projects.find((p) => projectFilter.has(p.id))?.id

  const newDeal = (stage: DealStage = 'new') => {
    const id = store.addDeal({ stage, projectId: defaultProject })
    setDraftId(id)
    setDealId(id)
  }
  const newPartner = () => {
    const id = store.addPartner({ kind: 'client', projectId: defaultProject })
    setDraftId(id)
    setPartnerId(id)
  }
  const newContact = (companyId?: ID) => {
    const id = store.addContact({ companyId, projectId: defaultProject })
    setDraftId(id)
    setContactId(id)
  }
  composeRef.current = () => newDeal()

  // Закрыли только что созданную и так и не заполненную сделку — удаляем
  const closeDeal = () => {
    const id = dealId
    setDealId(null)
    // Компанию / контакт ввели текстом и сразу закрыли окно — всё равно заносим в справочники
    if (id) store.ensureDealLinks(id)
    if (id && id === draftId) {
      setDraftId(null)
      const d = store.deal(id)
      if (d && isEmptyDeal(d) && !store.crmRecords.some((r) => r.dealId === id)) store.deleteDeal(id)
    }
  }
  // То же для новой компании и нового контакта
  const closeContact = () => {
    const id = contactId
    setContactId(null)
    if (!id || id !== draftId) return
    setDraftId(null)
    const c = store.contact(id)
    if (c && !c.name.trim() && !c.phone && !c.email && !store.deals.some((d) => d.contactId === id)) store.deleteContact(id)
  }
  const closePartner = () => {
    const id = partnerId
    setPartnerId(null)
    if (!id || id !== draftId) return
    setDraftId(null)
    const p = store.partner(id)
    if (p && !p.name.trim() && !p.contact && !p.nextStep && !p.note && !store.crmRecords.some((r) => r.partnerId === id) && !store.deals.some((d) => d.partnerId === id) && !store.contacts.some((c) => c.companyId === id))
      store.deletePartner(id)
  }

  // Escape закрывает верхнее окно
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (recordEdit) setRecordEdit(null)
      else if (dealId) closeDeal()
      else if (contactId) closeContact()
      else if (partnerId) closePartner()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const openAttention = (key: AttentionKey) => {
    if (key === 'overdueTasks') {
      setTaskFilter('overdue')
      setTab('tasks')
    } else if (key === 'overduePartners') setTab('partners')
    else {
      setAttention(key)
      setStageFilter('all')
      setTab('deals')
    }
  }

  return (
    <div className="crm-root">
      <SubHeader
        memberFilter={memberFilter}
        onMemberFilterChange={onMemberFilterChange}
        right={
          tab === 'funnel' || tab === 'deals' || tab === 'partners' || tab === 'contacts' ? (
            <label className="crm-search">
              <IcoSearch size={16} />
              <input
                type="search"
                placeholder={tab === 'partners' ? 'Поиск компаний' : tab === 'contacts' ? 'Поиск контактов' : 'Поиск сделок'}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label={tab === 'partners' ? 'Поиск компаний' : tab === 'contacts' ? 'Поиск контактов' : 'Поиск сделок'}
              />
            </label>
          ) : undefined
        }
      >
        <div className="crm-tabs" role="tablist" aria-label="Вкладки CRM">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} aria-label={t.label} title={t.label} className={'crm-tab' + (tab === t.key ? ' active' : '')} onClick={() => setTab(t.key)}>
              <t.Icon size={16} color={tab === t.key ? CRM_COLOR : 'currentColor'} />
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </SubHeader>

      <div className="crm-content">
        {tab === 'funnel' && <Funnel deals={shownDeals} onOpen={setDealId} onAdd={newDeal} showProject={projectFilter.size !== 1} />}
        {tab === 'deals' && (
          <DealsTable
            deals={shownDeals}
            onOpen={setDealId}
            onAdd={() => newDeal()}
            attention={attention}
            onClearAttention={() => setAttention(null)}
            stageFilter={stageFilter}
            onStageFilter={setStageFilter}
          />
        )}
        {tab === 'stats' && <Stats deals={deals} records={records} partners={partners} onAttention={openAttention} />}
        {tab === 'partners' && <CompaniesTable companies={shownPartners} onOpen={setPartnerId} onAdd={newPartner} />}
        {tab === 'contacts' && <ContactsTable contacts={shownContacts} onOpen={setContactId} onAdd={() => newContact()} />}
        {tab === 'tasks' && (
          <TasksList
            records={records}
            filter={taskFilter}
            onFilter={setTaskFilter}
            onOpen={(r) => setRecordEdit({ record: r })}
            onAdd={() => setRecordEdit({ init: { type: 'task', status: 'planned', ownerId: store.identity?.id } })}
            onOpenDeal={setDealId}
            onOpenPartner={setPartnerId}
          />
        )}
        {tab === 'rules' && <Rules />}
        {(tab === 'funnel' || tab === 'deals') && deals.length === 0 && store.deals.length > 0 && (
          <div className="crm-filter-note muted">Сделки есть, но не подходят под фильтр проекта или участника.</div>
        )}
      </div>

      {dealId && (
        <DealModal
          key={dealId}
          dealId={dealId}
          initialTarget={dealTarget}
          onClose={closeDeal}
          onOpenRecord={(r) => setRecordEdit({ record: r })}
          onNewRecord={(init) => setRecordEdit({ init })}
        />
      )}
      {partnerId && !dealId && !contactId && (
        <CompanyModal
          companyId={partnerId}
          onClose={closePartner}
          onOpenDeal={setDealId}
          onOpenContact={setContactId}
          onNewContact={newContact}
          onOpenRecord={(r) => setRecordEdit({ record: r })}
          onNewRecord={(init) => setRecordEdit({ init })}
        />
      )}
      {contactId && !dealId && (
        <ContactModal
          contactId={contactId}
          onClose={closeContact}
          onOpenDeal={setDealId}
          onOpenCompany={(id) => {
            setContactId(null)
            setPartnerId(id)
          }}
        />
      )}
      {recordEdit && (
        <RecordModal
          key={'record' in recordEdit ? recordEdit.record.id : 'new'}
          record={'record' in recordEdit ? recordEdit.record : undefined}
          init={'init' in recordEdit ? recordEdit.init : undefined}
          onClose={() => setRecordEdit(null)}
        />
      )}
    </div>
  )
}

// ---------- Воронка ----------

/** Порядок в колонке: ближайший шаг выше, без срока — внизу */
function byNextStep(a: Deal, b: Deal): number {
  const x = a.nextStepDate ?? '9999'
  const y = b.nextStepDate ?? '9999'
  return x.localeCompare(y) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
}

/** Перевод, который не прошёл: чего не хватает сделке для этапа */
type Blocked = { id: ID; to: DealStage; missing: DealFieldKey[] }

function Funnel({
  deals,
  onOpen,
  onAdd,
  showProject,
}: {
  deals: Deal[]
  onOpen: (id: ID, target?: DealStage) => void
  onAdd: (stage: DealStage) => void
  showProject: boolean
}) {
  const store = useBoard()
  const [dragId, setDragId] = useState<ID | null>(null)
  const [blocked, setBlocked] = useState<Blocked | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
  )
  const onStart = (e: DragStartEvent) => setDragId(String(e.active.id))
  const onEnd = (e: DragEndEvent) => {
    setDragId(null)
    const to = e.over?.id as DealStage | undefined
    const id = String(e.active.id)
    const d = store.deal(id)
    if (!d || !to || d.stage === to) return
    const missing = missingForStage(d, to, d.contactId ? store.contact(d.contactId) : undefined)
    if (missing.length) return setBlocked({ id, to, missing })
    store.updateDeal(id, { stage: to })
    // Выигрыш, проигрыш и пауза требуют подробностей (сумма, причина, дата возврата) — открываем карточку
    if (to === 'won' || to === 'lost' || to === 'paused') onOpen(id)
  }
  const dragged = dragId ? deals.find((d) => d.id === dragId) : undefined

  return (
    <DndContext sensors={sensors} onDragStart={onStart} onDragEnd={onEnd} onDragCancel={() => setDragId(null)}>
      <div className="crm-funnel">
        {CRM_STAGES.map((s) => {
          const list = deals.filter((d) => d.stage === s.key).sort(byNextStep)
          const sum = list.reduce((acc, d) => acc + (d.amount ?? 0), 0)
          return (
            <StageColumn key={s.key} stage={s.key}>
              <div className="board-col-strip" style={{ background: s.color }} />
              <div className="crm-col-head" title={s.criterion}>
                <span className="crm-col-title">{s.label}</span>
                <span className="board-col-count">{list.length}</span>
              </div>
              <div className="crm-col-sum">{sum > 0 ? fmtMoneyShort(sum) : <span className="muted">—</span>}</div>
              <div className="crm-col-cards">
                {list.map((d) => (
                  <DraggableDeal key={d.id} deal={d} onOpen={onOpen} showProject={showProject} hidden={d.id === dragId} />
                ))}
              </div>
              {(OPEN_STAGES.includes(s.key) || s.key === 'paused') && (
                <button type="button" className="crm-col-add" onClick={() => onAdd(s.key)}>
                  + Сделка
                </button>
              )}
            </StageColumn>
          )
        })}
      </div>
      <DragOverlay>{dragged ? <DealCard deal={dragged} showProject={showProject} overlay /> : null}</DragOverlay>
      {blocked && (
        <StageBlockedDialog
          blocked={blocked}
          onFill={() => {
            onOpen(blocked.id, blocked.to)
            setBlocked(null)
          }}
          onCancel={() => setBlocked(null)}
        />
      )}
    </DndContext>
  )
}

/** «Сначала заполните поля»: сделку перетащили на этап, а нужные для него поля пустые */
function StageBlockedDialog({ blocked, onFill, onCancel }: { blocked: Blocked; onFill: () => void; onCancel: () => void }) {
  const store = useBoard()
  const deal = store.deal(blocked.id)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  const stage = STAGE_BY_KEY[blocked.to]
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal crm-modal crm-blocked" role="alertdialog" aria-modal="true" aria-labelledby="crm-blocked-title">
        <h3 id="crm-blocked-title">Сначала заполните поля</h3>
        <p>
          Чтобы перевести «{deal?.company || 'сделку'}» в <b style={{ color: stage.color }}>«{stage.label}»</b>, в карточке не хватает:
        </p>
        <ul className="crm-blocked-list">
          {blocked.missing.map((k) => (
            <li key={k}>{dealFieldLabel(k, blocked.to)}</li>
          ))}
        </ul>
        <div className="crm-blocked-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Отмена
          </button>
          <button type="button" className="btn btn-primary" onClick={onFill} autoFocus>
            Заполнить
          </button>
        </div>
      </div>
    </div>
  )
}

function StageColumn({ stage, children }: { stage: DealStage; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage })
  return (
    <section ref={setNodeRef} className={'board-col crm-col' + (isOver ? ' over' : '')} aria-label={STAGE_BY_KEY[stage].label}>
      {children}
    </section>
  )
}

function DraggableDeal({ deal, onOpen, showProject, hidden }: { deal: Deal; onOpen: (id: ID) => void; showProject: boolean; hidden: boolean }) {
  const { setNodeRef, listeners, attributes } = useDraggable({ id: deal.id })
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} style={{ opacity: hidden ? 0.35 : 1 }} onClick={() => onOpen(deal.id)}>
      <DealCard deal={deal} showProject={showProject} />
    </div>
  )
}

function DealCard({ deal, showProject, overlay }: { deal: Deal; showProject: boolean; overlay?: boolean }) {
  const store = useBoard()
  const today = todayKey()
  const owner = store.data.members.find((m) => m.id === deal.ownerId)
  const project = showProject && deal.projectId ? store.projects.find((p) => p.id === deal.projectId) : undefined
  const step = stepControl(deal, today)
  const decision = decisionControl(deal, today)
  const { seenAt } = useCommentsSeen()
  const commentCount = liveComments(deal).length
  const unseenComments = commentCount > 0 && hasUnseenComments(deal, store.identity?.id ?? null, seenAt(deal.id))
  return (
    <article className={'crm-card' + (overlay ? ' overlay' : '')}>
      <div className="crm-card-top">
        {deal.amount !== undefined && <span className="crm-card-amount">{fmtMoney(deal.amount)}</span>}
      </div>
      <div className="crm-card-company">{deal.company || <span className="muted">Без названия</span>}</div>
      {deal.event && <div className="crm-card-event">{deal.event}</div>}
      {(deal.nextStep || step) && (
        <div className={'crm-card-step tone-' + (step?.tone ?? 'muted')}>
          {deal.nextStep ? `→ ${deal.nextStep}` : step?.label}
          {deal.nextStep && deal.nextStepDate ? ` · ${fmtShortDate(deal.nextStepDate)}` : ''}
          {deal.nextStep && step && step.tone !== 'ok' ? ` · ${step.label.toLowerCase()}` : ''}
        </div>
      )}
      <div className="crm-card-foot">
        {owner && <Avatar member={owner} size="xs" title={`Ответственный: ${owner.name}`} />}
        {project && <ProjectAvatar project={project} size="xs" />}
        {hasBlocker(deal.blocker) && !['won', 'lost'].includes(deal.stage) && (
          <span className="crm-badge tone-warn" title={`Блокер: ${deal.blocker}`}>
            ⚠ {deal.blocker}
          </span>
        )}
        {decision && decision.tone !== 'ok' && decision.tone !== 'muted' && (
          <span className={`crm-badge tone-${decision.tone}`} title="Решение клиента">
            Решение: {decision.label === 'Срок прошёл' ? 'срок прошёл' : fmtShortDate(deal.decisionDate)}
          </span>
        )}
        {commentCount > 0 && (
          <span
            className={'card-badge crm-card-comments' + (unseenComments ? ' unseen' : ' plain')}
            title={unseenComments ? 'Есть непрочитанные комментарии' : `Комментариев: ${commentCount}`}
          >
            <IcoComment size={14} /> {commentCount}
          </span>
        )}
      </div>
    </article>
  )
}

// ---------- Таблица сделок ----------

type SortKey = 'company' | 'stage' | 'amount' | 'owner' | 'nextStepDate' | 'decisionDate' | 'lastContactDate'

function DealsTable({
  deals,
  onOpen,
  onAdd,
  attention,
  onClearAttention,
  stageFilter,
  onStageFilter,
}: {
  deals: Deal[]
  onOpen: (id: ID) => void
  onAdd: () => void
  attention: AttentionKey | null
  onClearAttention: () => void
  stageFilter: 'all' | 'open' | DealStage
  onStageFilter: (f: 'all' | 'open' | DealStage) => void
}) {
  const store = useBoard()
  const today = todayKey()
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'nextStepDate', dir: 1 })
  const memberName = (id?: ID) => store.data.members.find((m) => m.id === id)?.name ?? ''
  const stageIdx = (s: DealStage) => CRM_STAGES.findIndex((x) => x.key === s)

  const rows = useMemo(() => {
    let list = deals
    if (stageFilter === 'open') list = list.filter((d) => OPEN_STAGES.includes(d.stage))
    else if (stageFilter !== 'all') list = list.filter((d) => d.stage === stageFilter)
    if (attention) list = list.filter((d) => dealMatchesAttention(d, attention, today))
    const val = (d: Deal): string | number => {
      switch (sort.key) {
        case 'amount':
          return d.amount ?? -1
        case 'stage':
          return stageIdx(d.stage)
        case 'owner':
          return memberName(d.ownerId)
        default:
          return (d[sort.key] as string | undefined) ?? ''
      }
    }
    return [...list].sort((a, b) => {
      const x = val(a)
      const y = val(b)
      // Пустые значения — всегда внизу, в любом направлении
      if (x === '' && y !== '') return 1
      if (y === '' && x !== '') return -1
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ru')
      return c * sort.dir || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deals, stageFilter, attention, sort, today])

  const th = (key: SortKey, label: string) => (
    <th
      className={'sortable' + (sort.key === key ? ' sorted' : '')}
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : 1 }))}
      aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}
    >
      {label}
      {sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
    </th>
  )
  const total = rows.reduce((s, d) => s + (d.amount ?? 0), 0)

  return (
    <div className="crm-page">
      <div className="crm-toolbar">
        <select className="input crm-select" value={stageFilter} onChange={(e) => onStageFilter(e.target.value as 'all' | 'open' | DealStage)} aria-label="Этап">
          <option value="all">Все этапы</option>
          <option value="open">Открытая воронка</option>
          {CRM_STAGES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        {attention && (
          <button type="button" className="chip active" onClick={onClearAttention} title="Убрать фильтр">
            {ATTENTION_LABEL[attention]} ✕
          </button>
        )}
        <span className="muted crm-total">
          {rows.length} шт. · {fmtMoney(total)}
        </span>
        <button type="button" className="btn btn-sm crm-add-btn" onClick={onAdd}>
          + Сделка
        </button>
      </div>
      {rows.length === 0 ? (
        <Empty text={deals.length === 0 ? 'Сделок пока нет — добавьте первую.' : 'Под фильтр ничего не подходит.'} />
      ) : (
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                {th('company', 'Компания')}
                <th>Мероприятие</th>
                {th('stage', 'Этап')}
                {th('amount', 'Сумма, ₽')}
                {th('owner', 'Ответственный')}
                <th>Следующий шаг</th>
                {th('nextStepDate', 'Срок шага')}
                <th>Контроль шага</th>
                {th('decisionDate', 'Решение до')}
                <th>Контроль решения</th>
                <th>Блокер</th>
                {th('lastContactDate', 'Посл. контакт')}
                <th>Контроль записи</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const issue = recordIssue(d)
                return (
                  <tr key={d.id} onClick={() => onOpen(d.id)}>
                    <td className="strong">{d.company || <span className="muted">Без названия</span>}</td>
                    <td>{d.event}</td>
                    <td className="nowrap">
                      <span className="crm-stage-dot" style={{ background: STAGE_BY_KEY[d.stage].color }} />
                      {STAGE_BY_KEY[d.stage].label}
                    </td>
                    <td className="num">{d.amount === undefined ? '' : fmtMoney(d.amount).replace(' ₽', '')}</td>
                    <td className="nowrap">{memberName(d.ownerId)}</td>
                    <td>{d.nextStep}</td>
                    <td className="nowrap">{fmtShortDate(d.nextStepDate)}</td>
                    <td>
                      <ControlBadge c={stepControl(d, today)} />
                    </td>
                    <td className="nowrap">{fmtShortDate(d.decisionDate)}</td>
                    <td>
                      <ControlBadge c={decisionControl(d, today)} />
                    </td>
                    <td>{d.blocker}</td>
                    <td className="nowrap">{fmtShortDate(d.lastContactDate)}</td>
                    <td>{issue && <ControlBadge c={{ label: issue, tone: 'warn' }} />}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------- Статистика (лист «Обзор») ----------

function Stats({
  deals,
  records,
  partners,
  onAttention,
}: {
  deals: Deal[]
  records: CrmRecord[]
  partners: Partner[]
  onAttention: (k: AttentionKey) => void
}) {
  const today = todayKey()
  const o = useMemo(() => crmOverview(deals, records, partners, today), [deals, records, partners, today])
  const maxCount = Math.max(1, ...o.stages.map((s) => s.count))
  const attentionKeys = Object.keys(ATTENTION_LABEL) as AttentionKey[]

  return (
    <div className="crm-page crm-stats">
      <div className="crm-kpis">
        <Kpi label="Открытая воронка" value={fmtMoney(o.open.sum)} sub={`${o.open.count} сделок${o.open.noAmount ? `, без суммы — ${o.open.noAmount}` : ''}`} />
        <Kpi label="Выигранные заказы" value={fmtMoney(o.wonOrders)} sub={`${o.stages.find((s) => s.stage.key === 'won')?.count ?? 0} сделок`} tone="ok" />
        <Kpi label="Фактически получено" value={fmtMoney(o.paidTotal)} sub="по всем сделкам" />
        <Kpi label="КП за 7 дней" value={String(o.week.proposals)} sub="отправлено" />
        <Kpi label="Выиграно за 7 дней" value={String(o.week.won)} sub="сделок" tone="ok" />
      </div>

      <div className="crm-stats-grid">
        <section className="crm-panel">
          <h4>Сделки по этапам</h4>
          <table className="crm-table crm-stage-table">
            <thead>
              <tr>
                <th>Этап</th>
                <th className="num">Сделок</th>
                <th className="num">Сумма предложений, ₽</th>
                <th className="num">Без суммы</th>
              </tr>
            </thead>
            <tbody>
              {o.stages.map((s) => (
                <tr key={s.stage.key} className={s.stage.key === 'won' ? 'sep' : ''}>
                  <td>
                    <div className="crm-bar-label">
                      <span className="crm-stage-dot" style={{ background: s.stage.color }} />
                      {s.stage.label}
                    </div>
                    <div className="crm-bar">
                      <span style={{ width: `${(s.count / maxCount) * 100}%`, background: s.stage.color } as CSSProperties} />
                    </div>
                  </td>
                  <td className="num">{s.count}</td>
                  <td className="num">{s.sum ? fmtMoney(s.sum).replace(' ₽', '') : '—'}</td>
                  <td className="num">{s.noAmount || ''}</td>
                </tr>
              ))}
              <tr className="total">
                <td>Открытая воронка</td>
                <td className="num">{o.open.count}</td>
                <td className="num">{fmtMoney(o.open.sum).replace(' ₽', '')}</td>
                <td className="num">{o.open.noAmount || ''}</td>
              </tr>
            </tbody>
          </table>
          <p className="muted crm-note">Суммы предложений не являются прогнозом выручки. Пустые суммы не считаются нулевой ценой.</p>
        </section>

        <section className="crm-panel">
          <h4>Требует внимания</h4>
          <ul className="crm-attention">
            {attentionKeys.map((k) => {
              const n = o.attention[k]
              const bad = k === 'overdueSteps' || k === 'decisionOverdue' || k === 'overdueTasks' || k === 'overduePartners'
              return (
                <li key={k}>
                  <button type="button" onClick={() => onAttention(k)} disabled={n === 0}>
                    <span>{ATTENTION_LABEL[k]}</span>
                    <span className={'crm-attention-n' + (n > 0 ? (bad ? ' tone-bad' : ' tone-warn') : '')}>{n}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="muted crm-note">
            На {new Date().toLocaleDateString('ru-RU')}. Нажмите на строку — откроется список. Для недельного статуса фиксируйте факты в истории; старые записи не перезаписывайте.
          </p>
        </section>
      </div>
    </div>
  )
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'ok' }) {
  return (
    <div className={'crm-kpi' + (tone ? ` tone-${tone}` : '')}>
      <div className="crm-kpi-label">{label}</div>
      <div className="crm-kpi-value">{value}</div>
      {sub && <div className="crm-kpi-sub muted">{sub}</div>}
    </div>
  )
}

// ---------- Компании ----------

function CompaniesTable({ companies, onOpen, onAdd }: { companies: Partner[]; onOpen: (id: ID) => void; onAdd: () => void }) {
  const store = useBoard()
  const today = todayKey()
  const memberName = (id?: ID) => store.data.members.find((m) => m.id === id)?.name ?? ''
  const rows = useMemo(() => [...companies].sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.id.localeCompare(b.id)), [companies])
  return (
    <div className="crm-page">
      <div className="crm-toolbar">
        <span className="muted">Клиенты, агентства и партнёры. Новая компания, введённая в сделке, появляется здесь сама.</span>
        <button type="button" className="btn btn-sm crm-add-btn" onClick={onAdd}>
          + Компания
        </button>
      </div>
      {rows.length === 0 ? (
        <Empty text="Компаний пока нет." />
      ) : (
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Компания</th>
                <th>Тип</th>
                <th className="num">Контакты</th>
                <th className="num">Сделок</th>
                <th className="num">В работе, ₽</th>
                <th>Ответственный</th>
                <th>Контроль</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const deals = store.deals.filter((d) => d.partnerId === p.id)
                const open = deals.filter((d) => OPEN_STAGES.includes(d.stage)).reduce((sum, d) => sum + (d.amount ?? 0), 0)
                return (
                  <tr key={p.id} onClick={() => onOpen(p.id)}>
                    <td className="strong">{p.name || <span className="muted">Без названия</span>}</td>
                    <td className="nowrap">{labelOf(COMPANY_KINDS, companyKind(p))}</td>
                    <td className="num">{store.contacts.filter((c) => c.companyId === p.id).length || ''}</td>
                    <td className="num">{deals.length || ''}</td>
                    <td className="num">{open ? fmtMoney(open).replace(' ₽', '') : ''}</td>
                    <td className="nowrap">{memberName(p.ownerId)}</td>
                    <td>
                      <ControlBadge c={partnerControl(p, today)} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------- Контакты ----------

function ContactsTable({ contacts, onOpen, onAdd }: { contacts: Contact[]; onOpen: (id: ID) => void; onAdd: () => void }) {
  const store = useBoard()
  return (
    <div className="crm-page">
      <div className="crm-toolbar">
        <span className="muted">Новый контакт, введённый в сделке, появляется здесь сам; выбранный из списка — подставляет телефон и email.</span>
        <button type="button" className="btn btn-sm crm-add-btn" onClick={onAdd}>
          + Контакт
        </button>
      </div>
      {contacts.length === 0 ? (
        <Empty text="Контактов пока нет." />
      ) : (
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Имя</th>
                <th>Должность</th>
                <th>Компания</th>
                <th>Телефон</th>
                <th>Email</th>
                <th className="num">Сделок</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} onClick={() => onOpen(c.id)}>
                  <td className="strong">{c.name || <span className="muted">Без имени</span>}</td>
                  <td>{c.role}</td>
                  <td>{c.companyId ? store.partner(c.companyId)?.name : ''}</td>
                  <td className="nowrap">{c.phone}</td>
                  <td>{c.email}</td>
                  <td className="num">{store.deals.filter((d) => d.contactId === c.id).length || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------- Задачи и история ----------

function TasksList({
  records,
  filter,
  onFilter,
  onOpen,
  onAdd,
  onOpenDeal,
  onOpenPartner,
}: {
  records: CrmRecord[]
  filter: 'open' | 'overdue' | 'all'
  onFilter: (f: 'open' | 'overdue' | 'all') => void
  onOpen: (r: CrmRecord) => void
  onAdd: () => void
  onOpenDeal: (id: ID) => void
  onOpenPartner: (id: ID) => void
}) {
  const store = useBoard()
  const today = todayKey()
  const memberName = (id?: ID) => store.data.members.find((m) => m.id === id)?.name ?? ''
  const rows = useMemo(() => {
    if (filter === 'all') return records
    const open = records.filter((r) => r.status === 'planned' || r.status === 'doing')
    // Открытые — по сроку: ближайшие и просроченные сверху
    const sorted = [...open].sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.id.localeCompare(b.id))
    return filter === 'overdue' ? sorted.filter((r) => taskControl(r, today)?.label === 'Просрочено') : sorted
  }, [records, filter, today])

  const FILTERS: { key: typeof filter; label: string }[] = [
    { key: 'open', label: 'Открытые' },
    { key: 'overdue', label: 'Просроченные' },
    { key: 'all', label: 'Вся история' },
  ]

  return (
    <div className="crm-page">
      <div className="crm-toolbar">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className={'chip' + (filter === f.key ? ' active' : '')} onClick={() => onFilter(f.key)}>
            {f.label}
          </button>
        ))}
        <button type="button" className="btn btn-sm crm-add-btn" onClick={onAdd}>
          + Задача
        </button>
      </div>
      {rows.length === 0 ? (
        <Empty text={filter === 'all' ? 'Записей пока нет. Звонки, письма и задачи добавляются из карточки сделки или кнопкой «+ Задача».' : 'Открытых задач нет.'} />
      ) : (
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Сделка / компания</th>
                <th>Тип</th>
                <th>Итог / факт</th>
                <th>Следующее действие</th>
                <th>Ответственный</th>
                <th>Срок</th>
                <th>Статус</th>
                <th>Контроль</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const deal = r.dealId ? store.deal(r.dealId) : undefined
                const partner = r.partnerId ? store.partner(r.partnerId) : undefined
                return (
                  <tr key={r.id} onClick={() => onOpen(r)}>
                    <td className="nowrap">{fmtShortDate(r.date)}</td>
                    <td>
                      {deal && (
                        <button type="button" className="crm-link" onClick={(e) => (e.stopPropagation(), onOpenDeal(deal.id))}>
                          {deal.company || 'Без названия'}
                        </button>
                      )}
                      {partner && (
                        <button type="button" className="crm-link" onClick={(e) => (e.stopPropagation(), onOpenPartner(partner.id))}>
                          🤝 {partner.name || 'Без названия'}
                        </button>
                      )}
                    </td>
                    <td className="nowrap">{labelOf(RECORD_TYPES, r.type)}</td>
                    <td>{r.result}</td>
                    <td>{r.nextAction}</td>
                    <td className="nowrap">{memberName(r.ownerId)}</td>
                    <td className="nowrap">{fmtShortDate(r.due)}</td>
                    <td className="nowrap">{labelOf(TASK_STATUSES, r.status)}</td>
                    <td>{r.type !== 'stage' && <ControlBadge c={taskControl(r, today)} />}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------- Правила ----------

/** Что этап требует заполнить. Этапы открытой воронки накопительные — у них только новое. */
function requiredText(stage: DealStage): string {
  const i = OPEN_STAGES.indexOf(stage)
  const prev = i > 1 ? new Set(stageFields(OPEN_STAGES[i - 1])) : null
  const fields = stageFields(stage).filter((k) => !prev?.has(k))
  return `${prev ? 'Плюс к прежним этапам' : 'Заполнить'}: ${fields.map((k) => dealFieldLabel(k, stage)).join(', ')}.`
}

function Rules() {
  return (
    <div className="crm-page crm-rules">
      <section className="crm-panel">
        <h4>Этапы и что подтверждает переход</h4>
        <ul className="crm-rules-stages">
          {CRM_STAGES.map((s) => (
            <li key={s.key}>
              <span className="crm-stage-dot" style={{ background: s.color }} />
              <b>{s.label}</b>
              <span>
                {s.criterion}
                <span className="crm-rules-req">{requiredText(s.key)}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section className="crm-panel">
        <h4>Правила ведения</h4>
        <dl className="crm-rules-list">
          {CRM_RULES.map((r) => (
            <div key={r.title}>
              <dt>{r.title}</dt>
              <dd>{r.text}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="crm-empty muted">{text}</div>
}
