// Интерактивный Telegram-бот на Cloudflare Worker.
//
// Что делает:
//  1) Личный диалог: пользователь пишет боту → бот просит ПАРОЛЬ СЕРВИСА →
//     проверяет его, расшифровывая auth.json (тот же пароль, что и вход в
//     приложение) → показывает список участников → пользователь выбирает себя →
//     подписка сохранена.
//  2) Персональные уведомления (по расписанию, раз в минуту):
//       • «Вам назначили задачу/встречу» — когда вас добавили в исполнители;
//       • «Через ~30 минут» — напоминание перед задачей/встречей.
//
// Состояние (сессии диалога и статусы уведомлений) хранится в Cloudflare KV.
// Групповые отчёты продолжает слать прежний бот из GitHub Actions — webhook им
// не мешает (они только отправляют сообщения, не читают обновления).

// ---------- Telegram API ----------

async function tgApi(env, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json().catch(() => ({}))
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
    /* приватность — не критично, если не удалилось */
  }
}

async function tgAnswerCallback(env, id, text) {
  try {
    await tgApi(env, 'answerCallbackQuery', { callback_query_id: id, ...(text ? { text } : {}) })
  } catch {
    /* не критично */
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ---------- KV (состояние) ----------

async function kvGet(env, key) {
  const v = await env.BOT_KV.get(key)
  return v ? JSON.parse(v) : {}
}
async function kvPut(env, key, obj) {
  await env.BOT_KV.put(key, JSON.stringify(obj))
}

// ---------- Данные из GitHub ----------

/** Зашифрованный ключ доступа (публичный репозиторий) — для проверки пароля. */
export async function loadAuthBlob(env) {
  const url = `https://raw.githubusercontent.com/${env.AUTH_OWNER}/${env.AUTH_REPO}/${env.AUTH_BRANCH}/auth.json`
  const res = await fetch(url, { headers: { 'User-Agent': 'tasktracker-bot' }, cf: { cacheTtl: 0 } })
  if (!res.ok) throw new Error('auth.json: ' + res.status)
  return res.json()
}

/** board.json из приватного репозитория данных (нужен DATA_TOKEN с доступом на чтение). */
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

// ---------- Проверка пароля (тот же PBKDF2/AES-GCM, что в приложении) ----------

function b64ToBytes(b64) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** true, если пароль верный (GCM-тег сошёлся при расшифровке auth.json). */
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

// ---------- Работа с доской ----------

export function activeMembers(board) {
  return (board.members || []).filter((m) => m && !m.archived)
}

/** Живые НЕповторяющиеся задачи/встречи, назначенные участнику (по ним ловим «вам назначили»). */
export function assignedCardIds(board, memberId) {
  const out = new Set()
  for (const c of Object.values(board.cards || {})) {
    if (!c || c.deleted || c.seriesId) continue // экземпляры повторяющихся не считаем «назначением»
    if ((c.assigneeIds || []).includes(memberId)) out.add(c.id)
  }
  return out
}

/** Смещение часового пояса (минуты к востоку от UTC) для конкретного момента. */
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

/** Эпоха (мс) для настенного времени date='YYYY-MM-DD' + hhmm='HH:MM' в зоне tz. */
export function tzWallToEpoch(dateKey, hhmm, tz) {
  const [Y, Mo, D] = dateKey.split('-').map(Number)
  const [h, mi] = hhmm.split(':').map(Number)
  const utcGuess = Date.UTC(Y, Mo - 1, D, h, mi)
  const off = tzOffsetMinutes(new Date(utcGuess), tz)
  return utcGuess - off * 60000
}

/** Задачи/встречи участника, старт которых наступит в пределах `minutes` минут. */
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

async function onMessage(msg, env) {
  const chatId = String(msg.chat.id)
  const text = (msg.text || '').trim()
  const sessions = await kvGet(env, 'sessions')
  const s = sessions[chatId]

  if (text === '/stop' || text === '/logout') {
    if (s) {
      delete sessions[chatId]
      await kvPut(env, 'sessions', sessions)
      const notif = await kvGet(env, 'notif')
      if (notif[chatId]) {
        delete notif[chatId]
        await kvPut(env, 'notif', notif)
      }
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
    let ok = false
    try {
      ok = await verifyPassword(await loadAuthBlob(env), text)
    } catch {
      await tgSend(env, chatId, 'Не удалось проверить пароль (проблема со связью). Попробуйте ещё раз чуть позже.')
      return
    }
    await tgDelete(env, chatId, msg.message_id) // прячем пароль из переписки
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

  // stage === 'active'
  await tgSend(
    env,
    chatId,
    `Вы подключены как <b>${escapeHtml(s.memberName)}</b>.\nЯ пишу, когда вам назначают задачу и за ~30 минут до задачи/встречи.\nОтключить — /stop.`,
  )
}

async function onCallback(cbq, env) {
  const chatId = String(cbq.message?.chat?.id ?? '')
  const data = cbq.data || ''
  await tgAnswerCallback(env, cbq.id)
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

  sessions[chatId] = { stage: 'active', memberId, memberName: member.name }
  await kvPut(env, 'sessions', sessions)

  // Инициализируем состояние уведомлений текущими задачами — чтобы не прислать
  // сразу пачку «вам назначили» по уже существующим задачам.
  const notif = await kvGet(env, 'notif')
  notif[chatId] = { knownAssigned: [...assignedCardIds(board, memberId)], notified30: [] }
  await kvPut(env, 'notif', notif)

  await tgSend(
    env,
    chatId,
    `Готово, <b>${escapeHtml(member.name)}</b>! 🎉\n\nТеперь я буду присылать:\n• когда вам <b>назначат задачу</b> или встречу;\n• напоминание <b>за ~30 минут</b> до начала.\n\nОтключить — /stop.`,
    openBtn(env),
  )
}

// ---------- Уведомления по расписанию ----------

async function runNotifications(env) {
  const sessions = await kvGet(env, 'sessions')
  const active = Object.entries(sessions).filter(([, s]) => s && s.stage === 'active')
  if (!active.length) return

  let board
  try {
    board = await loadBoard(env)
  } catch (e) {
    console.log('board load failed:', e && e.message)
    return
  }

  const notif = await kvGet(env, 'notif')
  const now = Date.now()
  const tz = env.TZ_NAME || 'Asia/Tbilisi'
  let changed = false

  for (const [chatId, s] of active) {
    const st = notif[chatId] || { knownAssigned: [], notified30: [] }
    const known = new Set(st.knownAssigned || [])
    const notified = new Set(st.notified30 || [])

    // 1) Новые назначения
    const assigned = assignedCardIds(board, s.memberId)
    for (const id of assigned) {
      if (known.has(id)) continue
      const card = board.cards[id]
      const what = card.kind === 'meeting' ? 'встречу' : 'задачу'
      await tgSend(env, chatId, `📌 Вам назначили ${what}: <b>${escapeHtml(card.title || 'Без названия')}</b>${cardWhen(card)}`, openBtn(env))
      known.add(id)
      changed = true
    }
    for (const id of [...known]) {
      if (!assigned.has(id)) {
        known.delete(id) // сняли назначение/удалили — забываем, чтобы при повторном назначении снова уведомить
        changed = true
      }
    }

    // 2) Напоминание за ~30 минут
    const up = upcomingWithin(board, s.memberId, tz, now, 30)
    const upIds = new Set(up.map((u) => u.id))
    for (const u of up) {
      if (notified.has(u.id)) continue
      const what = u.kind === 'meeting' ? ' (встреча)' : ''
      await tgSend(env, chatId, `⏰ Через ${u.mins} мин начнётся: <b>${escapeHtml(u.title)}</b> в ${u.start}${what}`, openBtn(env))
      notified.add(u.id)
      changed = true
    }
    for (const id of [...notified]) {
      if (!upIds.has(id)) {
        notified.delete(id) // событие прошло — очищаем, набор не растёт
        changed = true
      }
    }

    notif[chatId] = { knownAssigned: [...known], notified30: [...notified] }
  }

  if (changed) await kvPut(env, 'notif', notif)
}

// ---------- Точки входа Worker ----------

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('Task tracker bot is running.')
    // Секрет вебхука: Telegram присылает его заголовком (защита от чужих запросов)
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
      console.log('handler error:', e && e.message)
    }
    return new Response('OK')
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runNotifications(env))
  },
}
