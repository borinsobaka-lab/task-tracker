// Проверка чистой логики Worker в Node (без Cloudflare/Telegram).
// Запуск: node bot/worker/test.mjs   (нужен Node ≥ 20 с глобальным Web Crypto)

import assert from 'node:assert/strict'
import { verifyPassword, assignedCardIds, upcomingWithin } from './worker.js'

function b64(bytes) {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

// Собираем auth.json ровно так же, как приложение (PBKDF2 250k SHA-256 + AES-GCM).
async function makeBlob(secret, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  )
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(secret))
  return { v: 1, configured: true, salt: b64(salt), iv: b64(iv), ct: b64(new Uint8Array(ct)) }
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

// 1) Проверка пароля
const blob = await makeBlob('ghp_secret_token', 'hunter2')
assert.equal(await verifyPassword(blob, 'hunter2'), true, 'верный пароль принят')
assert.equal(await verifyPassword(blob, 'wrong'), false, 'неверный пароль отклонён')
assert.equal(await verifyPassword(blob, ''), false, 'пустой пароль отклонён')

// 2) Назначенные задачи: только живые, не повторяющиеся, конкретного участника
const board = {
  members: [{ id: 'm1', name: 'Борис' }, { id: 'm2', name: 'Аня', archived: true }],
  cards: {
    a: { id: 'a', title: 'Задача 1', assigneeIds: ['m1'] },
    b: { id: 'b', title: 'Чужая', assigneeIds: ['m2'] },
    c: { id: 'c', title: 'Удалённая', assigneeIds: ['m1'], deleted: true },
    d: { id: 'd', title: 'Повтор', assigneeIds: ['m1'], seriesId: 's1' },
  },
}
assert.deepEqual([...assignedCardIds(board, 'm1')].sort(), ['a'], 'только живая разовая задача участника')

// 3) Напоминание за 30 минут
const now = Date.now()
const w20 = wall(now + 20 * 60000, tz)
const soon = { cards: { e: { id: 'e', title: 'Скоро', assigneeIds: ['m1'], date: w20.date, start: w20.start } } }
const up = upcomingWithin(soon, 'm1', tz, now, 30)
assert.equal(up.length, 1, 'событие через 20 мин попадает в окно 30')
assert.ok(up[0].mins >= 18 && up[0].mins <= 22, 'осталось ~20 минут')

const w40 = wall(now + 40 * 60000, tz)
const later = { cards: { f: { id: 'f', title: 'Позже', assigneeIds: ['m1'], date: w40.date, start: w40.start } } }
assert.equal(upcomingWithin(later, 'm1', tz, now, 30).length, 0, 'событие через 40 мин вне окна')

// событие в прошлом не напоминаем
const wPast = wall(now - 5 * 60000, tz)
const past = { cards: { g: { id: 'g', title: 'Прошло', assigneeIds: ['m1'], date: wPast.date, start: wPast.start } } }
assert.equal(upcomingWithin(past, 'm1', tz, now, 30).length, 0, 'прошедшее не напоминаем')

console.log('OK: все проверки логики бота пройдены')
