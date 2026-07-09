// Хранение зашифрованного ключа доступа (auth.json) в ПУБЛИЧНОМ репозитории.
// Читается без токена (публичный репозиторий, Contents API поддерживает CORS),
// пишется владельцем с токеном при первичной настройке / смене пароля.

import { b64DecodeUtf8, b64EncodeUtf8 } from './utils'
import { blobNeedsRehash, decryptSecret, encryptSecret, isEncryptedBlob, type EncryptedBlob } from './crypto'
import { AUTH_REPO } from './config'

const API = 'https://api.github.com'

export class AuthError extends Error {}

interface FileMeta {
  content: EncryptedBlob | { configured: false }
  sha: string
}

async function ghJson(path: string, init: RequestInit = {}, token?: string): Promise<Response> {
  return fetch(`${API}${path}`, {
    ...init,
    cache: 'no-store', // всегда свежий ответ, мимо кэша браузера
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  })
}

function authPath(): string {
  const { owner, repo, path } = AUTH_REPO
  return `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`
}

/** Читает auth.json. null — файла/ветки нет (приложение ещё не настроено). */
async function loadAuthFile(): Promise<FileMeta | null> {
  const res = await ghJson(`${authPath()}?ref=${encodeURIComponent(AUTH_REPO.branch)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new AuthError(`Не удалось прочитать настройки входа (${res.status})`)
  const file = await res.json()
  const json = JSON.parse(b64DecodeUtf8(file.content))
  return { content: json, sha: file.sha }
}

export type AuthState =
  | { kind: 'unconfigured' }
  | { kind: 'configured'; blob: EncryptedBlob }

/** Определяет, настроен ли вход (есть ли зашифрованный ключ). */
export async function getAuthState(): Promise<AuthState> {
  const file = await loadAuthFile()
  if (!file || !isEncryptedBlob(file.content)) return { kind: 'unconfigured' }
  return { kind: 'configured', blob: file.content }
}

/** Проверяет пароль и возвращает расшифрованный токен. Бросает WrongPasswordError. */
export async function unlockToken(blob: EncryptedBlob, password: string): Promise<string> {
  const token = await decryptSecret(blob, password)
  // Одноразовая тихая миграция: старый auth.json (250 000 итераций PBKDF2)
  // не может проверить Telegram-бот на Cloudflare Workers (там лимит 100 000).
  // При первом же входе с паролем пере-шифровываем ключ на новое число итераций —
  // в фоне, не задерживая вход; ошибки (нет прав на запись/сеть) не мешают входу.
  if (blobNeedsRehash(blob)) {
    void saveEncryptedToken(token, password).catch(() => {
      /* миграцию повторит следующий вход */
    })
  }
  return token
}

/**
 * Сохраняет зашифрованный токен в auth.json (создаёт ветку app-config при
 * необходимости). Требует токен с правом записи в публичный репозиторий.
 */
export async function saveEncryptedToken(token: string, password: string): Promise<void> {
  const blob = await encryptSecret(token, password)
  const body = b64EncodeUtf8(JSON.stringify(blob, null, 2))

  await ensureBranch(token)
  // Узнаём текущий sha файла (если есть) для обновления
  let sha: string | undefined
  const cur = await ghJson(`${authPath()}?ref=${encodeURIComponent(AUTH_REPO.branch)}`, {}, token)
  if (cur.ok) sha = (await cur.json()).sha

  const res = await ghJson(
    authPath(),
    {
      method: 'PUT',
      body: JSON.stringify({
        message: 'Обновление ключа доступа',
        content: body,
        branch: AUTH_REPO.branch,
        ...(sha ? { sha } : {}),
      }),
    },
    token,
  )
  if (!res.ok) {
    const msg = await safeMessage(res)
    throw new AuthError(`Не удалось сохранить ключ доступа: ${msg}`)
  }
}

async function ensureBranch(token: string): Promise<void> {
  const { owner, repo, branch } = AUTH_REPO
  const exists = await ghJson(`/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`, {}, token)
  if (exists.ok) return
  if (exists.status !== 404) throw new AuthError(`Не удалось проверить ветку настроек (${exists.status})`)

  // Создаём ветку-сироту с заглушкой (blob -> tree -> commit без родителей -> ref)
  const placeholder = b64EncodeUtf8('{ "configured": false }')
  const blob = await ghJson(`/repos/${owner}/${repo}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: placeholder, encoding: 'base64' }) }, token)
  const blobSha = (await blob.json()).sha
  const tree = await ghJson(`/repos/${owner}/${repo}/git/trees`, { method: 'POST', body: JSON.stringify({ tree: [{ path: AUTH_REPO.path, mode: '100644', type: 'blob', sha: blobSha }] }) }, token)
  const treeSha = (await tree.json()).sha
  const commit = await ghJson(`/repos/${owner}/${repo}/git/commits`, { method: 'POST', body: JSON.stringify({ message: 'Служебная ветка настроек входа', tree: treeSha, parents: [] }) }, token)
  const commitSha = (await commit.json()).sha
  const ref = await ghJson(`/repos/${owner}/${repo}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commitSha }) }, token)
  if (!ref.ok && ref.status !== 422) throw new AuthError(`Не удалось создать ветку настроек (${ref.status})`)
}

async function safeMessage(res: Response): Promise<string> {
  try {
    const b = await res.json()
    return b?.message ? `${b.message} (${res.status})` : String(res.status)
  } catch {
    return String(res.status)
  }
}
