// Ao vivo simulado para o build "demo": cada "câmera" é desenhada num <canvas> (fundo animado, nome, relógio e um vulto
// em movimento) e entregue como JPEG, no mesmo formato que o servidor real manda. Um canal por câmera/qualidade, compartilhado.
import type { LiveEvent } from '../live'
import { demoCamera } from './mock'

type Listener = (ev: LiveEvent) => void
type Channel = { subs: Set<Listener>; timer?: ReturnType<typeof setInterval>; stop?: ReturnType<typeof setTimeout>; last?: Blob }

const QUALITY: Record<string, { w: number; fps: number }> = { low: { w: 320, fps: 5 }, sub: { w: 640, fps: 8 }, main: { w: 1280, fps: 12 } }
const channels = new Map<string, Channel>()

function render(ctx: CanvasRenderingContext2D, w: number, h: number, name: string, seed: number, t: number) {
  const hue = (seed * 47 + t * 5) % 360
  const a = t * 0.04 + seed
  const g = ctx.createLinearGradient(w / 2 - Math.cos(a) * w, h / 2 - Math.sin(a) * h, w / 2 + Math.cos(a) * w, h / 2 + Math.sin(a) * h)
  g.addColorStop(0, `hsl(${hue} 55% 42%)`)
  g.addColorStop(0.5, `hsl(${(hue + 60) % 360} 60% 55%)`)
  g.addColorStop(1, `hsl(${(hue + 140) % 360} 50% 38%)`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  // um "vulto" cruza a cena, em velocidade e altura diferentes por câmera
  const bw = h / 6, bh = h / 3
  const x = (t * (12 + (seed % 5) * 6) * (w / 640) + seed * 40) % (w - bw)
  ctx.fillStyle = 'rgba(255,255,255,.7)'
  ctx.fillRect(x, h * (0.35 + (seed % 3) * 0.1), bw, bh)
  const fs = Math.max(8, Math.round(h / 26)), pad = fs / 2
  ctx.font = `${fs}px sans-serif`
  ctx.textBaseline = 'top'
  const label = (text: string, px: number, py: number, right = false) => {
    const tw = ctx.measureText(text).width
    const lx = right ? px - tw - pad : px
    ctx.fillStyle = 'rgba(0,0,0,.45)'
    ctx.fillRect(lx - 4, py - 3, tw + 8, fs + 6)
    ctx.fillStyle = '#fff'
    ctx.fillText(text, lx, py)
  }
  label(name, pad + 4, pad)
  label(new Date().toLocaleString('pt-BR'), w - pad - 4, h - fs - pad - 3, true)
}

function start(key: string, ch: Channel) {
  const [camId, q] = key.split(':')
  const cam = demoCamera(camId)
  if (!cam || cam.demoOffline) {
    setTimeout(() => { for (const fn of ch.subs) fn({ type: 'error', msg: 'Sem sinal: conexão recusada' }) }, 500)
    return
  }
  const Q = QUALITY[q] ?? QUALITY.sub
  const w = Q.w, h = Math.round((w * 9) / 16 / 2) * 2
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const origin = performance.now()
  let busy = false
  const tick = () => {
    if (busy || document.hidden || !ch.subs.size) return
    busy = true
    render(ctx, w, h, cam.name, cam.demoSeed, (performance.now() - origin) / 1000 + cam.demoSeed * 10)
    canvas.toBlob((blob) => {
      busy = false
      if (!blob) return
      ch.last = blob
      for (const fn of ch.subs) fn({ type: 'frame', blob })
    }, 'image/jpeg', 0.72)
  }
  setTimeout(tick, 150 + Math.random() * 350) // conexão "demora" um pouco, como no servidor
  ch.timer = setInterval(tick, 1000 / Q.fps)
}

export const mockLive = {
  subscribe(key: string, fn: Listener) {
    let ch = channels.get(key)
    if (!ch) { ch = { subs: new Set() }; channels.set(key, ch); start(key, ch) }
    clearTimeout(ch.stop)
    ch.subs.add(fn)
    if (ch.last) fn({ type: 'frame', blob: ch.last })
    const c = ch
    return () => {
      c.subs.delete(fn)
      if (!c.subs.size) c.stop = setTimeout(() => { clearInterval(c.timer); if (channels.get(key) === c) channels.delete(key) }, 5000)
    }
  },
}
