// Настройки подключения к хранилищу.
//
// Схема «закрытые данные + пароль»:
//  - Код приложения и зашифрованный ключ (auth.json) — в ПУБЛИЧНОМ репозитории
//    task-tracker (ветка app-config). Читается без токена.
//  - Задачи и вложения — в ОТДЕЛЬНОМ ПРИВАТНОМ репозитории (по умолчанию
//    task-tracker-data). Доступ к ним даёт только расшифрованный паролем ключ.

export interface DataRepoConfig {
  owner: string
  repo: string
  branch: string
}

/** Приватный репозиторий с данными (по умолчанию). Владелец создаёт его сам. */
export const DEFAULT_DATA_REPO: DataRepoConfig = {
  owner: 'borinsobaka-lab',
  repo: 'task-tracker-data',
  branch: 'tasks-data',
}

/** Публичный репозиторий, где лежит зашифрованный ключ доступа. */
export const AUTH_REPO = {
  owner: 'borinsobaka-lab',
  repo: 'task-tracker',
  branch: 'app-config',
  path: 'auth.json',
}

const LS = {
  token: 'tt.token',
  identity: 'tt.identity',
  dataRepo: 'tt.dataRepo',
  view: 'tt.view',
  demo: 'tt.demo',
}

export function getDataRepoConfig(): DataRepoConfig {
  try {
    const raw = localStorage.getItem(LS.dataRepo)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed.owner && parsed.repo && parsed.branch) return parsed
    }
  } catch {
    /* игнорируем битые данные */
  }
  return DEFAULT_DATA_REPO
}

export function setDataRepoConfig(cfg: DataRepoConfig | null): void {
  if (cfg) localStorage.setItem(LS.dataRepo, JSON.stringify(cfg))
  else localStorage.removeItem(LS.dataRepo)
}

/** Кэш расшифрованного токена на этом устройстве (чтобы не вводить пароль каждый раз). */
export function getToken(): string | null {
  return localStorage.getItem(LS.token)
}
export function setToken(token: string | null): void {
  if (token) localStorage.setItem(LS.token, token)
  else localStorage.removeItem(LS.token)
}

export function getIdentity(): string | null {
  return localStorage.getItem(LS.identity)
}
export function setIdentityId(id: string | null): void {
  if (id) localStorage.setItem(LS.identity, id)
  else localStorage.removeItem(LS.identity)
}

export type SavedView = 'board' | 'calendar' | 'matrix' | 'recurring'
export function getSavedView(): SavedView {
  const v = localStorage.getItem(LS.view)
  return v === 'calendar' || v === 'matrix' || v === 'recurring' ? v : 'board'
}
export function setSavedView(v: SavedView): void {
  localStorage.setItem(LS.view, v)
}

/** Сколько дней показывать в календаре: 1 / 3 / 7. По умолчанию — 3 на телефоне, 7 иначе. */
export function getCalDays(): number {
  const v = Number(localStorage.getItem('tt.calDays'))
  if (v === 1 || v === 3 || v === 7) return v
  if (typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches) return 3
  return 7
}
export function setCalDays(n: number): void {
  localStorage.setItem('tt.calDays', String(n))
}

/** Демо-режим: локальное хранилище вместо GitHub (для тестов и предпросмотра) */
export function isDemoMode(): boolean {
  if (typeof location === 'undefined') return false
  return new URLSearchParams(location.search).has('demo') || localStorage.getItem(LS.demo) === '1'
}
