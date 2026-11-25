import { ApiError, type Camera, type CameraInput, type ImportResult, type Role, type Segment, type User } from './apiTypes'
import { mockApi, mockCsvHref } from './demo/mock'

// Tipos e ApiError ficam em apiTypes.ts (o modo demo também precisa deles, sem import circular)
export * from './apiTypes'

// Chamado quando o servidor responde 401 (sessão expirou ou foi encerrada): a tela volta para o login
let onUnauthorized: () => void = () => {}
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn }

async function request<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (r.status === 401 && !url.startsWith('/api/auth/')) onUnauthorized()
  if (!r.ok) throw new ApiError(j.error || 'Erro na requisição', r.status, j)
  return j as T
}

const realApi = {
  // câmeras e grupos
  list: () => request<Camera[]>('/api/cameras'),
  create: (c: CameraInput) => request<Camera>('/api/cameras', 'POST', c),
  update: (id: string, c: Partial<CameraInput>) => request<Camera>('/api/cameras/' + id, 'PUT', c),
  setGroup: (ids: string[], group: string) => request<{ updated: number }>('/api/cameras/group', 'POST', { ids, group }),
  remove: (id: string) => request<{ ok: boolean }>('/api/cameras/' + id, 'DELETE', {}),
  setRecord: (id: string, enabled: boolean) => request<Camera>(`/api/cameras/${id}/record`, 'POST', { enabled }),
  groups: () => request<string[]>('/api/groups'),
  createGroup: (name: string) => request<string[]>('/api/groups', 'POST', { name }),
  renameGroup: (from: string, to: string) => request<string[]>('/api/groups', 'PUT', { from, to }),
  deleteGroup: (name: string) => request<{ moved: number }>('/api/groups?name=' + encodeURIComponent(name), 'DELETE', {}),
  segments: async (id: string, date: string) => (await request<{ segments: Segment[] }>(`/api/recordings/${id}?date=${date}`)).segments,

  // autenticação
  me: () => request<{ user: User }>('/api/auth/me'),
  setup: (username: string, password: string) => request<{ user: User }>('/api/auth/setup', 'POST', { username, password }),
  login: (username: string, password: string) => request<{ user: User }>('/api/auth/login', 'POST', { username, password }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', 'POST', {}),
  changePassword: (current: string, next: string) => request<{ ok: boolean }>('/api/auth/password', 'POST', { current, next }),

  // usuários (admin)
  users: () => request<User[]>('/api/users'),
  createUser: (username: string, password: string, role: Role) => request<User>('/api/users', 'POST', { username, password, role }),
  updateUser: (id: string, data: { role?: Role; password?: string }) => request<User>('/api/users/' + id, 'PUT', data),
  deleteUser: (id: string) => request<{ ok: boolean }>('/api/users/' + id, 'DELETE', {}),

  // exportação / importação
  exportConfig: (includePasswords: boolean, passphrase?: string) => request<Record<string, unknown>>('/api/export', 'POST', { includePasswords, passphrase }),
  importConfig: (config: unknown, mode: 'merge' | 'replace', passphrase?: string) => request<ImportResult>('/api/import', 'POST', { config, mode, passphrase }),
}

export const api: typeof realApi = import.meta.env.VITE_DEMO ? mockApi : realApi

// URL de um trecho gravado e do CSV de câmeras (no demo não existe servidor: usa um clipe de exemplo e um data: URL)
export const recUrl = (camId: string, file: string) => import.meta.env.VITE_DEMO ? `${import.meta.env.BASE_URL}demo/sample.mp4` : `/rec/${camId}/${file}`
export const csvHref = () => import.meta.env.VITE_DEMO ? mockCsvHref() : '/api/export/cameras.csv'
