// Единый Telegram-бот задач на Cloudflare Worker.
//
// Делает две вещи (обе — на быстрой инфраструктуре Cloudflare, без задержек):
//
//  1) ГРУППОВЫЕ ОТЧЁТЫ по проектам (у каждого проекта — своя Telegram-группа):
//       • утром — список задач на сегодня;
//       • вечером — итоги дня + задачи на завтра;
//       • днём — то же утреннее сообщение постоянно обновляется под текущие
//         статусы (проверка раз в минуту, а не раз в 15 минут).
//     В группу проекта уходят задачи этого проекта + задачи вообще без проекта
//     (последние попадают во все группы). Сообщение начинается с названия проекта.
//     Группы берутся из board.projects[].tgGroupId (настраивается в приложении);
//     если ни у одного проекта id не задан — работаем по-старому, в один чат
//     GROUP_CHAT_ID со всеми задачами сразу.
//
//  2) ЛИЧНЫЕ УВЕДОМЛЕНИЯ (диалог в личке):
//       /start → пароль сервиса → выбор участника → подписка. Дальше приходят:
//       «Вам назначили задачу/встречу» и «Через ~30 минут» до начала.
//
//  3) БЫСТРОЕ ДОБАВЛЕНИЕ ЗАДАЧ из личке: подключённый участник шлёт боту любой
//       текст → бот спрашивает «Создать задачу?» (Да/Нет). «Да» создаёт задачу в
//       колонке со статусом «Входящие» (роль 'inbox'), которую потом разбираешь в
//       приложении. Для записи board.json секрету DATA_TOKEN нужны права записи.
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
// Меняем текст сообщения и убираем кнопки (после выбора Да/Нет)
async function tgEditText(env, chatId, messageId, text) {
  try {
    await tgApi(env, 'editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [] },
    })
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
  const missing = ['AUTH_OWNER', 'AUTH_REPO', 'AUTH_BRANCH'].filter((k) => !env[k])
  if (missing.length) throw new Error('не заданы переменные ' + missing.join(', '))
  // Публичный файл — читаем без токена. Свежесть обеспечиваем уникальным query
  // (иначе можно получить старый ключ из кэша и не увидеть обновление пароля).
  const path = `${env.AUTH_OWNER}/${env.AUTH_REPO}/${env.AUTH_BRANCH}/auth.json`
  const url = `https://raw.githubusercontent.com/${path}?ts=${Date.now()}`
  let res
  try {
    res = await fetch(url, { headers: { 'User-Agent': 'tasktracker-bot', Accept: 'application/json' } })
  } catch (e) {
    throw new Error('нет сети до GitHub (' + ((e && e.message) || e) + ')')
  }
  if (!res.ok) throw new Error(`GitHub вернул ${res.status} для ${path}`)
  return res.json()
}

export async function loadBoard(env) {
  const missing = ['DATA_OWNER', 'DATA_REPO', 'DATA_BRANCH'].filter((k) => !env[k])
  if (missing.length) throw new Error('не заданы переменные ' + missing.join(', '))
  if (!env.DATA_TOKEN) throw new Error('не задан секрет DATA_TOKEN')
  const where = `${env.DATA_OWNER}/${env.DATA_REPO}@${env.DATA_BRANCH}/board.json`
  const url = `https://api.github.com/repos/${env.DATA_OWNER}/${env.DATA_REPO}/contents/board.json?ref=${encodeURIComponent(
    env.DATA_BRANCH,
  )}&ts=${Date.now()}`
  let res
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${env.DATA_TOKEN}`,
        Accept: 'application/vnd.github.raw+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'tasktracker-bot',
      },
    })
  } catch (e) {
    throw new Error('нет сети до GitHub (' + ((e && e.message) || e) + ')')
  }
  if (!res.ok) {
    const hint =
      res.status === 401 ? ' — токен DATA_TOKEN неверный или просрочен'
      : res.status === 404 ? ' — токену нет доступа к приватному репозиторию данных, либо нет board.json на этой ветке'
      : ''
    throw new Error(`GitHub вернул ${res.status} для ${where}${hint}`)
  }
  return res.json()
}

// ---------- Запись board.json (создание задач из Telegram) ----------

function nowISO() {
  return new Date().toISOString()
}

// base64 ⇄ UTF-8 (btoa/atob работают только с Latin1, а в задачах кириллица)
function b64encodeUtf8(str) {
  const bytes = new TextEncoder().encode(str)
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  return btoa(bin)
}
function b64decodeUtf8(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

// Читаем board.json вместе с sha (нужен для записи)
async function ghGetBoard(env) {
  const url = `https://api.github.com/repos/${env.DATA_OWNER}/${env.DATA_REPO}/contents/board.json?ref=${encodeURIComponent(
    env.DATA_BRANCH,
  )}&ts=${Date.now()}`
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.DATA_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'tasktracker-bot',
    },
  })
  if (!res.ok) throw new Error(`GitHub вернул ${res.status} при чтении board.json`)
  const j = await res.json()
  return { board: JSON.parse(b64decodeUtf8(j.content)), sha: j.sha }
}
// Пишем board.json обратно (commit). Возвращаем сам Response (для проверки 409).
async function ghPutBoard(env, board, sha, message) {
  const url = `https://api.github.com/repos/${env.DATA_OWNER}/${env.DATA_REPO}/contents/board.json`
  return fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${env.DATA_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'tasktracker-bot',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: message || 'Новая задача из Telegram-бота',
      content: b64encodeUtf8(JSON.stringify(board)),
      sha,
      branch: env.DATA_BRANCH,
    }),
  })
}

// Форма новой карточки-«входящей» (без исполнителя — разберём в приложении)
export function makeInboxCard(text, columnId, ts, id) {
  return {
    id,
    title: String(text).slice(0, 500),
    kind: 'task',
    description: '',
    columnId,
    assigneeIds: [],
    checklist: [],
    attachments: [],
    comments: [],
    createdAt: ts,
    updatedAt: ts,
  }
}

// Создаём задачу в колонке со статусом «Входящие». Повторяем при конфликте sha.
async function createInboxCard(env, text) {
  if (!env.DATA_TOKEN) return { error: 'не задан секрет DATA_TOKEN' }
  for (let attempt = 0; attempt < 4; attempt++) {
    let got
    try {
      got = await ghGetBoard(env)
    } catch (e) {
      return { error: (e && e.message) || String(e) }
    }
    const { board, sha } = got
    const inbox = (board.columns || []).find((c) => c && !c.deleted && c.role === 'inbox')
    if (!inbox) return { noInbox: true }
    const ts = nowISO()
    const id = crypto.randomUUID()
    board.cards = board.cards || {}
    board.cards[id] = makeInboxCard(text, inbox.id, ts, id)
    inbox.cardIds = Array.isArray(inbox.cardIds) ? inbox.cardIds : []
    inbox.cardIds.push(id)
    inbox.updatedAt = ts
    board.updatedAt = ts
    const res = await ghPutBoard(env, board, sha, `Задача из Telegram: ${String(text).slice(0, 60)}`)
    if (res.ok) return { ok: true, id, column: inbox.title }
    if (res.status === 409) continue // sha устарел (доску кто-то записал) — перечитываем и повторяем
    const t = await res.text().catch(() => '')
    return { error: `GitHub ${res.status} ${String(t).slice(0, 120)}` }
  }
  return { error: 'не удалось записать после нескольких попыток (конфликт версий)' }
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

const EMOJI = { inbox: '📥', todo: '⬜', doing: '🔧', review: '👀', done: '✅' }
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
// Попадает ли карточка в группу проекта projectId. Без проекта (projectId == null)
// — «общая» группа, в неё идёт всё. Для группы конкретного проекта берём задачи
// этого проекта И задачи вообще без проекта (в т.ч. встречи) — они идут во все группы.
function matchesProject(card, projectId) {
  if (!projectId) return true
  return !card.projectId || card.projectId === projectId
}
function cardsForDateProj(board, key, projectId) {
  return cardsForDate(board, key).filter((c) => matchesProject(c, projectId))
}
// Карточки для отчёта: как cardsForDateProj, но без «Входящих» (роль колонки
// 'inbox') — их бот в отчёты не пишет, это неразобранные задачи.
function reportCards(board, key, projectId) {
  const inboxCols = new Set(
    (board.columns || []).filter((c) => c && !c.deleted && c.role === 'inbox').map((c) => c.id),
  )
  return cardsForDateProj(board, key, projectId).filter((c) => !inboxCols.has(c.columnId))
}
// Список целевых групп: у каждого проекта с заданным tgGroupId — своя группа.
// Если ни у кого не задан — падаем в старый режим (один чат GROUP_CHAT_ID, все задачи).
function targetGroups(env, board) {
  const projects = (board.projects || []).filter((p) => p && !p.deleted && String(p.tgGroupId || '').trim())
  if (projects.length) {
    const seen = new Set()
    const groups = []
    for (const p of projects) {
      const chatId = String(p.tgGroupId).trim()
      if (seen.has(chatId)) continue // на случай, если двум проектам указали одну группу
      seen.add(chatId)
      groups.push({ chatId, projectId: p.id, name: p.name || '' })
    }
    return groups
  }
  if (env.GROUP_CHAT_ID) return [{ chatId: String(env.GROUP_CHAT_ID), projectId: null, name: '' }]
  return []
}
function projectPrefix(group) {
  return group && group.name ? `📁 <b>${esc(group.name)}</b>\n` : ''
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
// group = { chatId, projectId, name }. projectId==null и name=='' — «общий» режим
// (старое поведение, все задачи, без строки с названием проекта).
export function morningText(env, board, group = { projectId: null, name: '' }, plannedIds = []) {
  const { colById, members } = buildIndex(board)
  const today = dateKey(env, 0)
  const cards = reportCards(board, today, group.projectId)
  const body = cards.length === 0 ? 'На сегодня задач не запланировано 🎉' : renderGroups(groupByMember(cards, members), colById)
  const moved = renderMoved(movedCards(board, plannedIds, today))
  return `${projectPrefix(group)}☀️ <b>Доброе утро!</b>\nЗадачи на сегодня, ${ddmm(today)}:\n\n${body}${moved}${legendBlock()}`
}
export function eveningText(env, board, group = { projectId: null, name: '' }, plannedIds = []) {
  const { colById, members } = buildIndex(board)
  const today = dateKey(env, 0)
  const tomorrow = dateKey(env, 1)
  const cards = reportCards(board, today, group.projectId)
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
  const tomCards = reportCards(board, tomorrow, group.projectId)
  let tomorrowBlock = ''
  if (tomCards.length) {
    tomorrowBlock = `\n\n📅 <b>На завтра, ${ddmm(tomorrow)}:</b>\n\n` + renderGroups(groupByMember(tomCards, members), colById)
  }
  const head = `${projectPrefix(group)}🌙 <b>Итоги дня, ${ddmm(today)}</b>\nВыполнено ${done.length} из ${cards.length}.`
  return `${head}\n\n${summary}${moved}${tomorrowBlock}${legendBlock()}`
}

async function sendGroup(env, chatId, text) {
  const r = await tgApi(env, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: openBtn(env),
  })
  return r.ok ? r.result.message_id : null
}
async function editGroup(env, chatId, msgId, text) {
  const r = await tgApi(env, 'editMessageText', {
    chat_id: chatId,
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
  const groups = targetGroups(env, board)
  if (!groups.length) return
  const today = dateKey(env, 0)
  const nowHM = tzHHMM(env)
  const morning = env.MORNING || '10:00'
  const evening = env.EVENING || '20:00'

  const state = await kvGet(env, 'report')
  state.groups = state.groups || {} // состояние по каждому чату отдельно
  let changed = false

  // Каждая группа проекта живёт своим циклом (утро/день/вечер) независимо.
  for (const group of groups) {
    const gs = state.groups[group.chatId] || {}
    gs.days = gs.days || {}
    const day = gs.days[today] || {}

    // Утро (один раз за день, как только наступило время)
    if (gs.morningDate !== today && nowHM >= morning && nowHM < evening) {
      const planned = reportCards(board, today, group.projectId).map((c) => c.id)
      const id = await sendGroup(env, group.chatId, morningText(env, board, group, planned))
      if (id) {
        day.morningMsgId = id
        day.plannedIds = planned
        gs.days[today] = day
        gs.morningDate = today
        state.groups[group.chatId] = gs
        changed = true
      }
      continue
    }

    // Вечер (один раз за день)
    if (gs.eveningDate !== today && nowHM >= evening) {
      const planned = day.plannedIds || []
      if (day.morningMsgId) await editGroup(env, group.chatId, day.morningMsgId, morningText(env, board, group, planned))
      const id = await sendGroup(env, group.chatId, eveningText(env, board, group, planned))
      if (id) {
        day.eveningMsgId = id
        gs.days[today] = day
        gs.eveningDate = today
        state.groups[group.chatId] = gs
        changed = true
      }
      continue
    }

    // Днём — обновляем утреннее сообщение под текущие статусы (идемпотентно, без записи в KV)
    if (gs.morningDate === today && day.morningMsgId && nowHM >= morning && nowHM < evening) {
      await editGroup(env, group.chatId, day.morningMsgId, morningText(env, board, group, day.plannedIds || []))
    }
  }

  if (changed) await kvPut(env, 'report', state)
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
    } catch (e) {
      await tgSend(env, chatId, 'Не удалось получить настройки входа: ' + esc((e && e.message) || String(e)))
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
    } catch (e) {
      await tgSend(env, chatId, 'Пароль верный, но не удалось получить список участников: ' + esc((e && e.message) || String(e)))
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

  // Активная сессия: любое обычное сообщение → предлагаем создать из него задачу
  // во «Входящих». Команды (начинаются с «/») сюда не попадают на создание.
  const body = text.trim()
  if (body.startsWith('/')) {
    await tgSend(
      env,
      chatId,
      `Вы подключены как <b>${esc(memberName(await loadBoard(env).catch(() => ({})), s.memberId))}</b>.\n` +
        `Пришлите текст — предложу создать из него задачу во «Входящих». Я также пишу, когда вам назначают задачу и за ~30 минут до начала. Отключить — /stop.`,
    )
    return
  }
  if (!body) return
  sessions[chatId] = { ...s, pending: body }
  await kvPut(env, 'sessions', sessions)
  await tgSend(env, chatId, `Создать задачу из этого сообщения?\n\n«${esc(body)}»`, {
    inline_keyboard: [
      [
        { text: '✅ Да', callback_data: 'task:yes' },
        { text: '✖️ Нет', callback_data: 'task:no' },
      ],
    ],
  })
}

async function onCallback(cbq, env) {
  const chatId = String((cbq.message && cbq.message.chat && cbq.message.chat.id) || '')
  const data = cbq.data || ''
  const msgId = cbq.message && cbq.message.message_id
  await tgAnswer(env, cbq.id)
  if (!chatId) return

  // Быстрое добавление задачи: ответ на «Создать задачу?»
  if (data === 'task:yes' || data === 'task:no') {
    const sessions = await kvGet(env, 'sessions')
    const s = sessions[chatId]
    if (!s || s.stage !== 'active') {
      await tgSend(env, chatId, 'Сессия неактивна. Напишите /start, чтобы подключиться.')
      return
    }
    const text = s.pending
    if (s.pending) {
      delete s.pending
      sessions[chatId] = s
      await kvPut(env, 'sessions', sessions)
    }
    if (data === 'task:no' || !text) {
      if (msgId) await tgEditText(env, chatId, msgId, '✖️ Отменено — задача не создана.')
      else await tgSend(env, chatId, '✖️ Отменено.')
      return
    }
    let result
    try {
      result = await createInboxCard(env, text)
    } catch (e) {
      result = { error: (e && e.message) || String(e) }
    }
    if (result.ok) {
      const msg = `✅ Задача создана во «Входящих»:\n«${esc(text)}»`
      if (msgId) await tgEditText(env, chatId, msgId, msg)
      else await tgSend(env, chatId, msg, openBtn(env))
    } else if (result.noInbox) {
      await tgSend(
        env,
        chatId,
        '⚠️ Не нашёл колонку со статусом «Входящие». Откройте приложение, у нужной колонки задайте статус «Входящие» (меню колонки → «Статус для отчётов») и пришлите сообщение ещё раз.',
        openBtn(env),
      )
    } else {
      await tgSend(
        env,
        chatId,
        '❌ Не удалось создать задачу: ' +
          esc(result.error || 'ошибка записи') +
          '\n\nЧастая причина — у секрета DATA_TOKEN нет права записи (Contents: Read and Write) в репозиторий данных.',
      )
    }
    return
  }

  if (!data.startsWith('pick:')) return
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
    `Готово, <b>${esc(member.name)}</b>! 🎉\n\nТеперь я буду присылать:\n• когда вам <b>назначат задачу</b> или встречу;\n• напоминание <b>за ~30 минут</b> до начала.\n\n📥 А ещё пришлите мне любой текст — предложу быстро создать из него задачу во «Входящих».\n\nОтключить — /stop.`,
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
    // /id или /chatid в любом чате (в т.ч. в группе) — сообщить id чата.
    // Нужен, чтобы узнать id группы проекта: добавьте бота в группу и напишите
    // там «/id@ИмяБота». В личке достаточно «/id».
    const idMsg = update.message
    if (idMsg && idMsg.chat && typeof idMsg.text === 'string' && /^\/(id|chatid)(@[\w]+)?(\s|$)/i.test(idMsg.text.trim())) {
      const where = idMsg.chat.type === 'private' ? 'этого чата' : 'этой группы'
      try {
        await tgApi(env, 'sendMessage', {
          chat_id: idMsg.chat.id,
          text: `ID ${where}: <code>${idMsg.chat.id}</code>\n\nВпишите его в приложении: <b>Настройки → Проекты → поле «Telegram-группа»</b> у нужного проекта. Тогда сюда будут приходить отчёты по задачам этого проекта (и по задачам без проекта).`,
          parse_mode: 'HTML',
        })
      } catch {
        /* не вышло — ничего страшного */
      }
      return new Response('OK')
    }
    // /check — диагностика групповых отчётов: читается ли доска (DATA_TOKEN) и
    // доходят ли сообщения до групп проектов (id из настроек + права бота).
    if (idMsg && idMsg.chat && typeof idMsg.text === 'string' && /^\/(check|проверка)(@[\w]+)?(\s|$)/i.test(idMsg.text.trim())) {
      const chatId = String(idMsg.chat.id)
      let board
      try {
        board = await loadBoard(env)
      } catch (e) {
        await tgSend(env, chatId, '❌ Доска не читается: ' + esc((e && e.message) || String(e)) + '\n\nОтчёты не уходят именно поэтому. Обычно виноват DATA_TOKEN — у него нет доступа к приватному репозиторию данных.')
        return new Response('OK')
      }
      const today = dateKey(env, 0)
      await tgSend(env, chatId, `✅ Доска читается. Всего задач с датой на сегодня (${ddmm(today)}): ${cardsForDate(board, today).length}.`)
      const groups = targetGroups(env, board)
      if (!groups.length) {
        await tgSend(env, chatId, '⚠️ Не настроена ни одна группа: укажите ID Telegram-группы у проектов (Настройки → Проекты) или задайте переменную GROUP_CHAT_ID.')
        return new Response('OK')
      }
      for (const group of groups) {
        const label = group.name ? `проекта «${esc(group.name)}»` : 'общей группы'
        const n = cardsForDateProj(board, today, group.projectId).length
        const test = group.name
          ? `🔧 Проверка связи — сюда будут приходить отчёты по проекту «${esc(group.name)}» (и по задачам без проекта).`
          : '🔧 Проверка связи с ботом — если вы это видите, отчёты будут приходить сюда.'
        const r = await tgApi(env, 'sendMessage', { chat_id: group.chatId, text: test, parse_mode: 'HTML' })
        if (r && r.ok) {
          await tgSend(env, chatId, `✅ В группу ${label} (id=<code>${esc(group.chatId)}</code>) отправлено тестовое сообщение. Задач на сегодня для неё: ${n}.`)
        } else {
          await tgSend(env, chatId, `❌ Не удалось отправить в группу ${label} (id=<code>${esc(group.chatId)}</code>): ${esc((r && r.description) || 'нет ответа от Telegram')}\n\nЧастые причины: бот не добавлен в группу, у него нет права писать сообщения, либо id группы неверный (перепроверьте через /id@ИмяБота внутри группы).`)
        }
      }
      await tgSend(env, chatId, `Отчёты приходят: утро — ${esc(env.MORNING || '10:00')}, вечер — ${esc(env.EVENING || '20:00')} по ${esc(env.TZ_NAME || 'TZ')}.`)
      return new Response('OK')
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
