// Личный Telegram-бот на GitHub Actions (без сторонних сервисов).
// Запускается по расписанию (раз в 5 минут). На каждом запуске:
//   1) читает новые личные сообщения через getUpdates и ведёт диалог:
//      /start → запрос ПАРОЛЯ СЕРВИСА → проверка (расшифровка auth.json) →
//      список участников кнопками → выбор себя → подписка;
//   2) шлёт персональные уведомления:
//      • «Вам назначили задачу/встречу» — когда вас добавили в исполнители;
//      • «Через ~30 минут» — напоминание перед задачей/встречей.
//
// board.json читается из ПРИВАТНОГО репозитория данных (DATA_TOKEN, только чтение).
// Состояние бота (сессии, офсет, отметки уведомлений) хранится в tg-personal.json
// в ПУБЛИЧНОМ репозитории (ветка app-config) через github.token (STATE_TOKEN).
// Имена участников и тексты задач в состоянии НЕ сохраняются — только id.
//
// Групповым отчётам это не мешает: они лишь отправляют сообщения, а getUpdates
// использует один и тот же токен бота без конфликта (webhook мы не ставим).

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const DATA_TOKEN = process.env.DATA_TOKEN || ''
const STATE_TOKEN = process.env.STATE_TOKEN || ''
const TZ = process.env.TZ_NAME || 'Asia/Tbilisi'
const APP_URL = process.env.APP_URL || 'https://borinsobaka-lab.github.io/task-tracker/'

const DATA = {
  owner: process.env.DATA_OWNER || 'borinsobaka-lab',
  repo: process.env.DATA_REPO || 'task-tracker-data',
  branch: process.env.DATA_BRANCH || 'tasks-data',
  path: 'board.json',
}
const [stateOwner, stateRepo] = (process.env.GH_REPO || 'borinsobaka-lab/task-tracker').split('/')
const STATE = { owner: stateOwner, repo: stateRepo, branch: 'app-config', path: 'tg-personal.json' }
const AUTH_RAW = `https://raw.githubusercontent.com/${stateOwner}/${stateRepo}/app-config/auth.json`

const OPEN_BTN = { inline_keyboard: [[{ text: '📋 Открыть задачи', url: APP_URL }]] }

// ---------- Telegram ----------

async function tgApi(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json().catch(() => ({ ok: false, description: 'bad response' }))
}

async function tgSend(chatId, text, keyboard) {
  return tgApi('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: keyboard } : {}),
  })
}
async function tgDelete(chatId, messageId) {
  try {
    await tgApi('deleteMessage', { chat_id: chatId, message_id: messageId })
  } catch {
    /* приватность — не критично */
  }
}
async function tgAnswer(id) {
  try {
    await tgApi('answerCallbackQuery', { callback_query_id: id })
  } catch {
    /* не критично */
  }
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function getUpdates(offset) {
  const body = { timeout: 0, allowed_updates: ['message', 'callback_query'] }
  if (offset) body.offset = offset
  let data = await tgApi('getUpdates', body)
  if (!data.ok && /webhook is active|Conflict/i.test(data.description || '')) {
    console.log('Найден активный webhook (остался от Cloudflare?) — удаляю, чтобы читать сообщения напрямую.')
    await tgApi('deleteWebhook', { drop_pending_updates: false })
    data = await tgApi('getUpdates', body)
  }
  if (!data.ok) throw new Error('getUpdates: ' + (data.description || 'unknown'))
  return data.result || []
}

// ---------- GitHub Contents ----------

async function ghGet(repo, token) {
  const res = await fetch(
    `https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${encodeURIComponent(repo.path)}?ref=${encodeURIComponent(repo.branch)}`,
    { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' }, cache: 'no-store' },
  )
  if (res.status === 404) return { json: null, sha: null }
  if (!res.ok) throw new Error(`GET ${repo.repo}/${repo.path}: ${res.status}`)
  const file = await res.json()
  let content = file.content
  if (!content && file.sha) {
    const blob = await (
      await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}/git/blobs/${file.sha}`, {
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
      })
    ).json()
    content = blob.content
  }
  return { json: JSON.parse(Buffer.from(content, 'base64').toString('utf8')), sha: file.sha }
}

async function ghPut(repo, token, obj, sha) {
  const res = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${encodeURIComponent(repo.path)}`, {
    method: 'PUT',
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Состояние личного Telegram-бота',
      content: Buffer.from(JSON.stringify(obj, null, 2), 'utf8').toString('base64'),
      branch: repo.branch,
      ...(sha ? { sha } : {}),
    }),
  })
  if (!res.ok) throw new Error(`PUT ${repo.repo}/${repo.path}: ${res.status} ${await res.text()}`)
}

async function fetchAuthBlob() {
  const res = await fetch(AUTH_RAW, { cache: 'no-store' })
  if (!res.ok) throw new Error('auth.json: ' + res.status)
  return res.json()
}

// ---------- Проверка пароля (PBKDF2/AES-GCM — как в приложении) ----------

function b64ToBytes(b64) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function verifyPassword(blob, password) {
  if (!blob || typeof blob.salt !== 'string' || typeof blob.iv !== 'string' || typeof blob.ct !== 'string') return false
  const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64ToBytes(blob.salt), iterations: 250000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  )
  try {
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(blob.iv) }, key, b64ToBytes(blob.ct))
    return true
  } catch {
    return false
  }
}

// ---------- Доска ----------

export function activeMembers(board) {
  return (board.members || []).filter((m) => m && !m.archived)
}

export function assignedCardIds(board, memberId) {
  const out = new Set()
  for (const c of Object.values(board.cards || {})) {
    if (!c || c.deleted || c.seriesId) continue // экземпляры повторяющихся — не «назначение»
    if ((c.assigneeIds || []).includes(memberId)) out.add(c.id)
  }
  return out
}

function tzOffsetMinutes(date, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const p = {}
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
  return (asUTC - date.getTime()) / 60000
}

function tzWallToEpoch(dateKey, hhmm, tz) {
  const [Y, Mo, D] = dateKey.split('-').map(Number)
  const [h, mi] = hhmm.split(':').map(Number)
  const utcGuess = Date.UTC(Y, Mo - 1, D, h, mi)
  return utcGuess - tzOffsetMinutes(new Date(utcGuess), tz) * 60000
}

export function upcomingWithin(board, memberId, tz, nowMs, minutes) {
  const out = []
  for (const c of Object.values(board.cards || {})) {
    if (!c || c.deleted || c.done) continue
    if (!c.date || !c.start) continue
    if (!(c.assigneeIds || []).includes(memberId)) continue
    const mins = Math.round((tzWallToEpoch(c.date, c.start, tz) - nowMs) / 60000)
    if (mins > 0 && mins <= minutes) out.push({ id: c.id, title: c.title || 'Без названия', start: c.start, kind: c.kind, mins })
  }
  return out
}

function cardWhen(card) {
  if (!card.date) return ''
  const [, m, d] = card.date.split('-')
  return ` — ${d}.${m}${card.start ? ' ' + card.start : ''}`
}

// ---------- Диалог ----------

const GREETING =
  'Привет! Это бот задач 🗒\n\nЧтобы получать личные уведомления, введите <b>пароль сервиса</b> — тот же, что при входе в приложение.'

async function onMessage(msg, state, board) {
  const chatId = String(msg.chat.id)
  const text = (msg.text || '').trim()
  const s = state.sessions[chatId]

  if (text === '/stop' || text === '/logout') {
    delete state.sessions[chatId]
    delete state.notif[chatId]
    await tgSend(chatId, 'Уведомления отключены. Чтобы снова включить — напишите /start.')
    return
  }

  if (text === '/start' || !s) {
    state.sessions[chatId] = { stage: 'pw' }
    await tgSend(chatId, GREETING)
    return
  }

  if (s.stage === 'pw') {
    let ok = false
    try {
      ok = await verifyPassword(await fetchAuthBlob(), text)
    } catch {
      await tgSend(chatId, 'Не удалось проверить пароль (проблема со связью). Попробуйте ещё раз чуть позже.')
      return
    }
    await tgDelete(chatId, msg.message_id) // прячем пароль из переписки
    if (!ok) {
      await tgSend(chatId, '❌ Неверный пароль. Попробуйте ещё раз.')
      return
    }
    const members = activeMembers(board)
    if (!members.length) {
      await tgSend(chatId, 'Пароль верный, но в сервисе пока нет участников. Добавьте их в настройках приложения.')
      return
    }
    state.sessions[chatId] = { stage: 'pick' }
    const kb = { inline_keyboard: members.map((m) => [{ text: m.name, callback_data: 'pick:' + m.id }]) }
    await tgSend(chatId, '✅ Пароль верный. Кто вы?', kb)
    return
  }

  if (s.stage === 'pick') {
    await tgSend(chatId, 'Выберите пользователя кнопкой выше 👆 (или /start, чтобы начать заново).')
    return
  }

  // active
  const name = memberName(board, s.memberId)
  await tgSend(
    chatId,
    `Вы подключены как <b>${esc(name)}</b>.\nЯ пишу, когда вам назначают задачу и за ~30 минут до задачи/встречи.\nОтключить — /stop.`,
  )
}

async function onCallback(cbq, state, board) {
  const chatId = String(cbq.message?.chat?.id ?? '')
  const data = cbq.data || ''
  await tgAnswer(cbq.id)
  if (!chatId || !data.startsWith('pick:')) return
  const s = state.sessions[chatId]
  if (!s || s.stage !== 'pick') return

  const memberId = data.slice('pick:'.length)
  const member = activeMembers(board).find((m) => m.id === memberId)
  if (!member) {
    await tgSend(chatId, 'Этот участник не найден. Напишите /start и выберите заново.')
    return
  }

  state.sessions[chatId] = { stage: 'active', memberId }
  // Инициализируем набор известных назначений текущими — чтобы не прислать сразу
  // пачку «вам назначили» по уже существующим задачам.
  state.notif[chatId] = { knownAssigned: [...assignedCardIds(board, memberId)], notified30: [] }

  await tgSend(
    chatId,
    `Готово, <b>${esc(member.name)}</b>! 🎉\n\nТеперь я буду присылать:\n• когда вам <b>назначат задачу</b> или встречу;\n• напоминание <b>за ~30 минут</b> до начала.\n\nОтключить — /stop.`,
    OPEN_BTN,
  )
}

function memberName(board, memberId) {
  const m = (board.members || []).find((x) => x.id === memberId)
  return m ? m.name : 'участник'
}

// ---------- Уведомления ----------

async function runNotifications(state, board) {
  const now = Date.now()
  let changed = false
  for (const [chatId, s] of Object.entries(state.sessions)) {
    if (!s || s.stage !== 'active') continue
    const st = state.notif[chatId] || { knownAssigned: [], notified30: [] }
    const known = new Set(st.knownAssigned || [])
    const notified = new Set(st.notified30 || [])

    // 1) Новые назначения
    const assigned = assignedCardIds(board, s.memberId)
    for (const id of assigned) {
      if (known.has(id)) continue
      const card = board.cards[id]
      const what = card.kind === 'meeting' ? 'встречу' : 'задачу'
      await tgSend(chatId, `📌 Вам назначили ${what}: <b>${esc(card.title || 'Без названия')}</b>${cardWhen(card)}`, OPEN_BTN)
      known.add(id)
      changed = true
    }
    for (const id of [...known]) {
      if (!assigned.has(id)) {
        known.delete(id)
        changed = true
      }
    }

    // 2) Напоминание за ~30 минут
    const up = upcomingWithin(board, s.memberId, TZ, now, 30)
    const upIds = new Set(up.map((u) => u.id))
    for (const u of up) {
      if (notified.has(u.id)) continue
      const what = u.kind === 'meeting' ? ' (встреча)' : ''
      await tgSend(chatId, `⏰ Через ${u.mins} мин начнётся: <b>${esc(u.title)}</b> в ${u.start}${what}`, OPEN_BTN)
      notified.add(u.id)
      changed = true
    }
    for (const id of [...notified]) {
      if (!upIds.has(id)) {
        notified.delete(id)
        changed = true
      }
    }

    state.notif[chatId] = { knownAssigned: [...known], notified30: [...notified] }
  }
  return changed
}

// ---------- Основной сценарий ----------

async function main() {
  if (!BOT_TOKEN) return console.log('TELEGRAM_BOT_TOKEN не задан — пропускаю.')
  if (!DATA_TOKEN) return console.log('DATA_TOKEN не задан — нет доступа к данным, пропускаю.')

  const { json: board } = await ghGet(DATA, DATA_TOKEN)
  if (!board) throw new Error('board.json не найден — сначала настройте доску в приложении.')

  const sf = await ghGet(STATE, STATE_TOKEN)
  const state = sf.json && typeof sf.json === 'object' ? sf.json : {}
  state.sessions = state.sessions || {}
  state.notif = state.notif || {}
  const startOffset = state.offset || 0

  // 1) Обрабатываем новые сообщения
  let offset = startOffset
  const updates = await getUpdates(offset ? offset + 1 : undefined)
  for (const u of updates) {
    offset = u.update_id
    try {
      if (u.callback_query) await onCallback(u.callback_query, state, board)
      else if (u.message && u.message.chat && u.message.chat.type === 'private') await onMessage(u.message, state, board)
    } catch (e) {
      console.log('Ошибка обработки обновления:', e && e.message)
    }
  }

  // 2) Персональные уведомления
  const notifChanged = await runNotifications(state, board)

  // 3) Сохраняем состояние, если что-то изменилось
  if (offset !== startOffset || notifChanged || updates.length) {
    state.offset = offset
    await ghPut(STATE, STATE_TOKEN, state, sf.sha)
  }
  console.log(`Готово. Обновлений: ${updates.length}, офсет: ${offset}.`)
}

import { fileURLToPath } from 'node:url'
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  main().catch((e) => {
    console.error('Ошибка личного бота:', e.message)
    process.exit(1)
  })
}
