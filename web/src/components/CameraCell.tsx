import { memo, useEffect, useRef, useState } from 'react'
import { Camera as CameraIcon, Circle, Loader2, Maximize2, Minimize2, RotateCcw, VideoOff } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { live } from '@/lib/live'
import type { Camera } from '@/lib/api'

type State = 'connecting' | 'preview' | 'live' | 'error'

export const CameraCell = memo(function CameraCell({ cam, hd, low, onToggleFocus, onToggleRec }: {
  cam: Camera; hd: boolean; low: boolean; onToggleFocus: (id: string) => void; onToggleRec?: (c: Camera) => void // sem onToggleRec = sem permissão para gravar
}) {
  const q = hd ? 'main' : low ? 'low' : 'sub' // grades 5x5+ usam resolução menor
  const [state, setState] = useState<State>('connecting')
  const [msg, setMsg] = useState('')
  const img = useRef<HTMLImageElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const lastBlob = useRef<Blob | null>(null)
  const urlRef = useRef<string | null>(null)
  const stateRef = useRef<State>('connecting')

  // zoom digital (só na visualização ampliada): roda do mouse aproxima, arrastar move
  const [zoom, setZoom] = useState({ s: 1, x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const set = (s: State) => { if (stateRef.current !== s) { stateRef.current = s; setState(s) } }
    set('connecting')
    const off = live.subscribe(`${cam.id}:${q}`, (ev) => {
      if (ev.type === 'error') { setMsg(ev.msg); set('error'); return }
      // frames vão direto para o <img>, sem re-renderizar o React a cada quadro
      lastBlob.current = ev.blob
      const url = URL.createObjectURL(ev.blob)
      if (img.current) img.current.src = url
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      urlRef.current = url
      if (ev.type === 'frame') set('live')
      else if (stateRef.current !== 'live') set('preview')
    })
    return () => {
      off()
      if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null }
    }
  }, [cam.id, q])

  useEffect(() => { if (!hd) setZoom({ s: 1, x: 0, y: 0 }) }, [hd])

  function snapshot() {
    if (!lastBlob.current) return toast.error('Sem imagem para capturar')
    const a = document.createElement('a')
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    a.href = URL.createObjectURL(lastBlob.current)
    a.download = `${cam.name.replace(/[^\w-]+/g, '_')}_${ts}.jpg`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    toast.success('Captura salva')
  }

  // limita o deslocamento para a imagem sempre cobrir a janela (antes dava para arrastá-la para fora e sobrava só preto)
  function clamp(s: number, x: number, y: number) {
    const el = box.current
    if (!el || s <= 1) return { s: 1, x: 0, y: 0 }
    const mx = (el.clientWidth * (s - 1)) / 2, my = (el.clientHeight * (s - 1)) / 2
    return { s, x: Math.min(mx, Math.max(-mx, x)), y: Math.min(my, Math.max(-my, y)) }
  }

  // listener nativo não-passivo: precisa de preventDefault para a roda não rolar a página
  const wheelRef = useRef<(e: WheelEvent) => void>(() => {})
  wheelRef.current = (e: WheelEvent) => {
    if (!hd || !box.current) return
    e.preventDefault()
    const r = box.current.getBoundingClientRect()
    const px = e.clientX - r.left - r.width / 2, py = e.clientY - r.top - r.height / 2
    setZoom((z) => {
      const s = Math.min(8, Math.max(1, z.s * (e.deltaY < 0 ? 1.2 : 1 / 1.2)))
      const k = s / z.s // mantém o ponto sob o cursor parado
      return clamp(s, px - (px - z.x) * k, py - (py - z.y) * k)
    })
  }
  useEffect(() => {
    const el = box.current
    if (!el) return
    const fn = (e: WheelEvent) => wheelRef.current(e)
    el.addEventListener('wheel', fn, { passive: false })
    return () => el.removeEventListener('wheel', fn)
  }, [])

  const showImg = state === 'live' || state === 'preview'
  const tool = 'bg-black/60 text-white backdrop-blur hover:bg-black/80'

  return (
    <div
      className="group relative flex items-center justify-center overflow-hidden rounded-md border bg-black select-none"
      ref={box}
      onDoubleClick={() => onToggleFocus(cam.id)}
      onMouseDown={(e) => { if (zoom.s > 1) drag.current = { x: e.clientX - zoom.x, y: e.clientY - zoom.y } }}
      onMouseMove={(e) => { const d = drag.current; if (d) { const nx = e.clientX - d.x, ny = e.clientY - d.y; setZoom((z) => clamp(z.s, nx, ny)) } }}
      onMouseUp={() => { drag.current = null }}
      onMouseLeave={() => { drag.current = null }}
    >
      <img
        ref={img}
        alt={cam.name}
        draggable={false}
        style={{ transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})`, cursor: zoom.s > 1 ? 'grab' : undefined }}
        className={'h-full w-full object-contain ' + (showImg ? '' : 'invisible ') + (state === 'preview' ? 'opacity-50 grayscale' : '')}
      />
      {state !== 'live' && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-3 text-center text-muted-foreground">
          {state === 'error' ? <VideoOff className="size-5 text-destructive" /> : <Loader2 className="size-5 animate-spin" />}
          <span className="line-clamp-2 text-[11px]">{state === 'error' ? msg || 'Sem sinal' : 'Conectando…'}</span>
        </div>
      )}
      <div className="pointer-events-none absolute left-1.5 top-1.5 flex max-w-[calc(100%-12px)] items-center gap-1">
        <Badge variant="secondary" className="truncate bg-black/60 text-white backdrop-blur">{cam.name}</Badge>
        {state === 'live' && !low && <Badge className="gap-1 bg-red-600 text-white"><span className="size-1.5 animate-pulse rounded-full bg-white" />AO VIVO</Badge>}
        {hd && <Badge variant="outline" className="bg-black/60 text-white">HD</Badge>}
        {cam.record && <Badge className="gap-1 bg-black/60 text-white"><span className="size-1.5 rounded-full bg-red-500" />REC</Badge>}
        {zoom.s > 1 && <Badge variant="outline" className="bg-black/60 text-white">{zoom.s.toFixed(1)}×</Badge>}
      </div>
      {/* barra de ferramentas da janela (como no iVMS): captura, gravação, zoom, ampliar */}
      <div className="absolute bottom-1.5 right-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100" onDoubleClick={(e) => e.stopPropagation()}>
        <Tooltip><TooltipTrigger render={<Button size="icon-xs" className={tool} onClick={snapshot} />}><CameraIcon /></TooltipTrigger><TooltipContent>Capturar imagem</TooltipContent></Tooltip>
        {onToggleRec && <Tooltip><TooltipTrigger render={<Button size="icon-xs" className={tool} onClick={() => onToggleRec(cam)} />}><Circle className={cam.record ? 'fill-red-500 text-red-500' : ''} /></TooltipTrigger><TooltipContent>{cam.record ? 'Parar gravação' : 'Gravar'}</TooltipContent></Tooltip>}
        {zoom.s > 1 && <Tooltip><TooltipTrigger render={<Button size="icon-xs" className={tool} onClick={() => setZoom({ s: 1, x: 0, y: 0 })} />}><RotateCcw /></TooltipTrigger><TooltipContent>Desfazer zoom</TooltipContent></Tooltip>}
        <Tooltip><TooltipTrigger render={<Button size="icon-xs" className={tool} onClick={() => onToggleFocus(cam.id)} />}>{hd ? <Minimize2 /> : <Maximize2 />}</TooltipTrigger><TooltipContent>{hd ? 'Voltar à grade' : 'Ampliar (zoom digital com a roda do mouse)'}</TooltipContent></Tooltip>
      </div>
    </div>
  )
})
