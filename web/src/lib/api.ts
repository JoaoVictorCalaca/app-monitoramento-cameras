export type Camera = {
  id: string; name: string; brand: string; host: string; port: number; user: string
  mainPath?: string; subPath?: string; group: string
  record?: boolean; recError?: string; online: boolean | null; hasPassword?: boolean
}
export type CameraInput = {
  name: string; brand: string; host: string; port: number; user: string; pass: string; group?: string
  mainPath?: string; subPath?: string
}
export type Segment = { file: string; start: number; end: number; size: number }
export type Role = 'admin' | 'operator'
export type User = { id: string; username: string; role: Role; createdAt: string }
export type ImportResult = { added: number; updated: number; removed: number; invalid: string[]; withoutPassword: number }

export class ApiError extends Error {
  status: number
  data: Record<string, unknown>
  constructor(message: string, status: number, data: Record<string, unknown> = {}) {
    super(message)
    this.status = status
    this.data = data
  }
}

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

export const api = {
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
