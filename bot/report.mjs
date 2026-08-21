// Telegram-бот отчётов по задачам.
// Запускается из GitHub Actions по расписанию (время — Тбилиси, UTC+4):
//   MODE=morning  — утренний список задач на сегодня (10:00)
//   MODE=evening  — вечерний итог дня + задачи на завтра (20:00)
//   MODE=refresh  — обновляет (редактирует) утреннее сообщение под текущие статусы
//
// Читает board.json из ПРИВАТНОГО репозитория данных (DATA_TOKEN),
// хранит id сообщений в bot-state.json в ПУБЛИЧНОМ репозитории (STATE_TOKEN),
// шлёт/редактирует сообщения через Telegram Bot API.

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '5360181823'
const DATA_TOKEN = process.env.DATA_TOKEN || ''
const STATE_TOKEN = process.env.STATE_TOKEN || ''
const MODE = process.env.MODE || 'morning'
const TZ = process.env.TZ_NAME || 'Asia/Tbilisi'
const APP_URL = process.env.APP_URL || 'https://borinsobaka-lab.github.io/task-tracker/'
// Кнопка под каждым сообщением бота — переход в сервис
const OPEN_BUTTON = { inline_keyboard: [[{ text: '📋 Открыть задачи', url: APP_URL }]] }

const DATA = {
  owner: process.env.DATA_OWNER || 'borinsobaka-lab',
  repo: process.env.DATA_REPO || 'task-tracker-data',
  branch: process.env.DATA_BRANCH || 'tasks-data',
  path: 'board.json',
}
const [stateOwner, stateRepo] = (process.env.GH_REPO || 'borinsobaka-lab/task-tracker').split('/')
const STATE = { owner: stateOwner, repo: stateRepo, branch: 'app-config', path: 'bot-state.json' }

const EMOJI = { todo: '⬜', doing: '🔧', review: '👀', done: '✅' }
const STATUS_LABEL = { todo: 'нужно сделать', doing: 'в работе', review: 'на проверке', done: 'готово' }
const HR = '➖➖➖➖➖➖➖➖➖➖' // горизонтальный разделитель перед легендой

// ---------- Мелкие утилиты ----------

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 'YYYY-MM-DD' в нужном часовом поясе, со сдвигом на offsetDays суток */
function dateKey(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}
function ddmm(key) {
  const [, m, d] = key.split('-')
  return `${d}.${m}`
}

// ---------- GitHub Contents API ----------

async function ghGet(repo, token) {
  const res = await fetch(
    `https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${encodeURIComponent(repo.path)}?ref=${encodeURIComponent(repo.branch)}`,
    { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' }, cache: 'no-store' },
  )
  if (res.status === 404) return { json: null, sha: null }
  if (!res.ok) throw new Error(`GET ${repo.repo}/${repo.path}: ${res.status} ${await res.text()}`)
  const file = await res.json()
  const content = Buffer.from(file.content, 'base64').toString('utf8')
  return { json: JSON.parse(content), sha: file.sha }
}

async function ghPut(repo, token, obj, sha) {
  const res = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${encodeURIComponent(repo.path)}`, {
    method: 'PUT',
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Обновление состояния Telegram-бота',
      content: Buffer.from(JSON.stringify(obj, null, 2), 'utf8').toString('base64'),
      branch: repo.branch,
      ...(sha ? { sha } : {}),
    }),
  })
  if (!res.ok) throw new Error(`PUT ${repo.repo}/${repo.path}: ${res.status} ${await res.text()}`)
}

// ---------- Telegram Bot API ----------

async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok && data.ok, data }
}

async function sendMessage(text) {
  const r = await tg('sendMessage', {
    chat_id: CHAT_ID,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: OPEN_BUTTON,
  })
  if (!r.ok) throw new Error(`sendMessage: ${JSON.stringify(r.data)}`)
  return r.data.result.message_id
}

async function editMessage(messageId, text) {
  const r = await tg('editMessageText', {
    chat_id: CHAT_ID,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: OPEN_BUTTON,
  })
  if (!r.ok) {
    const desc = r.data?.description || ''
    if (desc.includes('message is not modified')) return // содержимое не изменилось — это нормально
    if (desc.includes('message to edit not found')) return // сообщение удалили вручную
    throw new Error(`editMessageText: ${JSON.stringify(r.data)}`)
  }
}

// ---------- Логика статусов и отчётов ----------

function buildIndex(board) {
  const colById = new Map((board.columns || []).filter((c) => !c.deleted).map((c) => [c.id, c]))
  const members = (board.members || []).filter((m) => !m.archived)
  return { colById, members }
}

function statusOf(card, colById) {
  if (card.done) return 'done'
  const col = colById.get(card.columnId)
  if (col?.role) return col.role
  const t = (col?.title || '').toLowerCase()
  if (/готов|done|выполн|заверш/.test(t)) return 'done'
  if (/провер|review|ревью|контрол/.test(t)) return 'review'
  if (/работ|progress|делаю|doing|процесс/.test(t)) return 'doing'
  return 'todo'
}

function cardsForDate(board, key) {
  return Object.values(board.cards || {}).filter((c) => c && !c.deleted && c.date === key)
}

/** Просроченные задачи — те же, что календарь закрепляет сверху текущего дня:
 *  срок (дата окончания) уже прошёл, а задача не выполнена. Встречи не берём —
 *  пропущенную встречу «доделать» нельзя. keepIds — карточки из утреннего
 *  сообщения: их оставляем, даже если за день их доделали (зачёркнутыми). */
export function overdueCards(board, todayKey, keepIds) {
  const { colById } = buildIndex(board)
  const keep = new Set(keepIds || [])
  return Object.values(board.cards || {})
    .filter(
      (c) =>
        c &&
        !c.deleted &&
        !!c.date &&
        (c.endDate || c.date) < todayKey &&
        c.kind !== 'meeting' &&
        (statusOf(c, colById) !== 'done' || keep.has(c.id)),
    )
    .sort(byDate)
}

/** «дд.мм» или «дд.мм–дд.мм» для многодневной задачи. */
function cardDateLabel(card) {
  const end = card.endDate && card.endDate !== card.date ? `–${ddmm(card.endDate)}` : ''
  return `${ddmm(card.date)}${end}`
}

/** opts.showDate — печатать дату карточки перед названием (для просроченных,
 *  которые пришли с разных прошлых дней). */
function fmtCardLine(card, colById, opts) {
  const st = statusOf(card, colById)
  const date = opts && opts.showDate && card.date ? `<b>${cardDateLabel(card)}</b> ` : ''
  const time = card.start ? `${card.start} ` : ''
  const meeting = card.kind === 'meeting' ? '📹 ' : ''
  let title = esc(card.title || 'Без названия')
  if (st === 'done') title = `<s>${title}</s>`
  let extra = ''
  if (card.kind === 'meeting' && card.meetingUrl) extra = ` — <a href="${esc(card.meetingUrl)}">ссылка</a>`
  return `${EMOJI[st]} ${date}${time}${meeting}${title}${extra}`
}

/** Ник в Telegram → упоминание "@ник" (добавляем @, если пользователь его не поставил). */
function tgHandle(raw) {
  const n = String(raw || '').trim()
  if (!n) return ''
  return n.startsWith('@') ? n : '@' + n
}

/** Заголовок группы: «👤 Имя (@ник)» — эмодзи-человечек, чтобы людей было лучше видно. */
function groupHeader(g) {
  const handle = tgHandle(g.nick)
  const icon = g.isMember ? '👤 ' : '📭 '
  return `${icon}<b>${esc(g.name)}</b>${handle ? ` (${esc(handle)})` : ''}`
}

/** Хронологический порядок: задачи без времени сверху, затем по времени начала. */
function byTime(a, b) {
  const as = a.start || ''
  const bs = b.start || ''
  if (as && bs) return as.localeCompare(bs) || (a.title || '').localeCompare(b.title || '', 'ru')
  if (!as && !bs) return (a.title || '').localeCompare(b.title || '', 'ru')
  return as ? 1 : -1 // задачи «на весь день» (без времени) — выше
}

/** Просроченные: сначала самые давние (их забыли раньше всех), внутри дня — по времени. */
function byDate(a, b) {
  return (a.date || '').localeCompare(b.date || '') || byTime(a, b)
}

/** Группирует карточки по исполнителям (+ группа «Без исполнителя»), каждую по времени. */
function groupByMember(cards, members, cmp = byTime) {
  const groups = []
  for (const m of members) {
    const list = cards.filter((c) => (c.assigneeIds || []).includes(m.id)).sort(cmp)
    if (list.length) groups.push({ name: m.name, nick: m.tgUsername, isMember: true, cards: list })
  }
  const orphan = cards.filter((c) => !(c.assigneeIds || []).some((id) => members.find((m) => m.id === id))).sort(cmp)
  if (orphan.length) groups.push({ name: 'Без исполнителя', isMember: false, cards: orphan })
  return groups
}

function renderGroups(groups, colById, opts) {
  return groups
    .map((g) => `${groupHeader(g)}\n` + g.cards.map((c) => '   ' + fmtCardLine(c, colById, opts)).join('\n'))
    .join('\n\n')
}

/** Блок «Просрочено» для утреннего отчёта: задачи с прошлых дней, которые ещё не
 *  сделаны, по каждому исполнителю. Пусто — блока нет. */
function renderOverdue(board, todayKey, colById, members, keepIds) {
  const cards = overdueCards(board, todayKey, keepIds)
  if (!cards.length) return ''
  const body = renderGroups(groupByMember(cards, members, byDate), colById, { showDate: true })
  return `‼️ <b>Просрочено — надо закрыть:</b>\n\n${body}\n\n`
}

/** Легенда статусов под горизонтальной чертой — чтобы не выглядела частью задач. */
function legendBlock() {
  return `\n\n${HR}\n<i>${EMOJI.todo} нужно сделать · ${EMOJI.doing} в работе · ${EMOJI.review} на проверке · ${EMOJI.done} готово</i>`
}

/** Задачи, которые утром были на сегодня, а теперь перенесены на другой день. */
function movedCards(board, plannedIds, today) {
  const byId = board.cards || {}
  const moved = []
  for (const id of plannedIds || []) {
    const c = byId[id]
    if (!c || c.deleted) continue // удалённые не считаем «перенесёнными»
    if (c.date === today) continue // всё ещё на сегодня
    moved.push(c)
  }
  return moved.sort((a, b) => (a.date || '').localeCompare(b.date || ''))
}

/** Блок «перенесённые»: название → на какую дату переехало. */
function renderMoved(moved) {
  if (!moved.length) return ''
  const lines = moved.map((c) => {
    const to = c.date ? ddmm(c.date) : 'без даты'
    const meeting = c.kind === 'meeting' ? '📹 ' : ''
    return `   ${meeting}${esc(c.title || 'Без названия')} ➡️ <b>${to}</b>`
  })
  return `\n\n🔀 <b>Перенесены на другой день:</b>\n` + lines.join('\n')
}

export function morningText(board, plannedIds = [], overdueIds = []) {
  const { colById, members } = buildIndex(board)
  const today = dateKey(0)
  const cards = cardsForDate(board, today)
  let body
  if (cards.length === 0) body = 'На сегодня задач не запланировано 🎉'
  else body = renderGroups(groupByMember(cards, members), colById)
  // Просроченное — сверху, как в календаре: иначе про эти задачи забывают.
  const overdue = renderOverdue(board, today, colById, members, overdueIds)
  const moved = renderMoved(movedCards(board, plannedIds, today))
  return `☀️ <b>Доброе утро!</b>\n\n${overdue}📅 <b>Задачи на сегодня, ${ddmm(today)}:</b>\n\n${body}${moved}${legendBlock()}`
}

export function eveningText(board, plannedIds = []) {
  const { colById, members } = buildIndex(board)
  const today = dateKey(0)
  const tomorrow = dateKey(1)
  const cards = cardsForDate(board, today)
  const done = cards.filter((c) => statusOf(c, colById) === 'done')

  let summary
  if (cards.length === 0) summary = 'Задач на сегодня не было.'
  else {
    const groups = groupByMember(cards, members).map((g) => {
      const d = g.cards.filter((c) => statusOf(c, colById) === 'done').length
      return `${groupHeader(g)} — готово ${d} из ${g.cards.length}\n` + g.cards.map((c) => '   ' + fmtCardLine(c, colById)).join('\n')
    })
    summary = groups.join('\n\n')
  }

  const moved = renderMoved(movedCards(board, plannedIds, today))

  const tomCards = cardsForDate(board, tomorrow)
  let tomorrowBlock = ''
  if (tomCards.length) {
    tomorrowBlock = `\n\n📅 <b>На завтра, ${ddmm(tomorrow)}:</b>\n\n` + renderGroups(groupByMember(tomCards, members), colById)
  }

  const head = `🌙 <b>Итоги дня, ${ddmm(today)}</b>\nВыполнено ${done.length} из ${cards.length}.`
  return `${head}\n\n${summary}${moved}${tomorrowBlock}${legendBlock()}`
}

// ---------- Основной сценарий ----------

async function main() {
  if (!BOT_TOKEN) {
    console.log('TELEGRAM_BOT_TOKEN не задан — бот ещё не настроен, пропускаю.')
    return
  }
  if (!DATA_TOKEN) {
    console.log('DATA_REPO_TOKEN не задан — нет доступа к приватным данным, пропускаю.')
    return
  }

  const { json: board } = await ghGet(DATA, DATA_TOKEN)
  if (!board) throw new Error('board.json не найден в репозитории данных — сначала настройте доску в приложении.')

  const stateFile = await ghGet(STATE, STATE_TOKEN)
  const state = stateFile.json && typeof stateFile.json === 'object' ? stateFile.json : {}
  const today = dateKey(0)
  state.days = state.days || {}
  const day = state.days[today] || {}

  if (MODE === 'morning') {
    // Запоминаем, какие задачи были запланированы на сегодня — чтобы позже
    // показать «перенесённые» (те, что за день переехали на другой день).
    const planned = cardsForDate(board, today).map((c) => c.id)
    const overdue = overdueCards(board, today).map((c) => c.id)
    const id = await sendMessage(morningText(board, planned, overdue))
    day.morningMsgId = id
    day.plannedIds = planned
    day.overdueIds = overdue
    state.days[today] = day
    await ghPut(STATE, STATE_TOKEN, state, stateFile.sha)
    console.log(`Утреннее сообщение отправлено (id ${id}).`)
  } else if (MODE === 'evening') {
    const planned = day.plannedIds || []
    // Обновим утреннее сообщение финальными статусами, затем пришлём итог
    if (day.morningMsgId) await editMessage(day.morningMsgId, morningText(board, planned, day.overdueIds || []))
    const id = await sendMessage(eveningText(board, planned))
    day.eveningMsgId = id
    state.days[today] = day
    await ghPut(STATE, STATE_TOKEN, state, stateFile.sha)
    console.log(`Вечерний отчёт отправлен (id ${id}).`)
  } else {
    // refresh: редактируем утреннее сообщение под текущие статусы
    if (!day.morningMsgId) {
      console.log('Утреннего сообщения ещё нет — обновлять нечего.')
      return
    }
    await editMessage(day.morningMsgId, morningText(board, day.plannedIds || [], day.overdueIds || []))
    console.log('Утреннее сообщение обновлено.')
  }
}

import { fileURLToPath } from 'node:url'
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  main().catch((e) => {
    console.error('Ошибка бота:', e.message)
    process.exit(1)
  })
}
