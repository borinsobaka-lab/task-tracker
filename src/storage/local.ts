// Локальное хранилище (localStorage) — для демо-режима и тестов.
// Ведёт себя как удалённое: имеет ревизии и умеет «конфликтовать».

import type { Attachment, BoardData } from '../types'
import { ConflictError, type RemoteState, type StorageAdapter } from './adapter'
import { normalizeBoard } from '../merge'
import { nowISO, uid } from '../utils'

const DATA_KEY = 'tt.local.data'
const REV_KEY = 'tt.local.rev'
const ATT_PREFIX = 'tt.local.att.'

export class LocalAdapter implements StorageAdapter {
  readonly kind = 'local' as const

  async load(): Promise<RemoteState | null> {
    const raw = localStorage.getItem(DATA_KEY)
    if (!raw) return null
    return { data: normalizeBoard(JSON.parse(raw) as BoardData), rev: localStorage.getItem(REV_KEY) ?? '0' }
  }

  async init(data: BoardData): Promise<RemoteState> {
    const existing = await this.load()
    if (existing) return existing
    localStorage.setItem(DATA_KEY, JSON.stringify(data))
    localStorage.setItem(REV_KEY, '1')
    return { data, rev: '1' }
  }

  async save(data: BoardData, baseRev: string): Promise<{ rev: string }> {
    const currentRev = localStorage.getItem(REV_KEY) ?? '0'
    if (currentRev !== baseRev) {
      const remote = await this.load()
      if (remote) throw new ConflictError(remote)
    }
    const rev = String(Number(currentRev) + 1)
    localStorage.setItem(DATA_KEY, JSON.stringify(data))
    localStorage.setItem(REV_KEY, rev)
    return { rev }
  }

  async uploadAttachment(cardId: string, file: File, uploadedBy?: string): Promise<Attachment> {
    if (file.size > 500 * 1024) throw new Error('В демо-режиме вложения ограничены 500 КБ')
    const id = uid()
    const path = `local/${cardId}/${id}`
    const buf = await file.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    localStorage.setItem(ATT_PREFIX + path, JSON.stringify({ b64: btoa(bin), mime: file.type }))
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
    localStorage.removeItem(ATT_PREFIX + att.path)
  }

  async downloadAttachment(att: Attachment): Promise<Blob> {
    const raw = localStorage.getItem(ATT_PREFIX + att.path)
    if (!raw) throw new Error('Файл не найден')
    const { b64, mime } = JSON.parse(raw)
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new Blob([bytes], { type: mime || 'application/octet-stream' })
  }
}
