// Настройки подключения к хранилищу данных.
// По умолчанию данные живут в этом же репозитории в отдельной ветке tasks-data.
// При желании можно указать другой (например, приватный) репозиторий в настройках.

export interface DataRepoConfig {
  owner: string
  repo: string
  branch: string
}

export const DEFAULT_DATA_REPO: DataRepoConfig = {
  owner: 'borinsobaka-lab',
  repo: 'task-tracker',
  branch: 'tasks-data',
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

export function getSavedView(): 'board' | 'calendar' {
  return localStorage.getItem(LS.view) === 'calendar' ? 'calendar' : 'board'
}
export function setSavedView(v: 'board' | 'calendar'): void {
  localStorage.setItem(LS.view, v)
}

/** Демо-режим: локальное хранилище вместо GitHub (для тестов и предпросмотра) */
export function isDemoMode(): boolean {
  if (typeof location === 'undefined') return false
  return new URLSearchParams(location.search).has('demo') || localStorage.getItem(LS.demo) === '1'
}
