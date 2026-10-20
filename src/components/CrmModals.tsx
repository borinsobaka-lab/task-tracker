// Окна CRM: карточка сделки (все поля листа «Сделки» на подложках по смыслу,
// её история и задачи, справа — комментарии), карточка партнёра и редактор записи
// «Задачи и история». Сделка и партнёр сохраняются по ходу ввода; запись истории —
// кнопкой «Сохранить».

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useBoard } from '../store'
import type { CrmRecord, CrmRecordType, CrmTaskStatus, Deal, DealStage, ID, Partner } from '../types'
import {
  CONTRACT_STATUSES,
  CRM_STAGES,
  decisionControl,
  duplicateCodes,
  fmtDate,
  fmtMoney,
  labelOf,
  LEAD_SOURCES,
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
import type { Control } from '../crm'
import { toDateKey } from '../utils'
import { SheetGrabber } from './SheetGrabber'
import { DealCommentsPanel } from './Comments'
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

/** span — ширина в колонках шестиколоночной сетки (.crm-grid-6): 2 — треть, 3 — половина, 4 — две трети */
function Field({ label, wide, span, children }: { label: string; wide?: boolean; span?: 2 | 3 | 4; children: ReactNode }) {
  return (
    <label className={'crm-field' + (wide ? ' wide' : '') + (span ? ` s${span}` : '')}>
      <span className="crm-field-label">{label}</span>
      {children}
    </label>
  )
}

function TextIn({ value, onChange, placeholder, multiline }: { value: string | undefined; onChange: (v: string) => void; placeholder?: string; multiline?: boolean }) {
  return multiline ? (
    <textarea className="input crm-textarea" rows={2} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  ) : (
    <input className="input" value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  )
}

function DateIn({ value, onChange }: { value: string | undefined; onChange: (v: string) => void }) {
  return <input className="input" type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
}

/** Сумма: пустое поле — «не знаем», 0 — настоящий ноль. Пока поле в фокусе, держим набранный текст. */
function MoneyIn({ value, onChange }: { value: number | undefined; onChange: (v: number | undefined) => void }) {
  const [text, setText] = useState(value === undefined ? '' : String(value))
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setText(value === undefined ? '' : String(value))
  }, [value])
  return (
    <input
      className="input"
      inputMode="decimal"
      placeholder="₽"
      value={text}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false
        setText(value === undefined ? '' : String(value))
      }}
      onChange={(e) => {
        setText(e.target.value)
        onChange(parseMoney(e.target.value))
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

function MemberIn({ value, onChange }: { value: ID | undefined; onChange: (v: ID | undefined) => void }) {
  const store = useBoard()
  const opts = store.members.map((m) => ({ key: m.id, label: m.name }))
  // Ответственный в архиве — показываем его, чтобы поле не выглядело пустым
  if (value && !opts.some((o) => o.key === value)) {
    const m = store.data.members.find((x) => x.id === value)
    if (m) opts.push({ key: m.id, label: `${m.name} (в архиве)` })
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

/** Список записей истории (в карточке сделки и партнёра) */
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

// ---------- Карточка сделки ----------

export function DealModal({
  dealId,
  onClose,
  onOpenRecord,
  onNewRecord,
}: {
  dealId: ID
  onClose: () => void
  onOpenRecord: (r: CrmRecord) => void
  onNewRecord: (init: Partial<CrmRecord>) => void
}) {
  const store = useBoard()
  const deal = store.deal(dealId)
  useEffect(() => {
    if (!deal) onClose() // удалили (в том числе на другом устройстве)
  }, [deal, onClose])
  if (!deal) return null

  const today = todayKey()
  const set = (patch: Partial<Deal>) => store.updateDeal(deal.id, patch)
  const issue = recordIssue(deal, duplicateCodes(store.deals))
  const records = store.crmRecords.filter((r) => r.dealId === deal.id)
  const stage = STAGE_BY_KEY[deal.stage]

  const remove = () => {
    if (confirm(`Удалить сделку «${deal.company || 'без названия'}» вместе с её историей?`)) {
      store.deleteDeal(deal.id)
      onClose()
    }
  }

  const hasProjects = store.projects.length > 0
  const left = deal.orderAmount !== undefined && deal.paidTotal !== undefined ? deal.orderAmount - deal.paidTotal : undefined

  return (
    <ModalShell onClose={onClose} className="crm-deal-modal">
      <Head title={deal.company || 'Новая сделка'} sub={[deal.code, deal.event].filter(Boolean).join(' · ') || 'Сделка'} onClose={onClose}>
        <select
          className="input crm-stage-select"
          style={{ ['--stage' as string]: stage.color }}
          value={deal.stage}
          onChange={(e) => set({ stage: e.target.value as DealStage })}
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
        <div className="crm-modal-body crm-deal-main">
          <div className="crm-controls">
            <ControlBadge c={stepControl(deal, today)} title="Контроль шага" />
            <ControlBadge c={decisionControl(deal, today)} title="Контроль решения" />
            {issue ? <ControlBadge c={{ label: issue, tone: 'warn' }} title="Контроль записи" /> : <ControlBadge c={{ label: 'Запись в порядке', tone: 'ok' }} title="Контроль записи" />}
            <span className="crm-criterion muted">{stage.criterion}</span>
          </div>

          <Panel title="Сделка">
            <div className="crm-grid crm-grid-6">
              <Field label="Компания / агентство" span={3}>
                <TextIn value={deal.company} onChange={(v) => set({ company: v })} placeholder="Например: МТС" />
              </Field>
              <Field label="Мероприятие" span={3}>
                <TextIn value={deal.event} onChange={(v) => set({ event: v })} placeholder="Конференция 27.11.26" />
              </Field>
              <Field label="ID сделки" span={2}>
                <TextIn value={deal.code} onChange={(v) => set({ code: v })} placeholder="А-1-10.26" />
              </Field>
              <Field label="Сумма предложения, ₽" span={2}>
                <MoneyIn value={deal.amount} onChange={(v) => set({ amount: v })} />
              </Field>
              <Field label="Ответственный" span={2}>
                <MemberIn value={deal.ownerId} onChange={(v) => set({ ownerId: v })} />
              </Field>
              {hasProjects && (
                <Field label="Проект" span={2}>
                  <ProjectIn value={deal.projectId} onChange={(v) => set({ projectId: v })} />
                </Field>
              )}
              <Field label="Источник лида" span={hasProjects ? 2 : 3}>
                <SelectIn value={deal.source} onChange={(v) => set({ source: v })} options={LEAD_SOURCES} />
              </Field>
              <Field label="Партнёр" span={hasProjects ? 2 : 3}>
                <SelectIn
                  value={deal.partnerId}
                  onChange={(v) => set({ partnerId: v })}
                  options={store.partners.map((p) => ({ key: p.id, label: p.name || 'Без названия' }))}
                  empty="Без партнёра"
                />
              </Field>
            </div>
          </Panel>

          <Panel title="Следующий шаг" accent>
            <div className="crm-grid crm-grid-6">
              <Field label="Что делаем дальше" wide>
                <TextIn value={deal.nextStep} onChange={(v) => set({ nextStep: v })} placeholder="Согласовать условия" />
              </Field>
              <Field label={deal.stage === 'paused' ? 'Дата возврата' : 'Срок шага'} span={2}>
                <DateIn value={deal.nextStepDate} onChange={(v) => set({ nextStepDate: v })} />
              </Field>
              <Field label="Решение клиента до" span={2}>
                <DateIn value={deal.decisionDate} onChange={(v) => set({ decisionDate: v })} />
              </Field>
              <Field label="Последний контакт" span={2}>
                <DateIn value={deal.lastContactDate} onChange={(v) => set({ lastContactDate: v })} />
              </Field>
              <Field label="Подтверждённый итог" span={3}>
                <TextIn value={deal.outcome} onChange={(v) => set({ outcome: v })} placeholder="Что точно известно после последнего контакта" multiline />
              </Field>
              <Field label="Блокер / нужное решение руководителя" span={3}>
                <TextIn value={deal.blocker} onChange={(v) => set({ blocker: v })} placeholder="нет" multiline />
              </Field>
            </div>
          </Panel>

          <Panel title="Клиент и мероприятие">
            <div className="crm-grid crm-grid-6">
              <Field label="Контактное лицо / роль" span={3}>
                <TextIn value={deal.contactName} onChange={(v) => set({ contactName: v })} placeholder="Имя, должность" />
              </Field>
              <Field label="Телефон / email" span={3}>
                <TextIn value={deal.contactInfo} onChange={(v) => set({ contactInfo: v })} placeholder="+7 … / mail@…" multiline />
              </Field>
              <Field label="Дата мероприятия" span={3}>
                <DateIn value={deal.eventDate} onChange={(v) => set({ eventDate: v })} />
              </Field>
              <Field label="Участники, чел." span={3}>
                <TextIn value={deal.attendees} onChange={(v) => set({ attendees: v })} placeholder="до 1000" />
              </Field>
              <Field label="Потребность / модули" wide>
                <TextIn value={deal.needs} onChange={(v) => set({ needs: v })} placeholder="Что нужно клиенту" multiline />
              </Field>
            </div>
          </Panel>

          <Panel title="КП и договор">
            <div className="crm-grid crm-grid-6">
              <Field label="КП: ссылка и версия" span={4}>
                <TextIn value={deal.proposalLink} onChange={(v) => set({ proposalLink: v })} placeholder="https://… v2" />
              </Field>
              <Field label="Дата отправки КП" span={2}>
                <DateIn value={deal.proposalDate} onChange={(v) => set({ proposalDate: v })} />
              </Field>
              <Field label="Статус договора" span={2}>
                <SelectIn value={deal.contractStatus} onChange={(v) => set({ contractStatus: v })} options={CONTRACT_STATUSES} />
              </Field>
              <Field label="Сумма заказа, ₽" span={2}>
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
              <Field label="Получено всего, ₽" span={2}>
                <MoneyIn value={deal.paidTotal} onChange={(v) => set({ paidTotal: v })} />
              </Field>
              <Field label="Дата последней оплаты" span={2}>
                <DateIn value={deal.lastPaymentDate} onChange={(v) => set({ lastPaymentDate: v })} />
              </Field>
            </div>
          </Panel>

          <Panel title="Итог и проверка данных">
            <div className="crm-grid crm-grid-6">
              <Field label="Причина проигрыша / паузы" wide>
                <TextIn value={deal.lossReason} onChange={(v) => set({ lossReason: v })} placeholder="Заполняется, если сделка проиграна или на паузе" />
              </Field>
              <Field label="Основание / ссылка" span={4}>
                <TextIn value={deal.basis} onChange={(v) => set({ basis: v })} placeholder="Договор, письмо, ссылка" />
              </Field>
              <Field label="Актуальность данных" span={2}>
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

// ---------- Карточка партнёра ----------

export function PartnerModal({
  partnerId,
  onClose,
  onOpenDeal,
  onOpenRecord,
  onNewRecord,
}: {
  partnerId: ID
  onClose: () => void
  onOpenDeal: (id: ID) => void
  onOpenRecord: (r: CrmRecord) => void
  onNewRecord: (init: Partial<CrmRecord>) => void
}) {
  const store = useBoard()
  const p = store.partner(partnerId)
  useEffect(() => {
    if (!p) onClose()
  }, [p, onClose])
  if (!p) return null
  const set = (patch: Partial<Partner>) => store.updatePartner(p.id, patch)
  const deals = store.deals.filter((d) => d.partnerId === p.id)
  const records = store.crmRecords.filter((r) => r.partnerId === p.id)

  const remove = () => {
    if (confirm(`Удалить партнёра «${p.name || 'без названия'}»? Сделки останутся, но без ссылки на партнёра.`)) {
      store.deletePartner(p.id)
      onClose()
    }
  }

  return (
    <ModalShell onClose={onClose}>
      <Head title={p.name || 'Новый партнёр'} sub={p.code || 'Партнёр'} onClose={onClose}>
        <ControlBadge c={partnerControl(p, todayKey())} title="Контроль" />
      </Head>
      <div className="crm-modal-body">
        <p className="muted crm-hint">Партнёрство не увеличивает сумму воронки. Коммерческие проекты заводите сделками со ссылкой на партнёра.</p>
        <Panel title="Партнёр">
          <div className="crm-grid">
            <Field label="Компания / партнёр">
              <TextIn value={p.name} onChange={(v) => set({ name: v })} />
            </Field>
            <Field label="ID партнёра">
              <TextIn value={p.code} onChange={(v) => set({ code: v })} placeholder="PT-0001" />
            </Field>
            <Field label="Статус">
              <SelectIn value={p.status} onChange={(v) => set({ status: v ?? 'contact' })} options={PARTNER_STATUSES} empty={false} />
            </Field>
            <Field label="Формат сотрудничества">
              <TextIn value={p.format} onChange={(v) => set({ format: v })} placeholder="Агентская схема, совместные проекты…" />
            </Field>
            <Field label="Контакт / связь">
              <TextIn value={p.contact} onChange={(v) => set({ contact: v })} multiline />
            </Field>
            <Field label="Ответственный">
              <MemberIn value={p.ownerId} onChange={(v) => set({ ownerId: v })} />
            </Field>
            {store.projects.length > 0 && (
              <Field label="Проект">
                <ProjectIn value={p.projectId} onChange={(v) => set({ projectId: v })} />
              </Field>
            )}
          </div>
        </Panel>

        <Panel title="Следующий шаг" accent>
          <div className="crm-grid">
            <Field label="Что делаем дальше" wide>
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
          </div>
        </Panel>

        <Panel title="Договорённости и проверка данных">
          <div className="crm-grid">
            <Field label="Подтверждённые договорённости" wide>
              <TextIn value={p.agreements} onChange={(v) => set({ agreements: v })} multiline />
            </Field>
            <Field label="Основание / ссылка">
              <TextIn value={p.basis} onChange={(v) => set({ basis: v })} />
            </Field>
            <Field label="Актуальность данных">
              <SelectIn value={p.quality} onChange={(v) => set({ quality: v })} options={QUALITY} empty="Не проверено" />
            </Field>
          </div>
        </Panel>

        <Panel title="Сделки партнёра">
          {deals.length === 0 ? (
            <div className="muted crm-empty-line">Сделок с этим партнёром пока нет — выберите его в поле «Партнёр» у сделки.</div>
          ) : (
            <ul className="crm-history">
              {deals.map((d) => (
                <li key={d.id}>
                  <button type="button" className="crm-history-row" onClick={() => onOpenDeal(d.id)}>
                    <span className="crm-stage-dot" style={{ background: STAGE_BY_KEY[d.stage].color }} />
                    <span className="crm-history-main">
                      <span className="crm-history-result">{d.company || 'Без названия'}</span>
                      <span className="crm-history-next">{[STAGE_BY_KEY[d.stage].label, d.event].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="crm-history-date">{fmtMoney(d.amount)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
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
            Удалить партнёра
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

  // Связь: сделка или партнёр — одно поле «deal:<id>» / «partner:<id>»
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
          <Field label="Сделка / партнёр" wide>
            <select className="input" value={link} onChange={(e) => setLink(e.target.value)}>
              <option value="">Без привязки</option>
              {store.deals.length > 0 && (
                <optgroup label="Сделки">
                  {store.deals.map((d) => (
                    <option key={d.id} value={`deal:${d.id}`}>
                      {[d.code, d.company || 'Без названия', d.event].filter(Boolean).join(' · ')}
                    </option>
                  ))}
                </optgroup>
              )}
              {store.partners.length > 0 && (
                <optgroup label="Партнёры">
                  {store.partners.map((p) => (
                    <option key={p.id} value={`partner:${p.id}`}>
                      {[p.code, p.name || 'Без названия'].filter(Boolean).join(' · ')}
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
