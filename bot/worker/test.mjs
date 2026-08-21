// Проверка чистой логики Worker в Node (без Cloudflare/Telegram).
// Запуск: node bot/worker/test.mjs   (Node ≥ 20 с глобальным Web Crypto)

import assert from 'node:assert/strict'
import { verifyPassword, authNeedsAppLogin, assignedCardIds, upcomingWithin, activeMembers, morningText, eveningText, makeInboxCard, overdueCards } from './worker.js'

function b64(bytes) {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}
// iterations по умолчанию 100 000 — как теперь шифрует приложение (лимит воркера).
// Передайте 250000 и iter=false, чтобы сымитировать старый файл без поля iter.
async function makeBlob(secret, password, iterations = 100000, withIter = true) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  )
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(secret))
  const blob = { v: 1, configured: true, salt: b64(salt), iv: b64(iv), ct: b64(new Uint8Array(ct)) }
  if (withIter) blob.iter = iterations
  return blob
}
function wall(ms, tz) {
  const p = {}
  for (const x of new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ms)))
    p[x.type] = x.value
  return { date: `${p.year}-${p.month}-${p.day}`, start: `${p.hour}:${p.minute}` }
}

function ddmmOf(key) {
  const [, m, d] = key.split('-')
  return `${d}.${m}`
}

const tz = 'Asia/Tbilisi'
const env = { TZ_NAME: tz }

// 1) Пароль (новый формат: 100 000 итераций + поле iter — как шифрует приложение)
const blob = await makeBlob('ghp_secret_token', 'hunter2')
assert.equal(authNeedsAppLogin(blob), false, 'новый ключ (100k) воркер проверяет сам')
assert.equal(await verifyPassword(blob, 'hunter2'), true, 'верный пароль принят')
assert.equal(await verifyPassword(blob, 'wrong'), false, 'неверный пароль отклонён')

// 1b) Старый ключ (250 000 итераций, без поля iter) воркер не осилит — просит вход в приложение
const legacy = await makeBlob('ghp_secret_token', 'hunter2', 250000, false)
assert.equal(authNeedsAppLogin(legacy), true, 'старый ключ требует входа в приложение')

// 2) Личные уведомления
const board = {
  members: [{ id: 'm1', name: 'Вова' }, { id: 'm2', name: 'Аня', archived: true }],
  columns: [{ id: 'todo', title: 'Нужно сделать', role: 'todo' }],
  cards: {
    a: { id: 'a', title: 'Задача 1', assigneeIds: ['m1'], columnId: 'todo' },
    d: { id: 'd', title: 'Повтор', assigneeIds: ['m1'], seriesId: 's1', columnId: 'todo' },
  },
}
assert.deepEqual(activeMembers(board).map((m) => m.id), ['m1'], 'архивные скрыты')
assert.deepEqual([...assignedCardIds(board, 'm1')].sort(), ['a'], 'разовая задача участника (без повторяющихся)')

const now = Date.now()
const w20 = wall(now + 20 * 60000, tz)
const soon = { cards: { e: { id: 'e', title: 'Скоро', assigneeIds: ['m1'], date: w20.date, start: w20.start } } }
assert.equal(upcomingWithin(soon, 'm1', tz, now, 30).length, 1, 'событие через 20 мин в окне 30')

// 3) Тексты групповых отчётов (общий режим — без проекта)
const today = wall(now, tz).date
const boardToday = {
  members: [{ id: 'm1', name: 'Вова' }, { id: 'm2', name: 'Аня' }],
  columns: [{ id: 'todo', title: 'Нужно сделать', role: 'todo' }],
  projects: [
    { id: 'proj-1', name: 'Альфа' },
    { id: 'proj-2', name: 'Бета' },
  ],
  cards: {
    t: { id: 't', title: 'Позвонить в банк', assigneeIds: ['m1'], columnId: 'todo', date: today },
    a: { id: 'a', title: 'Задача Альфы', assigneeIds: ['m1'], columnId: 'todo', date: today, projectId: 'proj-1' },
    b: { id: 'b', title: 'Задача Беты', assigneeIds: ['m2'], columnId: 'todo', date: today, projectId: 'proj-2' },
  },
}
const allGroup = { chatId: 'g0', projectId: null, name: '' }
const mt = morningText(env, boardToday, allGroup, [])
assert.ok(mt.includes('Доброе утро'), 'утренний заголовок')
assert.ok(mt.includes('Позвонить в банк'), 'утренний список содержит задачу без проекта')
assert.ok(mt.includes('Вова'), 'группировка по исполнителю')
assert.ok(!mt.includes('📁'), 'в общем режиме нет строки с названием проекта')
const et = eveningText(env, boardToday, allGroup, [])
assert.ok(et.includes('Итоги дня'), 'вечерний заголовок')

// 3b) Режим по проектам: в группу проекта идут его задачи + задачи без проекта,
//     сообщение начинается с названия проекта, чужие задачи не попадают.
const alpha = { chatId: 'g1', projectId: 'proj-1', name: 'Альфа' }
const beta = { chatId: 'g2', projectId: 'proj-2', name: 'Бета' }
const mAlpha = morningText(env, boardToday, alpha, [])
assert.ok(mAlpha.includes('📁'), 'в режиме проекта есть строка с названием проекта')
assert.ok(mAlpha.includes('Альфа'), 'название проекта Альфа в шапке')
assert.ok(mAlpha.includes('Задача Альфы'), 'задача проекта попала в его группу')
assert.ok(mAlpha.includes('Позвонить в банк'), 'задача без проекта попала в группу проекта')
assert.ok(!mAlpha.includes('Задача Беты'), 'чужая задача не попала в группу проекта Альфа')
const mBeta = morningText(env, boardToday, beta, [])
assert.ok(mBeta.includes('Задача Беты'), 'задача Беты в группе Беты')
assert.ok(mBeta.includes('Позвонить в банк'), 'задача без проекта попала и в группу Беты')
assert.ok(!mBeta.includes('Задача Альфы'), 'чужая задача не попала в группу Беты')

// 3c) «Входящие» (роль колонки 'inbox') не попадают в отчёты
const boardInbox = {
  members: [{ id: 'm1', name: 'Вова' }],
  columns: [
    { id: 'inbox', title: 'Входящие', role: 'inbox' },
    { id: 'todo', title: 'Нужно сделать', role: 'todo' },
  ],
  cards: {
    x: { id: 'x', title: 'Из телеграма', assigneeIds: ['m1'], columnId: 'inbox', date: today },
    y: { id: 'y', title: 'Обычная задача', assigneeIds: ['m1'], columnId: 'todo', date: today },
  },
}
const mi = morningText(env, boardInbox, allGroup, [])
assert.ok(mi.includes('Обычная задача'), 'обычная задача в отчёте')
assert.ok(!mi.includes('Из телеграма'), 'карточка из колонки «Входящие» в отчёт НЕ попадает')

// 3d) Просроченные задачи (те, что календарь закрепляет сверху дня) — в утреннем отчёте
function shiftDays(key, days) {
  const d = new Date(key + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
const past = shiftDays(today, -3)
const older = shiftDays(today, -10)
const boardOverdue = {
  members: [{ id: 'm1', name: 'Вова' }, { id: 'm2', name: 'Аня' }],
  columns: [
    { id: 'inbox', title: 'Входящие', role: 'inbox' },
    { id: 'todo', title: 'Нужно сделать', role: 'todo' },
    { id: 'done', title: 'Готово', role: 'done' },
  ],
  cards: {
    t: { id: 't', title: 'Задача на сегодня', assigneeIds: ['m1'], columnId: 'todo', date: today },
    o1: { id: 'o1', title: 'Забытая задача', assigneeIds: ['m1'], columnId: 'todo', date: past },
    o2: { id: 'o2', title: 'Совсем старая', assigneeIds: ['m2'], columnId: 'todo', date: older },
    o3: { id: 'o3', title: 'Старая доделанная', assigneeIds: ['m1'], columnId: 'done', date: past },
    o4: { id: 'o4', title: 'Старая помеченная', assigneeIds: ['m1'], columnId: 'todo', date: past, done: true },
    o5: { id: 'o5', title: 'Прошедшая встреча', assigneeIds: ['m1'], columnId: 'todo', date: past, kind: 'meeting' },
    o6: { id: 'o6', title: 'Старое неразобранное', assigneeIds: ['m1'], columnId: 'inbox', date: past },
    o7: { id: 'o7', title: 'Тянется до завтра', assigneeIds: ['m1'], columnId: 'todo', date: past, endDate: shiftDays(today, 1) },
    o8: { id: 'o8', title: 'Удалённая старая', assigneeIds: ['m1'], columnId: 'todo', date: past, deleted: true },
  },
}
assert.deepEqual(
  overdueCards(boardOverdue, today, null).map((c) => c.id),
  ['o2', 'o1'],
  'просрочены только незакрытые задачи с прошлых дней, самые давние сверху',
)
const mo = morningText(env, boardOverdue, allGroup, [])
assert.ok(mo.includes('Просрочено'), 'в утреннем отчёте есть блок просроченного')
assert.ok(mo.indexOf('Просрочено') < mo.indexOf('Задачи на сегодня'), 'просроченное — выше задач на день')
assert.ok(mo.includes('Забытая задача'), 'просроченная задача попала в отчёт')
assert.ok(mo.includes('Совсем старая'), 'просроченная задача второго участника попала в отчёт')
assert.ok(mo.includes(ddmmOf(past)), 'у просроченной задачи видна её дата')
assert.ok(!mo.includes('Старая доделанная'), 'закрытая через колонку «Готово» не считается просроченной')
assert.ok(!mo.includes('Старая помеченная'), 'отмеченная выполненной не считается просроченной')
assert.ok(!mo.includes('Прошедшая встреча'), 'прошедшая встреча не просрочена — её не доделать')
assert.ok(!mo.includes('Старое неразобранное'), '«Входящие» в блок просроченного не идут')
assert.ok(!mo.includes('Тянется до завтра'), 'многодневная задача, идущая по сегодня, ещё не просрочена')
assert.ok(!mo.includes('Удалённая старая'), 'удалённая карточка не просрочена')
assert.ok(mo.includes('Задача на сегодня'), 'задачи дня остались на месте')

// Доска без просрочки — блока нет вовсе
assert.ok(!morningText(env, boardToday, allGroup, []).includes('Просрочено'), 'нет просрочки — нет и блока')

// keepIds: задачу из утреннего сообщения доделали — она остаётся, но зачёркнутой
const closed = JSON.parse(JSON.stringify(boardOverdue))
closed.cards.o1.done = true
const moClosed = morningText(env, closed, allGroup, [], ['o1'])
assert.ok(moClosed.includes('<s>Забытая задача</s>'), 'доделанная за день просрочка остаётся зачёркнутой')
assert.ok(!morningText(env, closed, allGroup, []).includes('Забытая задача'), 'без keepIds доделанная просрочка уходит из блока')

// Режим проектов: чужая просрочка в группу не попадает
const boardOverdueProj = JSON.parse(JSON.stringify(boardOverdue))
boardOverdueProj.projects = [{ id: 'proj-1', name: 'Альфа' }, { id: 'proj-2', name: 'Бета' }]
boardOverdueProj.cards.o1.projectId = 'proj-1'
boardOverdueProj.cards.o2.projectId = 'proj-2'
const moAlpha = morningText(env, boardOverdueProj, alpha, [])
assert.ok(moAlpha.includes('Забытая задача'), 'просрочка своего проекта в группе проекта')
assert.ok(!moAlpha.includes('Совсем старая'), 'чужая просрочка в группу проекта не идёт')

// 4) Форма задачи, созданной ботом из Telegram
const card = makeInboxCard('  Купить корм  ', 'inbox', '2026-07-19T10:00:00.000Z', 'id1')
assert.equal(card.title, '  Купить корм  ', 'заголовок = текст сообщения')
assert.equal(card.columnId, 'inbox', 'карточка кладётся в колонку «Входящие»')
assert.deepEqual(card.assigneeIds, [], 'без исполнителя — разберём в приложении')
assert.equal(card.kind, 'task', 'это задача, не встреча')

console.log('OK: все проверки логики Worker пройдены')
