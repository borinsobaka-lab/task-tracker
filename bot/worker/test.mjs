// Проверка чистой логики Worker в Node (без Cloudflare/Telegram).
// Запуск: node bot/worker/test.mjs   (Node ≥ 20 с глобальным Web Crypto)

import assert from 'node:assert/strict'
import { verifyPassword, authNeedsAppLogin, assignedCardIds, upcomingWithin, activeMembers, morningText, eveningText } from './worker.js'

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

console.log('OK: все проверки логики Worker пройдены')
