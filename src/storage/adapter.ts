// Интерфейс хранилища данных доски.

import type { Attachment, BoardData } from '../types'

export interface RemoteState {
  data: BoardData
  /** Ревизия (blob sha у GitHub); нужна для оптимистичных блокировок */
  rev: string
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
  /** null — хранилище ещё не инициализировано (нет ветки/файла) */
  load(): Promise<RemoteState | null>
  /** Создаёт хранилище с начальными данными (идемпотентно) */
  init(data: BoardData): Promise<RemoteState>
  /** Сохраняет данные поверх ревизии baseRev; бросает ConflictError при гонке */
  save(data: BoardData, baseRev: string): Promise<{ rev: string }>
  /** ownerId — id карточки или заметки (папка файла); id — заранее выбранный id вложения (необязательно) */
  uploadAttachment(ownerId: string, file: File, uploadedBy?: string, id?: string): Promise<Attachment>
  deleteAttachment(att: Attachment): Promise<void>
  downloadAttachment(att: Attachment): Promise<Blob>
}
