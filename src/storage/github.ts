// Хранилище данных в GitHub-репозитории через REST Contents API.
// Данные (board.json + вложения) живут в отдельной ветке, которая создаётся
// «сиротой» (без истории кода), чтобы не смешиваться с исходниками.

import type { Attachment, BoardData } from '../types'
import type { DataRepoConfig } from '../config'
import { ConflictError, type RemoteState, type StorageAdapter } from './adapter'
import { normalizeBoard } from '../merge'
import { b64DecodeUtf8, b64EncodeUtf8, fileToBase64, nowISO, sanitizeFileName, uid } from '../utils'

const API = 'https://api.github.com'
const BOARD_FILE = 'board.json'

export class GitHubApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'GitHubApiError'
  }
}

interface GitHubAuth extends DataRepoConfig {
  token: string
}

async function api<T = any>(auth: GitHubAuth, path: string, init: RequestInit = {}, accept = 'application/vnd.github+json'): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${auth.token}`,
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) {
    let msg = `GitHub API: ${res.status}`
    try {
      const body = await res.json()
      if (body?.message) msg = `${body.message} (${res.status})`
    } catch {
      /* тело не JSON */
    }
    throw new GitHubApiError(res.status, msg)
  }
  if (res.status === 204) return undefined as T
  if (accept === 'application/vnd.github.raw+json') {
    return (await res.blob()) as T
  }
  return (await res.json()) as T
}

function encPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

/** Проверка токена и прав доступа к репозиторию (для экрана входа) */
export async function validateAccess(auth: GitHubAuth): Promise<{ ok: boolean; canPush: boolean; error?: string }> {
  try {
    const repo = await api<any>(auth, `/repos/${auth.owner}/${auth.repo}`)
    const canPush = !!repo?.permissions?.push
    return { ok: true, canPush }
  } catch (e) {
    const err = e as GitHubApiError
    if (err.status === 401) return { ok: false, canPush: false, error: 'Токен не принят GitHub. Проверьте, что скопировали его целиком.' }
    if (err.status === 404) return { ok: false, canPush: false, error: 'Репозиторий недоступен этому токену. Убедитесь, что у токена есть доступ (scope «repo») и что вам выдан доступ к репозиторию.' }
    return { ok: false, canPush: false, error: err.message || 'Не удалось связаться с GitHub' }
  }
}

export class GitHubAdapter implements StorageAdapter {
  readonly kind = 'github' as const

  constructor(private auth: GitHubAuth) {}

  private get repoPath(): string {
    return `/repos/${this.auth.owner}/${this.auth.repo}`
  }

  async load(): Promise<RemoteState | null> {
    let file: any
    try {
      file = await api<any>(this.auth, `${this.repoPath}/contents/${BOARD_FILE}?ref=${encodeURIComponent(this.auth.branch)}`)
    } catch (e) {
      if ((e as GitHubApiError).status === 404) return null // нет ветки или файла — нужна инициализация
      throw e
    }
    let content: string | undefined = file.content
    if (!content && file.sha) {
      // Файлы больше ~1 МБ приходят без содержимого — берём blob напрямую
      const blob = await api<any>(this.auth, `${this.repoPath}/git/blobs/${file.sha}`)
      content = blob.content
    }
    if (!content) throw new Error('Не удалось прочитать board.json')
    const data = JSON.parse(b64DecodeUtf8(content)) as BoardData
    return { data: normalizeBoard(data), rev: file.sha }
  }

  async init(data: BoardData): Promise<RemoteState> {
    const existing = await this.load()
    if (existing) return existing

    const branchExists = await this.branchExists()
    const json = JSON.stringify(data, null, 2)

    if (branchExists) {
      // Ветка есть, файла нет — просто кладём файл
      await api(this.auth, `${this.repoPath}/contents/${BOARD_FILE}`, {
        method: 'PUT',
        body: JSON.stringify({
          message: 'Инициализация доски задач',
          content: b64EncodeUtf8(json),
          branch: this.auth.branch,
        }),
      })
    } else {
      // Создаём ветку-сироту: blob -> tree -> commit без родителей -> ref
      try {
        const blob = await api<any>(this.auth, `${this.repoPath}/git/blobs`, {
          method: 'POST',
          body: JSON.stringify({ content: b64EncodeUtf8(json), encoding: 'base64' }),
        })
        const tree = await api<any>(this.auth, `${this.repoPath}/git/trees`, {
          method: 'POST',
          body: JSON.stringify({ tree: [{ path: BOARD_FILE, mode: '100644', type: 'blob', sha: blob.sha }] }),
        })
        const commit = await api<any>(this.auth, `${this.repoPath}/git/commits`, {
          method: 'POST',
          body: JSON.stringify({ message: 'Инициализация доски задач', tree: tree.sha, parents: [] }),
        })
        await api(this.auth, `${this.repoPath}/git/refs`, {
          method: 'POST',
          body: JSON.stringify({ ref: `refs/heads/${this.auth.branch}`, sha: commit.sha }),
        })
      } catch (e) {
        // 422 — ветку успел создать кто-то другой; ниже просто перечитаем
        if ((e as GitHubApiError).status !== 422) throw e
      }
    }

    const loaded = await this.load()
    if (!loaded) throw new Error('Не удалось инициализировать хранилище данных')
    return loaded
  }

  async save(data: BoardData, baseRev: string): Promise<{ rev: string }> {
    const json = JSON.stringify(data, null, 2)
    try {
      const res = await api<any>(this.auth, `${this.repoPath}/contents/${BOARD_FILE}`, {
        method: 'PUT',
        body: JSON.stringify({
          message: `Обновление задач — ${nowISO()}`,
          content: b64EncodeUtf8(json),
          sha: baseRev,
          branch: this.auth.branch,
        }),
      })
      return { rev: res.content.sha }
    } catch (e) {
      const err = e as GitHubApiError
      // 409 (конфликт) или 422 (sha устарел) — данные менял кто-то другой
      if (err.status === 409 || err.status === 422) {
        const remote = await this.load()
        if (remote) throw new ConflictError(remote)
      }
      throw e
    }
  }

  async uploadAttachment(cardId: string, file: File, uploadedBy?: string): Promise<Attachment> {
    const id = uid()
    const path = `attachments/${cardId}/${id.slice(0, 8)}_${sanitizeFileName(file.name)}`
    const content = await fileToBase64(file)
    await api(this.auth, `${this.repoPath}/contents/${encPath(path)}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `Вложение: ${file.name}`,
        content,
        branch: this.auth.branch,
      }),
    })
    return {
      id,
      name: file.name,
      path,
      size: file.size,
      mime: file.type || 'application/octet-stream',
      uploadedAt: nowISO(),
      uploadedBy,
    }
  }

  async deleteAttachment(att: Attachment): Promise<void> {
    try {
      const meta = await api<any>(this.auth, `${this.repoPath}/contents/${encPath(att.path)}?ref=${encodeURIComponent(this.auth.branch)}`)
      await api(this.auth, `${this.repoPath}/contents/${encPath(att.path)}`, {
        method: 'DELETE',
        body: JSON.stringify({
          message: `Удаление вложения: ${att.name}`,
          sha: meta.sha,
          branch: this.auth.branch,
        }),
      })
    } catch (e) {
      if ((e as GitHubApiError).status === 404) return // уже удалено
      throw e
    }
  }

  async downloadAttachment(att: Attachment): Promise<Blob> {
    return api<Blob>(
      this.auth,
      `${this.repoPath}/contents/${encPath(att.path)}?ref=${encodeURIComponent(this.auth.branch)}`,
      {},
      'application/vnd.github.raw+json',
    )
  }

  private async branchExists(): Promise<boolean> {
    try {
      await api(this.auth, `${this.repoPath}/branches/${encodeURIComponent(this.auth.branch)}`)
      return true
    } catch (e) {
      if ((e as GitHubApiError).status === 404) return false
      throw e
    }
  }
}
