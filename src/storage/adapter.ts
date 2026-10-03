// Интерфейс хранилища данных доски.

import type { Attachment, BoardData } from '../types'

export interface RemoteState {
  data: BoardData
  /** Ревизия (blob sha у GitHub); нужна для оптимистичных блокировок */
  rev: string
  /** ETag ответа сервера — для условных запросов (необязательно) */
  etag?: string
}

/** Данные на сервере изменились с момента нашей последней загрузки */
export class ConflictError extends Error {
  constructor(public remote: RemoteState) {
    super('Данные изменились на сервере')
    this.name = 'ConflictError'
  }
}

export interface StorageAdapter {
  readonly kind: 'github' | 'local'
  /** Ключ копии данных на устройстве (какой репозиторий/ветка); нет — не кэшируем */
  readonly cacheKey?: string
  /** null — хранилище ещё не инициализировано (нет ветки/файла) */
  load(): Promise<RemoteState | null>
  /** Как load(), но если на сервере всё ещё ревизия knownRev — 'unchanged' без скачивания данных */
  loadIfChanged?(knownRev: string, etag?: string): Promise<RemoteState | null | 'unchanged'>
  /** Создаёт хранилище с начальными данными (идемпотентно) */
  init(data: BoardData): Promise<RemoteState>
  /** Сохраняет данные поверх ревизии baseRev; бросает ConflictError при гонке */
  save(data: BoardData, baseRev: string): Promise<{ rev: string }>
  /** ownerId — id карточки или заметки (папка файла); id — заранее выбранный id вложения (необязательно) */
  uploadAttachment(ownerId: string, file: File, uploadedBy?: string, id?: string): Promise<Attachment>
  deleteAttachment(att: Attachment): Promise<void>
  downloadAttachment(att: Attachment): Promise<Blob>
}
