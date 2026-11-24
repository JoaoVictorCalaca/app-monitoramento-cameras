export type Camera = {
  id: string; name: string; brand: string; host: string; port: number; user: string
  mainPath?: string; subPath?: string; group: string
  record?: boolean; recError?: string; online: boolean | null
}
export type CameraInput = {
  name: string; brand: string; host: string; port: number; user: string; pass: string; group: string
  mainPath?: string; subPath?: string
}
export type Segment = { file: string; start: number; end: number; size: number }

async function send<T>(url: string, method: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Erro ao salvar')
  return j
}

export const api = {
  list: async (): Promise<Camera[]> => (await fetch('/api/cameras')).json(),
  create: (c: CameraInput) => send<Camera>('/api/cameras', 'POST', c),
  update: (id: string, c: Partial<CameraInput>) => send<Camera>('/api/cameras/' + id, 'PUT', c),
  setGroup: (ids: string[], group: string) => send<{ updated: number }>('/api/cameras/group', 'POST', { ids, group }),
  remove: (id: string) => send<{ ok: boolean }>('/api/cameras/' + id, 'DELETE'),
  setRecord: (id: string, enabled: boolean) => send<Camera>(`/api/cameras/${id}/record`, 'POST', { enabled }),
  segments: async (id: string, date: string): Promise<Segment[]> => {
    const r = await fetch(`/api/recordings/${id}?date=${date}`)
    if (!r.ok) throw new Error('Erro ao listar gravações')
    return (await r.json()).segments
  },
}
