// API simulada no navegador para o build "demo" (hospedagem estática, sem servidor nem FFmpeg).
// Mesma forma da API real (lib/api.ts): câmeras, grupos, usuários, gravações e exportação, tudo em memória.
import { ApiError, type Camera, type CameraInput, type ImportResult, type Role, type Segment, type User } from '../apiTypes'

type DemoCam = Camera & { demoSeed: number; demoOffline: boolean; recFrom: number | null; recUntil: number | null }
type DemoUser = User & { password: string }

const LAYOUT: Record<string, string[]> = {
  'Entrada': ['Portaria Principal', 'Portão da Garagem', 'Recepção', 'Catraca 1'],
  'Estacionamento': ['Estacionamento A', 'Estacionamento B', 'Rampa do Subsolo', 'Cancela'],
  'Escritório': ['Sala de Reuniões', 'Open Space', 'Copa', 'Corredor 2º andar'],
  'Depósito': ['Doca de Carga', 'Estoque 1', 'Estoque 2', 'Perímetro Externo'],
}
const OFFLINE = new Set(['Estoque 2']) // uma câmera "caída", para mostrar o estado de erro
const RECORDING = 3                    // as primeiras já aparecem gravando, com 6 h de histórico

const now = Date.now()
const BRANDS = ['hikvision', 'intelbras', 'dahua']
let seq = 0
const cams: DemoCam[] = Object.entries(LAYOUT).flatMap(([group, names]) => names.map((name) => {
  const i = seq++
  return {
    id: `demo-cam-${String(i + 1).padStart(2, '0')}`, name, brand: BRANDS[i % 3], host: `10.0.0.${10 + i}`, port: 554, user: 'admin',
    group, record: i < RECORDING, online: !OFFLINE.has(name), hasPassword: true,
    demoSeed: i + 1, demoOffline: OFFLINE.has(name), recFrom: i < RECORDING ? now - 6 * 3600e3 : null, recUntil: null,
  }
}))
let groups = Object.keys(LAYOUT)

export const demoAccounts = [
  { username: 'admin', password: 'demo1234', role: 'admin' as Role },
  { username: 'visitante', password: 'visitante1', role: 'operator' as Role },
]
const users: DemoUser[] = demoAccounts.map((a, i) => ({ id: `u${i + 1}`, username: a.username, password: a.password, role: a.role, createdAt: new Date(now - 30 * 86400e3).toISOString() }))

const KEY = 'vms.demo.user'
const store = { get: () => { try { return sessionStorage.getItem(KEY) } catch { return null } }, set: (v: string | null) => { try { v ? sessionStorage.setItem(KEY, v) : sessionStorage.removeItem(KEY) } catch { /* ignora */ } } }
const current = () => users.find((u) => u.id === store.get()) ?? null
const pub = (u: DemoUser): User => ({ id: u.id, username: u.username, role: u.role, createdAt: u.createdAt })
const need = (admin = false) => {
  const u = current()
  if (!u) throw new ApiError('Não autenticado', 401, { demo: demoAccounts })
  if (admin && u.role !== 'admin') throw new ApiError('Sem permissão para esta ação', 403)
  return u
}
const publicCam = (c: DemoCam): Camera => {
  const { demoSeed: _a, demoOffline: _b, recFrom: _c, recUntil: _d, ...rest } = c
  void _a; void _b; void _c; void _d
  return { ...rest }
}
const find = (id: string) => { const c = cams.find((x) => x.id === id); if (!c) throw new ApiError('Câmera não encontrada', 404); return c }
const delay = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 60))

// usado pelo ao vivo simulado
export const demoCamera = (id: string) => cams.find((c) => c.id === id)

// ---- gravações simuladas: trechos de 60 s a cada 5 min, com lacunas (determinístico por câmera) ----
const p2 = (n: number) => String(n).padStart(2, '0')
function segmentsFor(c: DemoCam, date: string): Segment[] {
  if (c.recFrom === null) return []
  const [y, m, d] = date.split('-').map(Number)
  const dayStart = new Date(y, m - 1, d).getTime()
  const from = Math.max(dayStart, c.recFrom - (c.recFrom % 300000))
  const to = Math.min(dayStart + 86400000, (c.recUntil ?? Date.now()) - 70000)
  const out: Segment[] = []
  let rnd = c.demoSeed * 9301 + 49297
  for (let t = from; t < to; t += 300000) {
    rnd = (rnd * 9301 + 49297) % 233280
    if (rnd / 233280 < 0.3) continue
    const s = new Date(t)
    out.push({ file: `${s.getFullYear()}${p2(s.getMonth() + 1)}${p2(s.getDate())}_${p2(s.getHours())}${p2(s.getMinutes())}${p2(s.getSeconds())}.mp4`, start: t, end: t + 60000, size: 520000 + (rnd % 90000) })
  }
  return out
}

const csv = () => ['Nome;Grupo;IP;Porta;Status;Gravando', ...cams.map((c) => [c.name, c.group || '', c.host, c.port, c.online ? 'online' : 'offline', c.record ? 'sim' : 'não'].join(';'))].join('\r\n')
export const mockCsvHref = () => 'data:text/csv;charset=utf-8,' + encodeURIComponent('﻿' + csv())

const checkGroup = (g: string) => { g = g.trim(); if (g.length > 60) throw new ApiError('Nome do grupo muito longo (máx. 60)', 400); return g }
const ensureGroup = (g: string) => { if (g && !groups.includes(g)) groups = [...groups, g] }
const allGroups = () => [...new Set([...groups, ...cams.map((c) => c.group).filter(Boolean)])].sort((a, b) => a.localeCompare(b, 'pt-BR'))

const raw = {
  list: () => { need(); return delay(cams.map(publicCam)) },
  create: (c: CameraInput) => {
    need(true)
    if (!c.name?.trim() || !c.host?.trim()) throw new ApiError('Nome e IP são obrigatórios', 400)
    const g = checkGroup(c.group || ''); ensureGroup(g)
    const cam: DemoCam = { id: crypto.randomUUID(), name: c.name.trim(), brand: c.brand || 'generic', host: c.host.trim(), port: c.port || 554, user: c.user || '', group: g,
      record: false, online: true, hasPassword: !!c.pass, mainPath: c.mainPath, subPath: c.subPath, demoSeed: 20 + cams.length, demoOffline: false, recFrom: null, recUntil: null }
    cams.push(cam)
    return delay(publicCam(cam))
  },
  update: (id: string, c: Partial<CameraInput>) => {
    need(true)
    const cam = find(id)
    if (c.name !== undefined) cam.name = c.name.trim() || cam.name
    if (c.brand !== undefined) cam.brand = c.brand
    if (c.host !== undefined) cam.host = c.host.trim() || cam.host
    if (c.port !== undefined) cam.port = c.port
    if (c.user !== undefined) cam.user = c.user
    if (c.mainPath !== undefined) cam.mainPath = c.mainPath
    if (c.subPath !== undefined) cam.subPath = c.subPath
    if (c.pass) cam.hasPassword = true
    if (c.group !== undefined) { cam.group = checkGroup(c.group); ensureGroup(cam.group) }
    return delay(publicCam(cam))
  },
  setGroup: (ids: string[], group: string) => {
    need(true)
    const g = checkGroup(group); ensureGroup(g)
    let n = 0
    for (const c of cams) if (ids.includes(c.id)) { c.group = g; n++ }
    return delay({ updated: n })
  },
  remove: (id: string) => { need(true); find(id); cams.splice(cams.findIndex((c) => c.id === id), 1); return delay({ ok: true }) },
  setRecord: (id: string, enabled: boolean) => {
    need(true)
    const cam = find(id)
    if (enabled && !cam.record) { cam.record = true; cam.recFrom ??= Date.now(); cam.recUntil = null }
    if (!enabled && cam.record) { cam.record = false; cam.recUntil = Date.now() }
    return delay(publicCam(cam))
  },
  groups: () => { need(); return delay(allGroups()) },
  createGroup: (name: string) => { need(true); const g = checkGroup(name); if (!g) throw new ApiError('Nome obrigatório', 400); ensureGroup(g); return delay(allGroups()) },
  renameGroup: (from: string, to: string) => {
    need(true)
    const t = checkGroup(to)
    groups = groups.map((g) => (g === from ? t : g)).filter((g, i, a) => a.indexOf(g) === i)
    for (const c of cams) if (c.group === from) c.group = t
    return delay(allGroups())
  },
  deleteGroup: (name: string) => {
    need(true)
    let moved = 0
    for (const c of cams) if (c.group === name) { c.group = ''; moved++ }
    groups = groups.filter((g) => g !== name)
    return delay({ moved })
  },
  segments: async (id: string, date: string) => { need(); return delay(segmentsFor(find(id), date)) },

  me: () => { const u = need(); return delay({ user: pub(u) }) },
  setup: (_u: string, _p: string): Promise<{ user: User }> => Promise.reject(new ApiError('O sistema já foi configurado', 409)),
  login: (username: string, password: string) => {
    const u = users.find((x) => x.username.toLowerCase() === username.toLowerCase())
    if (!u || u.password !== password) return Promise.reject(new ApiError('Usuário ou senha incorretos', 401))
    store.set(u.id)
    return delay({ user: pub(u) })
  },
  logout: () => { store.set(null); return delay({ ok: true }) },
  changePassword: (current_: string, next: string) => {
    const u = need()
    if (u.password !== current_) throw new ApiError('Senha atual incorreta', 400)
    if (next.length < 8) throw new ApiError('A nova senha precisa ter pelo menos 8 caracteres', 400)
    u.password = next
    return delay({ ok: true })
  },

  users: () => { need(true); return delay(users.map(pub)) },
  createUser: (username: string, password: string, role: Role) => {
    need(true)
    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) throw new ApiError('Usuário inválido (3 a 32 letras, números, . _ -)', 400)
    if (password.length < 8) throw new ApiError('A senha precisa ter pelo menos 8 caracteres', 400)
    if (users.some((u) => u.username.toLowerCase() === username.toLowerCase())) throw new ApiError('Esse usuário já existe', 409)
    const u: DemoUser = { id: crypto.randomUUID(), username, password, role, createdAt: new Date().toISOString() }
    users.push(u)
    return delay(pub(u))
  },
  updateUser: (id: string, data: { role?: Role; password?: string }) => {
    need(true)
    const u = users.find((x) => x.id === id)
    if (!u) throw new ApiError('Usuário não encontrado', 404)
    if (data.role) {
      if (u.role === 'admin' && data.role !== 'admin' && users.filter((x) => x.role === 'admin').length < 2) throw new ApiError('Precisa existir pelo menos um administrador', 400)
      u.role = data.role
    }
    if (data.password) u.password = data.password
    return delay(pub(u))
  },
  deleteUser: (id: string) => {
    const me = need(true)
    const u = users.find((x) => x.id === id)
    if (!u) throw new ApiError('Usuário não encontrado', 404)
    if (u.id === me.id) throw new ApiError('Você não pode excluir a si mesmo', 400)
    users.splice(users.indexOf(u), 1)
    return delay({ ok: true })
  },

  exportConfig: (_includePasswords: boolean, _passphrase?: string) => {
    need(true)
    return delay<Record<string, unknown>>({
      app: 'mini-vms', version: 1, demo: true, exportedAt: new Date().toISOString(), groups: allGroups(),
      cameras: cams.map((c) => ({ name: c.name, brand: c.brand, host: c.host, port: c.port, user: c.user, group: c.group })),
    })
  },
  importConfig: (config: unknown, mode: 'merge' | 'replace', _passphrase?: string) => {
    need(true)
    const list = ((config as { cameras?: Partial<CameraInput>[] })?.cameras ?? [])
    const res: ImportResult = { added: 0, updated: 0, removed: 0, invalid: [], withoutPassword: 0 }
    if (mode === 'replace') { res.removed = cams.length; cams.length = 0 }
    for (const item of list) {
      if (!item.host || !item.name) { res.invalid.push(String(item.name ?? item.host ?? '?')); continue }
      const port = Number(item.port || 554)
      const ex = cams.find((c) => c.host === item.host && c.port === port)
      if (ex) { ex.name = item.name; ex.group = item.group ?? ex.group; res.updated++; continue }
      const g = (item.group || '').trim(); ensureGroup(g)
      cams.push({ id: crypto.randomUUID(), name: item.name, brand: item.brand || 'generic', host: item.host, port, user: item.user || '', group: g, record: false, online: true,
        hasPassword: false, demoSeed: 20 + cams.length, demoOffline: false, recFrom: null, recUntil: null })
      res.added++; res.withoutPassword++
    }
    return delay(res)
  },
}

// erros síncronos (permissão, sessão) viram promessas rejeitadas, como numa chamada de rede de verdade
type Fns = typeof raw
export const mockApi = Object.fromEntries(Object.entries(raw).map(([k, fn]) => [k, (...a: unknown[]) => {
  try { return Promise.resolve((fn as (...x: unknown[]) => unknown)(...a)) } catch (e) { return Promise.reject(e) }
}])) as unknown as { [K in keyof Fns]: (...a: Parameters<Fns[K]>) => Promise<Awaited<ReturnType<Fns[K]>>> }
