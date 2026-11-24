// Ao vivo multiplexado: todas as células da tela compartilham UMA conexão com o servidor.
// (O navegador limita 6 conexões HTTP por servidor; com uma por câmera, as demais ficavam esperando.)
// Protocolo: [tipo 1B][índice 1B][tamanho 4B BE][dados] — tipo 0=frame JPEG, 1=erro (texto), 2=prévia JPEG

export type LiveEvent = { type: 'frame' | 'preview'; blob: Blob } | { type: 'error'; msg: string }
type Listener = (ev: LiveEvent) => void

class LiveMux {
  private listeners = new Map<string, Set<Listener>>()
  private ctrl: AbortController | null = null
  private keys: string[] = []
  private timer: ReturnType<typeof setTimeout> | undefined

  subscribe(key: string, fn: Listener) {
    let set = this.listeners.get(key)
    if (!set) this.listeners.set(key, (set = new Set()))
    set.add(fn)
    this.schedule()
    return () => {
      set!.delete(fn)
      if (!set!.size) this.listeners.delete(key)
      this.schedule()
    }
  }

  // agrupa mudanças (troca de página/layout) numa única reconexão
  private schedule(delay = 60) {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.connect(), delay)
  }

  private async connect() {
    const keys = [...this.listeners.keys()].sort()
    if (this.ctrl && keys.join() === this.keys.join()) return
    this.ctrl?.abort()
    this.ctrl = null
    this.keys = keys
    if (!keys.length) return
    const ctrl = new AbortController()
    this.ctrl = ctrl
    try {
      const r = await fetch('/api/live?s=' + encodeURIComponent(keys.join(',')), { signal: ctrl.signal })
      if (!r.body) throw new Error('sem corpo')
      const reader = r.body.getReader()
      let buf = new Uint8Array(0)
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        const nb = new Uint8Array(buf.length + value.length)
        nb.set(buf); nb.set(value, buf.length); buf = nb
        let off = 0
        while (buf.length - off >= 6) {
          const type = buf[off], idx = buf[off + 1]
          const len = ((buf[off + 2] << 24) >>> 0) + (buf[off + 3] << 16) + (buf[off + 4] << 8) + buf[off + 5]
          if (buf.length - off - 6 < len) break
          const payload = buf.slice(off + 6, off + 6 + len)
          off += 6 + len
          this.dispatch(keys[idx], type, payload)
        }
        buf = buf.slice(off)
      }
    } catch { /* abortado ou rede caiu */ }
    if (this.ctrl === ctrl) { this.ctrl = null; this.keys = []; this.schedule(2000) } // reconecta sozinho
  }

  private dispatch(key: string | undefined, type: number, payload: Uint8Array) {
    const set = key ? this.listeners.get(key) : undefined
    if (!set) return
    const ev: LiveEvent = type === 1
      ? { type: 'error', msg: new TextDecoder().decode(payload) }
      : { type: type === 2 ? 'preview' : 'frame', blob: new Blob([payload as BlobPart], { type: 'image/jpeg' }) }
    for (const fn of set) fn(ev)
  }
}

export const live = new LiveMux()
