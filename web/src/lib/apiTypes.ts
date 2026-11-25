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

// Build "demo" (vite --mode demo): sem servidor; API e vídeo são simulados no navegador (hospedagem estática, ex.: Vercel)
export const IS_DEMO = !!import.meta.env.VITE_DEMO
