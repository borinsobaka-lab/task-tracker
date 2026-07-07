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
  const r = await tg('sendMessage', { chat_id: CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true })
  if (!r.ok) throw new Error(`sendMessage: ${JSON.stringify(r.data)}`)
  return r.data.result.message_id
}

async function editMessage(messageId, text) {
  const r = await tg('editMessageText', { chat_id: CHAT_ID, message_id: messageId, text, parse_mode: 'HTML', disable_web_page_preview: true })
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

function fmtCardLine(card, colById) {
  const st = statusOf(card, colById)
  const time = card.start ? `${card.start} ` : ''
  const meeting = card.kind === 'meeting' ? '📹 ' : ''
  let title = esc(card.title || 'Без названия')
  if (st === 'done') title = `<s>${title}</s>`
  let extra = ''
  if (card.kind === 'meeting' && card.meetingUrl) extra = ` — <a href="${esc(card.meetingUrl)}">ссылка</a>`
  return `${EMOJI[st]} ${time}${meeting}${title}${extra}`
}

/** Ник в Telegram → упоминание "@ник" (добавляем @, если пользователь его не поставил). */
function tgHandle(raw) {
  const n = String(raw || '').trim()
  if (!n) return ''
  return n.startsWith('@') ? n : '@' + n
}

/** Заголовок группы: «Имя (@ник)», чтобы Telegram тегал участника. */
function groupHeader(g) {
  const handle = tgHandle(g.nick)
  return `<b>${esc(g.name)}</b>${handle ? ` (${esc(handle)})` : ''}`
}

/** Группирует карточки по исполнителям (+ группа «Без исполнителя»). */
function groupByMember(cards, members) {
  const groups = []
  for (const m of members) {
    const list = cards.filter((c) => (c.assigneeIds || []).includes(m.id))
    if (list.length) groups.push({ name: m.name, nick: m.tgUsername, cards: list })
  }
  const orphan = cards.filter((c) => !(c.assigneeIds || []).some((id) => members.find((m) => m.id === id)))
  if (orphan.length) groups.push({ name: 'Без исполнителя', cards: orphan })
  return groups
}

function renderGroups(groups, colById) {
  return groups
    .map((g) => `${groupHeader(g)}\n` + g.cards.map((c) => '   ' + fmtCardLine(c, colById)).join('\n'))
    .join('\n\n')
}

export function morningText(board) {
  const { colById, members } = buildIndex(board)
  const today = dateKey(0)
  const cards = cardsForDate(board, today)
  let body
  if (cards.length === 0) body = 'На сегодня задач не запланировано 🎉'
  else body = renderGroups(groupByMember(cards, members), colById)
  const legend = `\n\n<i>${EMOJI.todo} нужно сделать · ${EMOJI.doing} в работе · ${EMOJI.review} на проверке · ${EMOJI.done} готово</i>`
  return `☀️ <b>Доброе утро!</b>\nЗадачи на сегодня, ${ddmm(today)}:\n\n${body}${legend}`
}

export function eveningText(board) {
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

  const tomCards = cardsForDate(board, tomorrow)
  let tomorrowBlock = ''
  if (tomCards.length) {
    tomorrowBlock = `\n\n📅 <b>На завтра, ${ddmm(tomorrow)}:</b>\n\n` + renderGroups(groupByMember(tomCards, members), colById)
  }

  const head = `🌙 <b>Итоги дня, ${ddmm(today)}</b>\nВыполнено ${done.length} из ${cards.length}.`
  return `${head}\n\n${summary}${tomorrowBlock}`
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
    const id = await sendMessage(morningText(board))
    day.morningMsgId = id
    state.days[today] = day
    await ghPut(STATE, STATE_TOKEN, state, stateFile.sha)
    console.log(`Утреннее сообщение отправлено (id ${id}).`)
  } else if (MODE === 'evening') {
    // Обновим утреннее сообщение финальными статусами, затем пришлём итог
    if (day.morningMsgId) await editMessage(day.morningMsgId, morningText(board))
    const id = await sendMessage(eveningText(board))
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
    await editMessage(day.morningMsgId, morningText(board))
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
