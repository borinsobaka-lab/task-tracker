// Единый Telegram-бот задач на Cloudflare Worker.
//
// Делает две вещи (обе — на быстрой инфраструктуре Cloudflare, без задержек):
//
//  1) ГРУППОВЫЕ ОТЧЁТЫ в общий чат (как раньше):
//       • утром — список задач на сегодня;
//       • вечером — итоги дня + задачи на завтра;
//       • днём — то же утреннее сообщение постоянно обновляется под текущие
//         статусы (проверка раз в минуту, а не раз в 15 минут).
//
//  2) ЛИЧНЫЕ УВЕДОМЛЕНИЯ (диалог в личке):
//       /start → пароль сервиса → выбор участника → подписка. Дальше приходят:
//       «Вам назначили задачу/встречу» и «Через ~30 минут» до начала.
//
// Состояние — в Cloudflare KV (binding BOT_KV). board.json читается из приватного
// репозитория (DATA_TOKEN). Пароль проверяется расшифровкой auth.json (как вход
// в приложение) и нигде не хранится.

// ---------- Telegram ----------

async function tgApi(env, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json().catch(() => ({ ok: false, description: 'bad response' }))
}

function openBtn(env) {
  return { inline_keyboard: [[{ text: '📋 Открыть задачи', url: env.APP_URL }]] }
}

async function tgSend(env, chatId, text, keyboard) {
  return tgApi(env, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: keyboard } : {}),
  })
}

async function tgDelete(env, chatId, messageId) {
  try {
    await tgApi(env, 'deleteMessage', { chat_id: chatId, message_id: messageId })
  } catch {
    /* приватность — не критично */
  }
}
async function tgAnswer(env, id) {
  try {
    await tgApi(env, 'answerCallbackQuery', { callback_query_id: id })
  } catch {
    /* не критично */
  }
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ---------- KV ----------

async function kvGet(env, key) {
  const v = await env.BOT_KV.get(key)
  return v ? JSON.parse(v) : {}
}
async function kvPut(env, key, obj) {
  await env.BOT_KV.put(key, JSON.stringify(obj))
}

// ---------- Данные из GitHub ----------

export async function loadAuthBlob(env) {
  const url = `https://raw.githubusercontent.com/${env.AUTH_OWNER}/${env.AUTH_REPO}/${env.AUTH_BRANCH}/auth.json`
  const res = await fetch(url, { headers: { 'User-Agent': 'tasktracker-bot' }, cf: { cacheTtl: 0 } })
  if (!res.ok) throw new Error('auth.json: ' + res.status)
  return res.json()
}

export async function loadBoard(env) {
  const url = `https://api.github.com/repos/${env.DATA_OWNER}/${env.DATA_REPO}/contents/board.json?ref=${encodeURIComponent(
    env.DATA_BRANCH,
  )}`
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.DATA_TOKEN}`,
      Accept: 'application/vnd.github.raw+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'tasktracker-bot',
    },
    cf: { cacheTtl: 0 },
  })
  if (!res.ok) throw new Error('board.json: ' + res.status)
  return res.json()
}

// ---------- Проверка пароля (PBKDF2/AES-GCM — как в приложении) ----------

function b64ToBytes(b64) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// Cloudflare Workers поддерживают не более 100 000 итераций PBKDF2 (иначе бросают
// NotSupportedError). Приложение шифрует ключ ровно этим числом; у совсем старых
// файлов поля iter нет — там 250 000, и такой ключ бот проверить не может, пока
// владелец один раз не войдёт в приложение (оно пере-шифрует ключ). См. authNeedsAppLogin.
export const MAX_ITERATIONS = 100000

export function blobIterations(blob) {
  return blob && typeof blob.iter === 'number' ? blob.iter : 250000
}

/** true — ключ зашифрован числом итераций, которое воркер не осилит (нужен вход в приложение). */
export function authNeedsAppLogin(blob) {
  return blobIterations(blob) > MAX_ITERATIONS
}

export async function verifyPassword(blob, password) {
  if (!blob || typeof blob.salt !== 'string' || typeof blob.iv !== 'string' || typeof blob.ct !== 'string') return false
  const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64ToBytes(blob.salt), iterations: blobIterations(blob), hash: 'SHA-256' },
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

// ================= ГРУППОВЫЕ ОТЧЁТЫ (порт логики report.mjs) =================

const EMOJI = { todo: '⬜', doing: '🔧', review: '👀', done: '✅' }
const HR = '➖➖➖➖➖➖➖➖➖➖'

function dateKey(env, offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: env.TZ_NAME, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}
function ddmm(key) {
  const [, m, d] = key.split('-')
  return `${d}.${m}`
}
function tzHHMM(env) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: env.TZ_NAME, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())
}

function buildIndex(board) {
  const colById = new Map((board.columns || []).filter((c) => !c.deleted).map((c) => [c.id, c]))
  const members = (board.members || []).filter((m) => !m.archived)
  return { colById, members }
}
function statusOf(card, colById) {
  if (card.done) return 'done'
  const col = colById.get(card.columnId)
  if (col && col.role) return col.role
  const t = ((col && col.title) || '').toLowerCase()
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
function tgHandle(raw) {
  const n = String(raw || '').trim()
  if (!n) return ''
  return n.startsWith('@') ? n : '@' + n
}
function groupHeader(g) {
  const handle = tgHandle(g.nick)
  const icon = g.isMember ? '👤 ' : '📭 '
  return `${icon}<b>${esc(g.name)}</b>${handle ? ` (${esc(handle)})` : ''}`
}
function byTime(a, b) {
  const as = a.start || ''
  const bs = b.start || ''
  if (as && bs) return as.localeCompare(bs) || (a.title || '').localeCompare(b.title || '', 'ru')
  if (!as && !bs) return (a.title || '').localeCompare(b.title || '', 'ru')
  return as ? 1 : -1
}
function groupByMember(cards, members) {
  const groups = []
  for (const m of members) {
    const list = cards.filter((c) => (c.assigneeIds || []).includes(m.id)).sort(byTime)
    if (list.length) groups.push({ name: m.name, nick: m.tgUsername, isMember: true, cards: list })
  }
  const orphan = cards.filter((c) => !(c.assigneeIds || []).some((id) => members.find((m) => m.id === id))).sort(byTime)
  if (orphan.length) groups.push({ name: 'Без исполнителя', isMember: false, cards: orphan })
  return groups
}
function renderGroups(groups, colById) {
  return groups.map((g) => `${groupHeader(g)}\n` + g.cards.map((c) => '   ' + fmtCardLine(c, colById)).join('\n')).join('\n\n')
}
function legendBlock() {
  return `\n\n${HR}\n<i>${EMOJI.todo} нужно сделать · ${EMOJI.doing} в работе · ${EMOJI.review} на проверке · ${EMOJI.done} готово</i>`
}
function movedCards(board, plannedIds, today) {
  const byId = board.cards || {}
  const moved = []
  for (const id of plannedIds || []) {
    const c = byId[id]
    if (!c || c.deleted) continue
    if (c.date === today) continue
    moved.push(c)
  }
  return moved.sort((a, b) => (a.date || '').localeCompare(b.date || ''))
}
function renderMoved(moved) {
  if (!moved.length) return ''
  const lines = moved.map((c) => {
    const to = c.date ? ddmm(c.date) : 'без даты'
    const meeting = c.kind === 'meeting' ? '📹 ' : ''
    return `   ${meeting}${esc(c.title || 'Без названия')} ➡️ <b>${to}</b>`
  })
  return `\n\n🔀 <b>Перенесены на другой день:</b>\n` + lines.join('\n')
}
export function morningText(env, board, plannedIds = []) {
  const { colById, members } = buildIndex(board)
  const today = dateKey(env, 0)
  const cards = cardsForDate(board, today)
  const body = cards.length === 0 ? 'На сегодня задач не запланировано 🎉' : renderGroups(groupByMember(cards, members), colById)
  const moved = renderMoved(movedCards(board, plannedIds, today))
  return `☀️ <b>Доброе утро!</b>\nЗадачи на сегодня, ${ddmm(today)}:\n\n${body}${moved}${legendBlock()}`
}
export function eveningText(env, board, plannedIds = []) {
  const { colById, members } = buildIndex(board)
  const today = dateKey(env, 0)
  const tomorrow = dateKey(env, 1)
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

async function sendGroup(env, text) {
  const r = await tgApi(env, 'sendMessage', {
    chat_id: env.GROUP_CHAT_ID,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: openBtn(env),
  })
  return r.ok ? r.result.message_id : null
}
async function editGroup(env, msgId, text) {
  const r = await tgApi(env, 'editMessageText', {
    chat_id: env.GROUP_CHAT_ID,
    message_id: msgId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: openBtn(env),
  })
  // «message is not modified» и «message to edit not found» — норма, игнорируем
  return r
}

async function runGroupReport(env, board) {
  if (!env.GROUP_CHAT_ID) return
  const today = dateKey(env, 0)
  const nowHM = tzHHMM(env)
  const morning = env.MORNING || '10:00'
  const evening = env.EVENING || '20:00'

  const state = await kvGet(env, 'report')
  state.days = state.days || {}
  const day = state.days[today] || {}

  // Утро (один раз за день, как только наступило время)
  if (state.morningDate !== today && nowHM >= morning && nowHM < evening) {
    const planned = cardsForDate(board, today).map((c) => c.id)
    const id = await sendGroup(env, morningText(env, board, planned))
    if (id) {
      day.morningMsgId = id
      day.plannedIds = planned
      state.days[today] = day
      state.morningDate = today
      await kvPut(env, 'report', state)
    }
    return
  }

  // Вечер (один раз за день)
  if (state.eveningDate !== today && nowHM >= evening) {
    const planned = day.plannedIds || []
    if (day.morningMsgId) await editGroup(env, day.morningMsgId, morningText(env, board, planned))
    const id = await sendGroup(env, eveningText(env, board, planned))
    if (id) {
      day.eveningMsgId = id
      state.days[today] = day
      state.eveningDate = today
      await kvPut(env, 'report', state)
    }
    return
  }

  // Днём — обновляем утреннее сообщение под текущие статусы (идемпотентно, без записи в KV)
  if (state.morningDate === today && day.morningMsgId && nowHM >= morning && nowHM < evening) {
    await editGroup(env, day.morningMsgId, morningText(env, board, day.plannedIds || []))
  }
}

// ================= ЛИЧНЫЕ УВЕДОМЛЕНИЯ =================

export function activeMembers(board) {
  return (board.members || []).filter((m) => m && !m.archived)
}
export function assignedCardIds(board, memberId) {
  const out = new Set()
  for (const c of Object.values(board.cards || {})) {
    if (!c || c.deleted || c.seriesId) continue
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
function tzWallToEpoch(dateKeyStr, hhmm, tz) {
  const [Y, Mo, D] = dateKeyStr.split('-').map(Number)
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

async function runNotifications(env, board) {
  const sessions = await kvGet(env, 'sessions')
  const active = Object.entries(sessions).filter(([, s]) => s && s.stage === 'active')
  if (!active.length) return
  const notif = await kvGet(env, 'notif')
  const now = Date.now()
  const tz = env.TZ_NAME
  let changed = false
  for (const [chatId, s] of active) {
    const st = notif[chatId] || { knownAssigned: [], notified30: [] }
    const known = new Set(st.knownAssigned || [])
    const notified = new Set(st.notified30 || [])

    const assigned = assignedCardIds(board, s.memberId)
    for (const id of assigned) {
      if (known.has(id)) continue
      const card = board.cards[id]
      const what = card.kind === 'meeting' ? 'встречу' : 'задачу'
      await tgSend(env, chatId, `📌 Вам назначили ${what}: <b>${esc(card.title || 'Без названия')}</b>${cardWhen(card)}`, openBtn(env))
      known.add(id)
      changed = true
    }
    for (const id of [...known]) if (!assigned.has(id)) { known.delete(id); changed = true }

    const up = upcomingWithin(board, s.memberId, tz, now, 30)
    const upIds = new Set(up.map((u) => u.id))
    for (const u of up) {
      if (notified.has(u.id)) continue
      const what = u.kind === 'meeting' ? ' (встреча)' : ''
      await tgSend(env, chatId, `⏰ Через ${u.mins} мин начнётся: <b>${esc(u.title)}</b> в ${u.start}${what}`, openBtn(env))
      notified.add(u.id)
      changed = true
    }
    for (const id of [...notified]) if (!upIds.has(id)) { notified.delete(id); changed = true }

    notif[chatId] = { knownAssigned: [...known], notified30: [...notified] }
  }
  if (changed) await kvPut(env, 'notif', notif)
}

// ---------- Личный диалог (webhook) ----------

const GREETING =
  'Привет! Это бот задач 🗒\n\nЧтобы получать личные уведомления, введите <b>пароль сервиса</b> — тот же, что при входе в приложение.'

async function onMessage(msg, env) {
  const chatId = String(msg.chat.id)
  const text = (msg.text || '').trim()
  const sessions = await kvGet(env, 'sessions')
  const s = sessions[chatId]

  if (text === '/stop' || text === '/logout') {
    delete sessions[chatId]
    await kvPut(env, 'sessions', sessions)
    const notif = await kvGet(env, 'notif')
    if (notif[chatId]) {
      delete notif[chatId]
      await kvPut(env, 'notif', notif)
    }
    await tgSend(env, chatId, 'Уведомления отключены. Чтобы снова включить — напишите /start.')
    return
  }

  if (text === '/start' || !s) {
    sessions[chatId] = { stage: 'pw' }
    await kvPut(env, 'sessions', sessions)
    await tgSend(env, chatId, GREETING)
    return
  }

  if (s.stage === 'pw') {
    let blob
    try {
      blob = await loadAuthBlob(env)
    } catch {
      await tgSend(env, chatId, 'Не удалось получить настройки входа (связь с GitHub). Попробуйте ещё раз чуть позже.')
      return
    }
    // Старый ключ (250 000 итераций) воркер не проверит — просим владельца один
    // раз войти в приложение: оно молча пере-шифрует ключ под лимит воркера.
    if (authNeedsAppLogin(blob)) {
      await tgSend(
        env,
        chatId,
        'Почти готово. Откройте приложение и войдите по паролю один раз — это обновит настройки безопасности. После этого пришлите пароль сюда ещё раз.',
        openBtn(env),
      )
      return
    }
    let ok = false
    try {
      ok = await verifyPassword(blob, text)
    } catch {
      await tgSend(env, chatId, 'Не удалось проверить пароль (проблема со связью). Попробуйте ещё раз чуть позже.')
      return
    }
    await tgDelete(env, chatId, msg.message_id)
    if (!ok) {
      await tgSend(env, chatId, '❌ Неверный пароль. Попробуйте ещё раз.')
      return
    }
    let board
    try {
      board = await loadBoard(env)
    } catch {
      await tgSend(env, chatId, 'Пароль верный, но не удалось получить список участников. Попробуйте позже.')
      return
    }
    const members = activeMembers(board)
    if (!members.length) {
      await tgSend(env, chatId, 'Пароль верный, но в сервисе пока нет участников. Добавьте их в настройках приложения.')
      return
    }
    sessions[chatId] = { stage: 'pick' }
    await kvPut(env, 'sessions', sessions)
    const kb = { inline_keyboard: members.map((m) => [{ text: m.name, callback_data: 'pick:' + m.id }]) }
    await tgSend(env, chatId, '✅ Пароль верный. Кто вы?', kb)
    return
  }

  if (s.stage === 'pick') {
    await tgSend(env, chatId, 'Выберите пользователя кнопкой выше 👆 (или /start, чтобы начать заново).')
    return
  }

  await tgSend(
    env,
    chatId,
    `Вы подключены как <b>${esc(memberName(await loadBoard(env).catch(() => ({})), s.memberId))}</b>.\nЯ пишу, когда вам назначают задачу и за ~30 минут до задачи/встречи.\nОтключить — /stop.`,
  )
}

async function onCallback(cbq, env) {
  const chatId = String((cbq.message && cbq.message.chat && cbq.message.chat.id) || '')
  const data = cbq.data || ''
  await tgAnswer(env, cbq.id)
  if (!chatId || !data.startsWith('pick:')) return
  const sessions = await kvGet(env, 'sessions')
  const s = sessions[chatId]
  if (!s || s.stage !== 'pick') return

  const memberId = data.slice('pick:'.length)
  let board
  try {
    board = await loadBoard(env)
  } catch {
    await tgSend(env, chatId, 'Не удалось получить данные. Напишите /start и попробуйте снова.')
    return
  }
  const member = activeMembers(board).find((m) => m.id === memberId)
  if (!member) {
    await tgSend(env, chatId, 'Этот участник не найден. Напишите /start и выберите заново.')
    return
  }

  sessions[chatId] = { stage: 'active', memberId }
  await kvPut(env, 'sessions', sessions)
  const notif = await kvGet(env, 'notif')
  notif[chatId] = { knownAssigned: [...assignedCardIds(board, memberId)], notified30: [] }
  await kvPut(env, 'notif', notif)

  await tgSend(
    env,
    chatId,
    `Готово, <b>${esc(member.name)}</b>! 🎉\n\nТеперь я буду присылать:\n• когда вам <b>назначат задачу</b> или встречу;\n• напоминание <b>за ~30 минут</b> до начала.\n\nОтключить — /stop.`,
    openBtn(env),
  )
}

function memberName(board, memberId) {
  const m = (board.members || []).find((x) => x.id === memberId)
  return m ? m.name : 'участник'
}

// ---------- Точки входа ----------

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('Task tracker bot is running.')
    if (env.WEBHOOK_SECRET && request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) {
      return new Response('forbidden', { status: 403 })
    }
    let update
    try {
      update = await request.json()
    } catch {
      return new Response('bad request', { status: 400 })
    }
    try {
      if (update.callback_query) {
        await onCallback(update.callback_query, env)
      } else if (update.message && update.message.chat && update.message.chat.type === 'private') {
        await onMessage(update.message, env)
      }
    } catch (e) {
      const emsg = (e && e.message) || String(e)
      console.log('handler error:', emsg)
      // Не молчим при внутренней ошибке: сообщаем пользователю (частая причина —
      // не привязано KV-хранилище BOT_KV или не заданы переменные). tgSend от KV
      // не зависит, поэтому такое уведомление дойдёт даже при сломанном KV.
      const chatId =
        (update.callback_query && update.callback_query.message && update.callback_query.message.chat && update.callback_query.message.chat.id) ||
        (update.message && update.message.chat && update.message.chat.id)
      if (chatId) {
        try {
          await tgSend(env, String(chatId), '⚠️ Внутренняя ошибка бота: ' + esc(emsg) + '\n\nЕсли повторяется — проверьте, что к воркеру привязано KV-хранилище BOT_KV и заданы все переменные.')
        } catch {
          /* и уведомить не вышло — тогда только лог */
        }
      }
    }
    return new Response('OK')
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        let board
        try {
          board = await loadBoard(env)
        } catch (e) {
          console.log('board load failed:', e && e.message)
          return
        }
        await runNotifications(env, board)
        await runGroupReport(env, board)
      })(),
    )
  },
}
