// Публикует ПУБЛИЧНЫЙ снимок таймлайна (timeline.json) в публичный репозиторий,
// чтобы внешняя страница-виджет (#timeline) читала его без авторизации и
// сама обновлялась. Запускается по расписанию из GitHub Actions.
//
// Читает board.json из ПРИВАТНОГО репозитория данных (DATA_TOKEN),
// пишет timeline.json в ветку app-config ПУБЛИЧНОГО репозитория (STATE_TOKEN),
// но только если содержимое изменилось (без «пустых» коммитов).

const DATA_TOKEN = process.env.DATA_TOKEN || ''
const STATE_TOKEN = process.env.STATE_TOKEN || ''

const DATA = {
  owner: process.env.DATA_OWNER || 'borinsobaka-lab',
  repo: process.env.DATA_REPO || 'task-tracker-data',
  branch: process.env.DATA_BRANCH || 'tasks-data',
  path: 'board.json',
}
const [stateOwner, stateRepo] = (process.env.GH_REPO || 'borinsobaka-lab/task-tracker').split('/')
const OUT = { owner: stateOwner, repo: stateRepo, branch: 'app-config', path: 'timeline.json' }

// Цвета приоритетов матрицы (совпадают с src/eisenhower.ts)
const QUADRANT_COLOR = { q1: '#ef4444', q2: '#eab308', q3: '#3b82f6', q4: '#22c55e' }

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
      message: 'Обновление публичного таймлайна',
      content: Buffer.from(JSON.stringify(obj, null, 2), 'utf8').toString('base64'),
      branch: repo.branch,
      ...(sha ? { sha } : {}),
    }),
  })
  if (!res.ok) throw new Error(`PUT ${repo.repo}/${repo.path}: ${res.status} ${await res.text()}`)
}

/** Снимок задач для таймлайна: только запланированные и только публичные поля. */
export function buildTimeline(board) {
  const memberById = new Map((board.members || []).filter((m) => !m.archived).map((m) => [m.id, m]))
  const items = Object.values(board.cards || {})
    .filter((c) => c && !c.deleted && c.date)
    .map((c) => ({
      id: c.id,
      title: c.title || 'Без названия',
      date: c.date,
      ...(c.start ? { start: c.start } : {}),
      ...(c.durationMin ? { durationMin: c.durationMin } : {}),
      ...(c.kind ? { kind: c.kind } : {}),
      ...(c.done ? { done: true } : {}),
      ...(c.priority ? { priorityColor: QUADRANT_COLOR[c.priority] } : {}),
      members: (c.assigneeIds || [])
        .map((id) => memberById.get(id))
        .filter(Boolean)
        .map((m) => ({ id: m.id, name: m.name, color: m.color })),
    }))
    .sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')))
  return { items }
}

async function main() {
  if (!DATA_TOKEN) {
    console.log('DATA_TOKEN не задан — публиковать нечего, пропускаю.')
    return
  }
  const { json: board } = await ghGet(DATA, DATA_TOKEN)
  if (!board) throw new Error('board.json не найден в репозитории данных.')

  const payload = buildTimeline(board)
  const existing = await ghGet(OUT, STATE_TOKEN)
  // Коммитим только при реальных изменениях списка задач
  if (JSON.stringify(existing.json?.items) === JSON.stringify(payload.items)) {
    console.log('Таймлайн не изменился — коммит не нужен.')
    return
  }
  const out = { generatedAt: new Date().toISOString(), items: payload.items }
  await ghPut(OUT, STATE_TOKEN, out, existing.sha)
  console.log(`timeline.json обновлён: ${payload.items.length} задач.`)
}

import { fileURLToPath } from 'node:url'
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  main().catch((e) => {
    console.error('Ошибка публикации таймлайна:', e.message)
    process.exit(1)
  })
}
