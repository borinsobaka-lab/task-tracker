// Окна CRM: карточка сделки (все поля листа «Сделки» на подложках по смыслу,
// её история и задачи, справа — комментарии), карточки компании и контакта и
// редактор записи «Задачи и история». Сделка, компания и контакт сохраняются по
// ходу ввода; запись истории — кнопкой «Сохранить».
//
// Этап сделки меняется, только когда заполнены поля, которые он требует
// (crm.ts → missingForStage): иначе карточка перечисляет их и подсвечивает красным.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useBoard } from '../store'
import type { CompanyKind, Contact, CrmRecord, CrmRecordType, CrmTaskStatus, Deal, DealStage, ID, Partner } from '../types'
import {
  COMPANY_KINDS,
  companyKind,
  CONTRACT_STATUSES,
  CRM_STAGES,
  dealFieldLabel,
  decisionControl,
  fmtDate,
  fmtMoney,
  fmtMoneyInput,
  labelOf,
  LEAD_SOURCES,
  missingForStage,
  parseMoney,
  PARTNER_STATUSES,
  partnerControl,
  PAYMENT_STATUSES,
  QUALITY,
  recordIssue,
  RECORD_TYPES,
  STAGE_BY_KEY,
  stepControl,
  TASK_STATUSES,
  taskControl,
} from '../crm'
import type { Control, DealFieldKey } from '../crm'
import { toDateKey } from '../utils'
import { SheetGrabber } from './SheetGrabber'
import { DealCommentsPanel } from './Comments'
import { Combobox } from './Combobox'
import type { ComboOption } from './Combobox'
import { IcoX } from '../icons'

export const todayKey = (): string => toDateKey(new Date())

// ---------- Мелкие части ----------

export function ControlBadge({ c, title }: { c: Control | null; title?: string }) {
  if (!c) return null
  return (
    <span className={`crm-badge tone-${c.tone}`} title={title}>
      {c.label}
    </span>
  )
}

/**
 * span — ширина в колонках шестиколоночной сетки (.crm-grid-6): 2 — треть, 3 — половина, 4 — две трети.
 * field — ключ обязательного поля (по нему карточка находит поле), invalid — подсветить красным.
 */
function Field({
  label,
  wide,
  span,
  field,
  invalid,
  hint,
  children,
}: {
  label: string
  wide?: boolean
  span?: 2 | 3 | 4
  field?: DealFieldKey
  invalid?: boolean
  /** Пояснение под полем — как его правильно заполнять */
  hint?: string
  children: ReactNode
}) {
  return (
    <label className={'crm-field' + (wide ? ' wide' : '') + (span ? ` s${span}` : '') + (invalid ? ' invalid' : '')} data-field={field}>
      <span className="crm-field-label">{label}</span>
      {children}
      {hint && <span className="crm-field-hint">{hint}</span>}
    </label>
  )
}

function TextIn({
  value,
  onChange,
  placeholder,
  multiline,
  type,
  disabled,
}: {
  value: string | undefined
  onChange: (v: string) => void
  placeholder?: string
  multiline?: boolean
  type?: 'tel' | 'email'
  disabled?: boolean
}) {
  return multiline ? (
    <textarea className="input crm-textarea" rows={2} value={value ?? ''} placeholder={placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
  ) : (
    <input className="input" type={type} value={value ?? ''} placeholder={placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
  )
}

function DateIn({ value, onChange }: { value: string | undefined; onChange: (v: string) => void }) {
  return <input className="input" type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
}

/** Сумма с разделителями разрядов: «1250000» → «1 250 000». Запятая — копейки (до двух знаков). */
function groupMoney(raw: string): string {
  const t = raw.replace(/\./g, ',').replace(/[^\d,]/g, '')
  const comma = t.indexOf(',')
  const int = (comma < 0 ? t : t.slice(0, comma)).replace(/^0+(?=\d)/, '')
  const frac = comma < 0 ? null : t.slice(comma + 1).replace(/,/g, '').slice(0, 2)
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return frac === null ? grouped : `${grouped || '0'},${frac}`
}

/** Сумма: пустое поле — «не знаем», 0 — настоящий ноль. Пока поле в фокусе, держим набранный текст. */
function MoneyIn({ value, onChange }: { value: number | undefined; onChange: (v: number | undefined) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [text, setText] = useState(fmtMoneyInput(value))
  const focused = useRef(false)
  const caret = useRef<number | null>(null)
  useEffect(() => {
    if (!focused.current) setText(fmtMoneyInput(value))
  }, [value])
  // Разделители сдвигают текст — возвращаем курсор к той же цифре
  useLayoutEffect(() => {
    if (caret.current !== null && ref.current) {
      ref.current.setSelectionRange(caret.current, caret.current)
      caret.current = null
    }
  })
  return (
    <input
      ref={ref}
      className="input crm-money"
      inputMode="decimal"
      placeholder="0 ₽"
      value={text}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false
        setText(fmtMoneyInput(value))
      }}
      onChange={(e) => {
        const raw = e.target.value
        const digitsBefore = raw.slice(0, e.target.selectionStart ?? raw.length).replace(/[^\d,.]/g, '').length
        const next = groupMoney(raw)
        let pos = 0
        for (let n = 0; pos < next.length && n < digitsBefore; pos++) if (/[\d,]/.test(next[pos])) n++
        caret.current = pos
        setText(next)
        onChange(parseMoney(next))
      }}
    />
  )
}

function SelectIn<K extends string>({
  value,
  onChange,
  options,
  empty = '—',
}: {
  value: K | undefined
  onChange: (v: K | undefined) => void
  options: { key: K; label: string }[]
  empty?: string | false
}) {
  return (
    <select className="input" value={value ?? ''} onChange={(e) => onChange((e.target.value || undefined) as K | undefined)}>
      {empty !== false && <option value="">{empty}</option>}
      {options.map((o) => (
        <option key={o.key} value={o.key}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

/** Ответственный. Если у проекта в настройках заданы участники — выбирать можно только из них. */
function MemberIn({ value, onChange, projectId }: { value: ID | undefined; onChange: (v: ID | undefined) => void; projectId?: ID }) {
  const store = useBoard()
  const project = projectId ? store.projects.find((p) => p.id === projectId) : undefined
  const allowed = project?.memberIds?.length ? new Set(project.memberIds) : null
  const opts = store.members.filter((m) => !allowed || allowed.has(m.id)).map((m) => ({ key: m.id, label: m.name }))
  // Ответственный в архиве или не в проекте — показываем его, чтобы поле не выглядело пустым
  if (value && !opts.some((o) => o.key === value)) {
    const m = store.data.members.find((x) => x.id === value)
    if (m) opts.push({ key: m.id, label: `${m.name} (${m.archived ? 'в архиве' : 'не в проекте'})` })
  }
  return <SelectIn value={value} onChange={onChange} options={opts} empty="Не назначен" />
}

function ProjectIn({ value, onChange }: { value: ID | undefined; onChange: (v: ID | undefined) => void }) {
  const store = useBoard()
  return (
    <SelectIn
      value={value}
      onChange={onChange}
      options={store.projects.map((p, i) => ({ key: p.id, label: p.name?.trim() || `Проект ${i + 1}` }))}
      empty="Без проекта"
    />
  )
}

function ModalShell({ onClose, className, children }: { onClose: () => void; className?: string; children: ReactNode }) {
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal crm-modal ' + (className ?? '')} role="dialog" aria-modal="true">
        <SheetGrabber onClose={onClose} />
        {children}
      </div>
    </div>
  )
}

/** Подложка с группой полей */
function Panel({ title, hint, accent, action, children }: { title: string; hint?: ReactNode; accent?: boolean; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={'crm-section' + (accent ? ' accent' : '')}>
      <div className="crm-section-head">
        <h4>{title}</h4>
        {hint && <span className="crm-section-hint">{hint}</span>}
        {action}
      </div>
      {children}
    </section>
  )
}

function Head({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children?: ReactNode }) {
  return (
    <header className="crm-modal-head">
      <div className="crm-modal-titles">
        {sub && <div className="crm-modal-sub">{sub}</div>}
        <h3>{title}</h3>
      </div>
      {children}
      <button type="button" className="cm-close" onClick={onClose} title="Закрыть" aria-label="Закрыть">
        <IcoX size={22} />
      </button>
    </header>
  )
}

/** Список записей истории (в карточке сделки и компании) */
function HistoryList({ records, onOpen }: { records: CrmRecord[]; onOpen: (r: CrmRecord) => void }) {
  const store = useBoard()
  const today = todayKey()
  if (records.length === 0) return <div className="muted crm-empty-line">Записей пока нет.</div>
  return (
    <ul className="crm-history">
      {records.map((r) => {
        const owner = store.data.members.find((m) => m.id === r.ownerId)
        return (
          <li key={r.id}>
            <button type="button" className="crm-history-row" onClick={() => onOpen(r)}>
              <span className="crm-history-date">{fmtDate(r.date)}</span>
              <span className={'crm-history-type' + (r.type === 'stage' ? ' stage' : '')}>{labelOf(RECORD_TYPES, r.type)}</span>
              <span className="crm-history-main">
                {r.result && <span className="crm-history-result">{r.result}</span>}
                {r.nextAction && (
                  <span className="crm-history-next">
                    → {r.nextAction}
                    {r.due ? ` · до ${fmtDate(r.due)}` : ''}
                    {owner ? ` · ${owner.name}` : ''}
                  </span>
                )}
              </span>
              {r.type !== 'stage' && <ControlBadge c={taskControl(r, today)} />}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** Сделки компании или контакта — строки со ссылкой на карточку */
function DealList({ deals, onOpen, empty }: { deals: Deal[]; onOpen: (id: ID) => void; empty: string }) {
  if (deals.length === 0) return <div className="muted crm-empty-line">{empty}</div>
  return (
    <ul className="crm-history">
      {deals.map((d) => (
        <li key={d.id}>
          <button type="button" className="crm-history-row" onClick={() => onOpen(d.id)}>
            <span className="crm-stage-dot" style={{ background: STAGE_BY_KEY[d.stage].color }} />
            <span className="crm-history-main">
              <span className="crm-history-result">{d.event || d.company || 'Без названия'}</span>
              <span className="crm-history-next">{STAGE_BY_KEY[d.stage].label}</span>
            </span>
            <span className="crm-history-date">{fmtMoney(d.amount)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

const normName = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

/** Подсказки контактов: сначала люди этой компании */
function contactOptions(contacts: Contact[], companies: Partner[], companyId: ID | undefined): ComboOption[] {
  const companyName = (id?: ID) => (id ? companies.find((p) => p.id === id)?.name : undefined)
  const own = (c: Contact) => Number(!!companyId && c.companyId === companyId)
  return [...contacts]
    .sort((a, b) => own(b) - own(a))
    .map((c) => ({ id: c.id, label: c.name || 'Без имени', sub: [c.role, companyName(c.companyId), c.phone || c.email].filter(Boolean).join(' · ') }))
}

// ---------- Карточка сделки ----------

/**
 * initialTarget — этап, в который сделку пытались перетащить на доске, а поля не заполнены:
 * карточка открывается с этим переходом «в ожидании».
 */
export function DealModal({
  dealId,
  initialTarget,
  onClose,
  onOpenRecord,
  onNewRecord,
}: {
  dealId: ID
  initialTarget?: DealStage
  onClose: () => void
  onOpenRecord: (r: CrmRecord) => void
  onNewRecord: (init: Partial<CrmRecord>) => void
}) {
  const store = useBoard()
  const deal = store.deal(dealId)
  const rootRef = useRef<HTMLDivElement>(null)
  const [target, setTarget] = useState<DealStage | null>(initialTarget ?? null)
  useEffect(() => {
    if (!deal) onClose() // удалили (в том числе на другом устройстве)
  }, [deal, onClose])

  const contact = deal?.contactId ? store.contact(deal.contactId) : undefined
  const targetMissing = deal && target ? missingForStage(deal, target, contact) : []
  // Нет перехода «в ожидании» — подсвечиваем то, чего не хватает текущему этапу (кроме первого)
  const currentMissing = deal && !target && deal.stage !== 'new' ? missingForStage(deal, deal.stage, contact) : []
  const shownMissing = target ? targetMissing : currentMissing
  const highlight = new Set<DealFieldKey>(shownMissing)

  /** Прокрутить к полю и поставить в него курсор */
  const focusField = (k: DealFieldKey) => {
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-field="${k}"]`)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.querySelector<HTMLElement>('input:not([disabled]), textarea:not([disabled]), select')?.focus({ preventScroll: true })
  }
  // Открыли с переходом «в ожидании» — сразу к первому пустому полю
  useEffect(() => {
    if (initialTarget && targetMissing.length) setTimeout(() => focusField(targetMissing[0]), 50)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!deal) return null

  const today = todayKey()
  const set = (patch: Partial<Deal>) => store.updateDeal(deal.id, patch)
  const issue = recordIssue(deal)
  const records = store.crmRecords.filter((r) => r.dealId === deal.id)
  const stage = STAGE_BY_KEY[deal.stage]
  const left = deal.orderAmount !== undefined && deal.paidTotal !== undefined ? deal.orderAmount - deal.paidTotal : undefined
  const req = (k: DealFieldKey) => ({ field: k, invalid: highlight.has(k) })

  const changeStage = (to: DealStage) => {
    if (to === deal.stage) return setTarget(null)
    const missing = missingForStage(deal, to, contact)
    if (missing.length === 0) {
      setTarget(null)
      set({ stage: to })
    } else {
      setTarget(to)
      setTimeout(() => focusField(missing[0]), 50)
    }
  }

  const remove = () => {
    if (confirm(`Удалить сделку «${deal.company || 'без названия'}» вместе с её историей?`)) {
      store.deleteDeal(deal.id)
      onClose()
    }
  }

  // Компания: текст + ссылка на компанию из справочника (при точном совпадении названия)
  const companyByName = (t: string) => store.partners.find((p) => normName(p.name) === normName(t))
  // Контакт — так же; при одинаковых именах — сначала человек этой компании
  const contactByName = (t: string) => {
    const same = store.contacts.filter((c) => normName(c.name) === normName(t))
    return same.find((c) => c.companyId === deal.partnerId) ?? same[0]
  }
  const pickContact = (id: ID) => {
    const c = store.contact(id)
    if (!c) return
    // Компания ещё не указана — берём компанию контакта
    const company = !deal.company.trim() && c.companyId ? store.partner(c.companyId) : undefined
    set({ contactId: c.id, contactName: c.name, ...(company ? { company: company.name, partnerId: company.id } : {}) })
  }
  const noContact = !deal.contactName?.trim()
  const contactHint = 'Сначала укажите контактное лицо'
  const labelStage = target ?? deal.stage

  return (
    <ModalShell onClose={onClose} className="crm-deal-modal">
      <Head title={deal.company || 'Новая сделка'} sub={deal.event || 'Сделка'} onClose={onClose}>
        <select
          className="input crm-stage-select"
          style={{ ['--stage' as string]: stage.color }}
          value={deal.stage}
          onChange={(e) => changeStage(e.target.value as DealStage)}
          aria-label="Этап"
          title={stage.criterion}
        >
          {CRM_STAGES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </Head>

      <div className="crm-deal-body">
        <div className="crm-modal-body crm-deal-main" ref={rootRef}>
          <div className="crm-controls">
            <ControlBadge c={stepControl(deal, today)} title="Контроль шага" />
            <ControlBadge c={decisionControl(deal, today)} title="Контроль решения" />
            {issue ? <ControlBadge c={{ label: issue, tone: 'warn' }} title="Контроль записи" /> : <ControlBadge c={{ label: 'Запись в порядке', tone: 'ok' }} title="Контроль записи" />}
            <span className="crm-criterion muted">{stage.criterion}</span>
          </div>

          {(target || currentMissing.length > 0) && (
            <div className={'crm-required' + (target ? ' blocking' : '') + (target && !targetMissing.length ? ' ready' : '')} role={target ? 'alert' : undefined}>
              <div className="crm-required-text">
                {target
                  ? targetMissing.length
                    ? `Чтобы перевести сделку в «${STAGE_BY_KEY[target].label}», заполните:`
                    : `Всё нужное заполнено — можно переводить в «${STAGE_BY_KEY[target].label}».`
                  : `Для этапа «${stage.label}» не заполнено:`}
              </div>
              {shownMissing.length > 0 && (
                <div className="crm-required-list">
                  {shownMissing.map((k) => (
                    <button key={k} type="button" className="crm-required-chip" onClick={() => focusField(k)}>
                      {dealFieldLabel(k, labelStage)}
                    </button>
                  ))}
                </div>
              )}
              {target && (
                <div className="crm-required-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={targetMissing.length > 0}
                    onClick={() => {
                      set({ stage: target })
                      setTarget(null)
                    }}
                  >
                    Перевести в «{STAGE_BY_KEY[target].label}»
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => setTarget(null)}>
                    Отмена
                  </button>
                </div>
              )}
            </div>
          )}

          <Panel title="Сделка">
            <div className="crm-grid crm-grid-6">
              <Field label="Компания / агентство" span={3} {...req('company')}>
                <Combobox
                  value={deal.company}
                  options={store.partners.map((p) => ({ id: p.id, label: p.name || 'Без названия', sub: labelOf(COMPANY_KINDS, companyKind(p)) }))}
                  onText={(t) => set({ company: t, partnerId: companyByName(t)?.id })}
                  onPick={(id) => {
                    const p = store.partner(id)
                    if (p) set({ company: p.name, partnerId: p.id })
                  }}
                  onCommit={() => store.ensureDealLinks(deal.id)}
                  placeholder="Начните вводить название"
                  newLabel="Новая компания"
                />
              </Field>
              <Field label="Мероприятие" span={3} {...req('event')}>
                <TextIn value={deal.event} onChange={(v) => set({ event: v })} placeholder="Конференция 27.11.26" />
              </Field>
              <Field label="Сумма предложения, ₽" span={3} {...req('amount')} hint="Полная сумма к оплате, с НДС. Не знаете — оставьте пустым">
                <MoneyIn value={deal.amount} onChange={(v) => set({ amount: v })} />
              </Field>
              <Field label="Источник лида" span={3}>
                <SelectIn value={deal.source} onChange={(v) => set({ source: v })} options={LEAD_SOURCES} />
              </Field>
              <Field label="Ответственный" span={3}>
                <MemberIn value={deal.ownerId} onChange={(v) => set({ ownerId: v })} projectId={deal.projectId} />
              </Field>
              {store.projects.length > 0 && (
                <Field label="Проект" span={3}>
                  <ProjectIn value={deal.projectId} onChange={(v) => set({ projectId: v })} />
                </Field>
              )}
            </div>
          </Panel>

          <Panel title="Следующий шаг" accent>
            <div className="crm-grid crm-grid-6">
              <Field label="Что делаем дальше" wide {...req('nextStep')}>
                <TextIn value={deal.nextStep} onChange={(v) => set({ nextStep: v })} placeholder="Согласовать условия" />
              </Field>
              <Field label={deal.stage === 'paused' ? 'Дата возврата' : 'Срок шага'} span={2} {...req('nextStepDate')}>
                <DateIn value={deal.nextStepDate} onChange={(v) => set({ nextStepDate: v })} />
              </Field>
              <Field label="Решение клиента до" span={2} {...req('decisionDate')}>
                <DateIn value={deal.decisionDate} onChange={(v) => set({ decisionDate: v })} />
              </Field>
              <Field label="Последний контакт" span={2} {...req('lastContactDate')}>
                <DateIn value={deal.lastContactDate} onChange={(v) => set({ lastContactDate: v })} />
              </Field>
              <Field label="Подтверждённый итог" span={3} {...req('outcome')}>
                <TextIn value={deal.outcome} onChange={(v) => set({ outcome: v })} placeholder="Что точно известно после последнего контакта" multiline />
              </Field>
              <Field label="Блокер / нужное решение руководителя" span={3}>
                <TextIn value={deal.blocker} onChange={(v) => set({ blocker: v })} placeholder="нет" multiline />
              </Field>
            </div>
          </Panel>

          <Panel title="Контактное лицо">
            <div className="crm-grid crm-grid-6">
              <Field label="Имя" span={3} {...req('contactName')}>
                <Combobox
                  value={deal.contactName ?? ''}
                  options={contactOptions(store.contacts, store.partners, deal.partnerId)}
                  onText={(t) => set({ contactName: t, contactId: contactByName(t)?.id })}
                  onPick={pickContact}
                  onCommit={() => store.ensureDealLinks(deal.id)}
                  placeholder="Начните вводить имя"
                  newLabel="Новый контакт"
                />
              </Field>
              <Field label="Должность / роль" span={3}>
                <TextIn value={contact?.role} onChange={(v) => store.updateDealContact(deal.id, { role: v })} placeholder={noContact ? contactHint : 'Менеджер проекта'} disabled={noContact} />
              </Field>
              <Field label="Телефон" span={3} {...req('contactReach')}>
                <TextIn type="tel" value={contact?.phone} onChange={(v) => store.updateDealContact(deal.id, { phone: v })} placeholder={noContact ? contactHint : '+7 …'} disabled={noContact} />
              </Field>
              <Field label="Email" span={3} invalid={highlight.has('contactReach')}>
                <TextIn type="email" value={contact?.email} onChange={(v) => store.updateDealContact(deal.id, { email: v })} placeholder={noContact ? contactHint : 'mail@company.ru'} disabled={noContact} />
              </Field>
            </div>
          </Panel>

          <Panel title="Мероприятие">
            <div className="crm-grid crm-grid-6">
              <Field label="Дата мероприятия" span={3} {...req('eventDate')}>
                <DateIn value={deal.eventDate} onChange={(v) => set({ eventDate: v })} />
              </Field>
              <Field label="Участники, чел." span={3}>
                <TextIn value={deal.attendees} onChange={(v) => set({ attendees: v })} placeholder="до 1000" />
              </Field>
              <Field label="Потребность / модули" wide {...req('needs')}>
                <TextIn value={deal.needs} onChange={(v) => set({ needs: v })} placeholder="Что нужно клиенту" multiline />
              </Field>
            </div>
          </Panel>

          <Panel title="КП и договор">
            <div className="crm-grid crm-grid-6">
              <Field label="КП: ссылка и версия" span={4} {...req('proposalLink')}>
                <TextIn value={deal.proposalLink} onChange={(v) => set({ proposalLink: v })} placeholder="https://… v2" />
              </Field>
              <Field label="Дата отправки КП" span={2}>
                <DateIn value={deal.proposalDate} onChange={(v) => set({ proposalDate: v })} />
              </Field>
              <Field label="Статус договора" span={2}>
                <SelectIn value={deal.contractStatus} onChange={(v) => set({ contractStatus: v })} options={CONTRACT_STATUSES} />
              </Field>
              <Field label="Сумма заказа, ₽" span={2} {...req('orderAmount')}>
                <MoneyIn value={deal.orderAmount} onChange={(v) => set({ orderAmount: v })} />
              </Field>
              <Field label="Дата выигрыша / проигрыша" span={2}>
                <DateIn value={deal.closedDate} onChange={(v) => set({ closedDate: v })} />
              </Field>
            </div>
          </Panel>

          <Panel title="Оплата" hint={left !== undefined && left > 0 ? `Осталось получить ${fmtMoney(left)}` : undefined}>
            <div className="crm-grid crm-grid-6">
              <Field label="Статус оплаты" span={2}>
                <SelectIn value={deal.paymentStatus} onChange={(v) => set({ paymentStatus: v })} options={PAYMENT_STATUSES} />
              </Field>
              <Field label="Получено всего, ₽" span={2} hint="Сколько получено всего, а не последний платёж. Платёж — запись «Оплата» в истории">
                <MoneyIn value={deal.paidTotal} onChange={(v) => set({ paidTotal: v })} />
              </Field>
              <Field label="Дата последней оплаты" span={2}>
                <DateIn value={deal.lastPaymentDate} onChange={(v) => set({ lastPaymentDate: v })} />
              </Field>
            </div>
          </Panel>

          <Panel title="Итог и проверка данных">
            <div className="crm-grid crm-grid-6">
              <Field label="Причина проигрыша / паузы" wide {...req('lossReason')}>
                <TextIn value={deal.lossReason} onChange={(v) => set({ lossReason: v })} placeholder="Заполняется, если сделка проиграна или на паузе" />
              </Field>
              <Field label="Основание / ссылка" span={4} {...req('basis')}>
                <TextIn value={deal.basis} onChange={(v) => set({ basis: v })} placeholder="Договор, письмо, ссылка" />
              </Field>
              <Field label="Актуальность данных" span={2} hint="Неизвестное не угадывайте — «Требует уточнения»">
                <SelectIn value={deal.quality} onChange={(v) => set({ quality: v })} options={QUALITY} empty="Не проверено" />
              </Field>
            </div>
          </Panel>

          <Panel
            title="Задачи и история"
            action={
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => onNewRecord({ dealId: deal.id, type: 'call', status: 'done', ownerId: deal.ownerId ?? store.identity?.id })}
              >
                + Запись
              </button>
            }
          >
            <HistoryList records={records} onOpen={onOpenRecord} />
          </Panel>

          <div className="crm-modal-foot">
            <button type="button" className="btn btn-danger" onClick={remove}>
              Удалить сделку
            </button>
            <span className="muted">Изменения сохраняются сами</span>
          </div>
        </div>
        <DealCommentsPanel deal={deal} />
      </div>
    </ModalShell>
  )
}

// ---------- Карточка компании ----------

export function CompanyModal({
  companyId,
  onClose,
  onOpenDeal,
  onOpenContact,
  onNewContact,
  onOpenRecord,
  onNewRecord,
}: {
  companyId: ID
  onClose: () => void
  onOpenDeal: (id: ID) => void
  onOpenContact: (id: ID) => void
  onNewContact: (companyId: ID) => void
  onOpenRecord: (r: CrmRecord) => void
  onNewRecord: (init: Partial<CrmRecord>) => void
}) {
  const store = useBoard()
  const p = store.partner(companyId)
  useEffect(() => {
    if (!p) onClose()
  }, [p, onClose])
  if (!p) return null
  const set = (patch: Partial<Partner>) => store.updatePartner(p.id, patch)
  const kind = companyKind(p)
  const deals = store.deals.filter((d) => d.partnerId === p.id)
  const contacts = store.contacts.filter((c) => c.companyId === p.id)
  const records = store.crmRecords.filter((r) => r.partnerId === p.id)

  const remove = () => {
    if (confirm(`Удалить компанию «${p.name || 'без названия'}»? Сделки и контакты останутся, но без ссылки на компанию.`)) {
      store.deletePartner(p.id)
      onClose()
    }
  }

  return (
    <ModalShell onClose={onClose}>
      <Head title={p.name || 'Новая компания'} sub={labelOf(COMPANY_KINDS, kind)} onClose={onClose}>
        <ControlBadge c={partnerControl(p, todayKey())} title="Контроль" />
      </Head>
      <div className="crm-modal-body">
        <Panel title="Компания">
          <div className="crm-grid">
            <Field label="Название">
              <TextIn value={p.name} onChange={(v) => set({ name: v })} />
            </Field>
            <Field label="Тип">
              <SelectIn<CompanyKind> value={kind} onChange={(v) => set({ kind: v ?? 'client' })} options={COMPANY_KINDS} empty={false} />
            </Field>
            <Field label="Ответственный">
              <MemberIn value={p.ownerId} onChange={(v) => set({ ownerId: v })} projectId={p.projectId} />
            </Field>
            {store.projects.length > 0 && (
              <Field label="Проект">
                <ProjectIn value={p.projectId} onChange={(v) => set({ projectId: v })} />
              </Field>
            )}
            <Field label="Заметка" wide>
              <TextIn value={p.note} onChange={(v) => set({ note: v })} placeholder="Реквизиты, особенности работы, кто принимает решения" multiline />
            </Field>
          </div>
        </Panel>

        <Panel
          title="Контакты"
          action={
            <button type="button" className="btn btn-sm" onClick={() => onNewContact(p.id)}>
              + Контакт
            </button>
          }
        >
          {contacts.length === 0 ? (
            <div className="muted crm-empty-line">Контактов пока нет.</div>
          ) : (
            <ul className="crm-history">
              {contacts.map((c) => (
                <li key={c.id}>
                  <button type="button" className="crm-history-row" onClick={() => onOpenContact(c.id)}>
                    <span className="crm-history-main">
                      <span className="crm-history-result">{c.name || 'Без имени'}</span>
                      {c.role && <span className="crm-history-next">{c.role}</span>}
                    </span>
                    <span className="crm-history-date">{[c.phone, c.email].filter(Boolean).join(' · ')}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {kind === 'partner' && (
          <Panel title="Партнёрство" accent hint="Не увеличивает сумму воронки">
            <div className="crm-grid">
              <Field label="Статус">
                <SelectIn value={p.status} onChange={(v) => set({ status: v ?? 'contact' })} options={PARTNER_STATUSES} empty={false} />
              </Field>
              <Field label="Формат сотрудничества">
                <TextIn value={p.format} onChange={(v) => set({ format: v })} placeholder="Агентская схема, совместные проекты…" />
              </Field>
              {p.contact && (
                <Field label="Контакт / связь" wide>
                  <TextIn value={p.contact} onChange={(v) => set({ contact: v })} multiline />
                </Field>
              )}
              <Field label="Подтверждённые договорённости" wide>
                <TextIn value={p.agreements} onChange={(v) => set({ agreements: v })} multiline />
              </Field>
              <Field label="Следующий шаг" wide>
                <TextIn value={p.nextStep} onChange={(v) => set({ nextStep: v })} />
              </Field>
              <Field label="Срок шага">
                <DateIn value={p.nextStepDate} onChange={(v) => set({ nextStepDate: v })} />
              </Field>
              <Field label="Последний контакт">
                <DateIn value={p.lastContactDate} onChange={(v) => set({ lastContactDate: v })} />
              </Field>
              <Field label="Блокер / решение" wide>
                <TextIn value={p.blocker} onChange={(v) => set({ blocker: v })} />
              </Field>
              <Field label="Основание / ссылка">
                <TextIn value={p.basis} onChange={(v) => set({ basis: v })} />
              </Field>
              <Field label="Актуальность данных">
                <SelectIn value={p.quality} onChange={(v) => set({ quality: v })} options={QUALITY} empty="Не проверено" />
              </Field>
            </div>
          </Panel>
        )}

        <Panel title="Сделки компании">
          <DealList deals={deals} onOpen={onOpenDeal} empty="Сделок пока нет — выберите компанию в поле «Компания / агентство» у сделки." />
        </Panel>

        <Panel
          title="Задачи и история"
          action={
            <button type="button" className="btn btn-sm" onClick={() => onNewRecord({ partnerId: p.id, type: 'call', status: 'done', ownerId: p.ownerId ?? store.identity?.id })}>
              + Запись
            </button>
          }
        >
          <HistoryList records={records} onOpen={onOpenRecord} />
        </Panel>

        <div className="crm-modal-foot">
          <button type="button" className="btn btn-danger" onClick={remove}>
            Удалить компанию
          </button>
          <span className="muted">Изменения сохраняются сами</span>
        </div>
      </div>
    </ModalShell>
  )
}

// ---------- Карточка контакта ----------

export function ContactModal({ contactId, onClose, onOpenDeal, onOpenCompany }: { contactId: ID; onClose: () => void; onOpenDeal: (id: ID) => void; onOpenCompany: (id: ID) => void }) {
  const store = useBoard()
  const c = store.contact(contactId)
  useEffect(() => {
    if (!c) onClose()
  }, [c, onClose])
  if (!c) return null
  const set = (patch: Partial<Contact>) => store.updateContact(c.id, patch)
  const company = c.companyId ? store.partner(c.companyId) : undefined
  const deals = store.deals.filter((d) => d.contactId === c.id)

  const remove = () => {
    if (confirm(`Удалить контакт «${c.name || 'без имени'}»? В сделках останется только имя.`)) {
      store.deleteContact(c.id)
      onClose()
    }
  }

  return (
    <ModalShell onClose={onClose} className="crm-contact-modal">
      <Head title={c.name || 'Новый контакт'} sub={[c.role, company?.name].filter(Boolean).join(' · ') || 'Контакт'} onClose={onClose} />
      <div className="crm-modal-body">
        <Panel title="Контакт">
          <div className="crm-grid">
            <Field label="Имя">
              <TextIn value={c.name} onChange={(v) => set({ name: v })} placeholder="Имя и фамилия" />
            </Field>
            <Field label="Должность / роль">
              <TextIn value={c.role} onChange={(v) => set({ role: v })} />
            </Field>
            <Field label="Телефон">
              <TextIn type="tel" value={c.phone} onChange={(v) => set({ phone: v })} placeholder="+7 …" />
            </Field>
            <Field label="Email">
              <TextIn type="email" value={c.email} onChange={(v) => set({ email: v })} placeholder="mail@company.ru" />
            </Field>
            <Field label="Компания">
              <SelectIn
                value={c.companyId}
                onChange={(v) => set({ companyId: v })}
                options={store.partners.map((p) => ({ key: p.id, label: p.name || 'Без названия' }))}
                empty="Без компании"
              />
            </Field>
            {store.projects.length > 0 && (
              <Field label="Проект">
                <ProjectIn value={c.projectId} onChange={(v) => set({ projectId: v })} />
              </Field>
            )}
            <Field label="Заметка" wide>
              <TextIn value={c.note} onChange={(v) => set({ note: v })} multiline />
            </Field>
          </div>
          {company && (
            <button type="button" className="crm-link crm-contact-company" onClick={() => onOpenCompany(company.id)}>
              Открыть компанию «{company.name}» →
            </button>
          )}
        </Panel>

        <Panel title="Сделки">
          <DealList deals={deals} onOpen={onOpenDeal} empty="Сделок с этим контактом пока нет." />
        </Panel>

        <div className="crm-modal-foot">
          <button type="button" className="btn btn-danger" onClick={remove}>
            Удалить контакт
          </button>
          <span className="muted">Изменения сохраняются сами</span>
        </div>
      </div>
    </ModalShell>
  )
}

// ---------- Запись «Задачи и история» ----------

/** record — существующая запись; иначе init — заготовка новой (создаётся по «Сохранить»). */
export function RecordModal({ record, init, onClose }: { record?: CrmRecord; init?: Partial<CrmRecord>; onClose: () => void }) {
  const store = useBoard()
  const base: Partial<CrmRecord> = record ?? { date: todayKey(), type: 'call', status: 'done', ...init }
  const [f, setF] = useState<Partial<CrmRecord>>(base)
  const upd = (patch: Partial<CrmRecord>) => setF((x) => ({ ...x, ...patch }))
  const isStage = f.type === 'stage'

  // Связь: сделка или компания — одно поле «deal:<id>» / «partner:<id>»
  const link = f.dealId ? `deal:${f.dealId}` : f.partnerId ? `partner:${f.partnerId}` : ''
  const setLink = (v: string) => {
    const [kind, id] = v.split(':')
    upd({ dealId: kind === 'deal' ? id : undefined, partnerId: kind === 'partner' ? id : undefined })
  }

  const save = () => {
    const patch: Partial<CrmRecord> = { ...f, date: f.date || todayKey() }
    if (record) store.updateCrmRecord(record.id, patch)
    else store.addCrmRecord(patch)
    onClose()
  }
  const remove = () => {
    if (record && confirm('Удалить запись?')) {
      store.deleteCrmRecord(record.id)
      onClose()
    }
  }

  return (
    <ModalShell onClose={onClose} className="crm-record-modal">
      <Head title={record ? 'Запись' : 'Новая запись'} sub="Задачи и история" onClose={onClose} />
      <div className="crm-modal-body">
        <div className="crm-grid">
          <Field label="Сделка / компания" wide>
            <select className="input" value={link} onChange={(e) => setLink(e.target.value)}>
              <option value="">Без привязки</option>
              {store.deals.length > 0 && (
                <optgroup label="Сделки">
                  {store.deals.map((d) => (
                    <option key={d.id} value={`deal:${d.id}`}>
                      {[d.company || 'Без названия', d.event].filter(Boolean).join(' · ')}
                    </option>
                  ))}
                </optgroup>
              )}
              {store.partners.length > 0 && (
                <optgroup label="Компании">
                  {store.partners.map((p) => (
                    <option key={p.id} value={`partner:${p.id}`}>
                      {p.name || 'Без названия'}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </Field>
          <Field label="Дата записи / контакта">
            <DateIn value={f.date} onChange={(v) => upd({ date: v })} />
          </Field>
          <Field label="Тип записи">
            <SelectIn<CrmRecordType> value={f.type} onChange={(v) => upd({ type: v ?? 'other' })} options={RECORD_TYPES} empty={false} />
          </Field>
          <Field label="Итог / подтверждённый факт" wide>
            <TextIn value={f.result} onChange={(v) => upd({ result: v })} multiline placeholder={isStage ? 'Новый контакт → Контакт установлен' : 'Что произошло'} />
          </Field>
          <Field label="Следующее действие" wide>
            <TextIn value={f.nextAction} onChange={(v) => upd({ nextAction: v })} placeholder="Что сделать дальше" />
          </Field>
          <Field label="Ответственный">
            <MemberIn value={f.ownerId} onChange={(v) => upd({ ownerId: v })} />
          </Field>
          <Field label="Срок">
            <DateIn value={f.due} onChange={(v) => upd({ due: v })} />
          </Field>
          <Field label="Статус">
            <SelectIn<CrmTaskStatus> value={f.status} onChange={(v) => upd({ status: v ?? 'planned' })} options={TASK_STATUSES} empty={false} />
          </Field>
          <Field label="Выполнено, дата">
            <DateIn value={f.doneDate} onChange={(v) => upd({ doneDate: v })} />
          </Field>
        </div>
        <div className="crm-modal-foot">
          {record && (
            <button type="button" className="btn btn-danger" onClick={remove}>
              Удалить
            </button>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button type="button" className="btn" onClick={onClose}>
              Отмена
            </button>
            <button type="button" className="btn btn-primary" onClick={save}>
              Сохранить
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  )
}
