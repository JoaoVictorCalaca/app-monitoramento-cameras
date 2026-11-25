import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Download, Film, SkipBack, SkipForward } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api, type Camera, type Segment } from '@/lib/api'

const DAY = 86400000
const pad = (n: number) => String(n).padStart(2, '0')
const toDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const dayStartOf = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).getTime() }
const clock = (ms: number) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` }

export function Playback({ cams, camId, setCamId }: { cams: Camera[]; camId: string | null; setCamId: (id: string) => void }) {
  const [date, setDate] = useState(() => toDate(new Date()))
  const [segs, setSegs] = useState<Segment[]>([])
  const [curSeg, setCurSeg] = useState<Segment | null>(null)
  const [cursor, setCursor] = useState<number | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [rate, setRate] = useState('1')
  const video = useRef<HTMLVideoElement>(null)
  const pending = useRef(0)
  const dayStart = dayStartOf(date)
  const cam = cams.find((c) => c.id === camId)

  useEffect(() => { if (!camId && cams[0]) setCamId(cams[0].id) }, [camId, cams, setCamId])

  const refresh = useCallback(async () => {
    if (!camId) return
    try { setSegs(await api.segments(camId, date)) } catch { toast.error('Erro ao listar gravações') }
  }, [camId, date])

  useEffect(() => {
    setCurSeg(null); setCursor(null); setSegs([])
    refresh()
    const t = setInterval(refresh, 30000) // novos segmentos aparecem sozinhos
    return () => clearInterval(t)
  }, [refresh])

  function seek(t: number) {
    const seg = segs.find((s) => s.start <= t && t < s.end) ?? segs.find((s) => s.start > t)
    if (!seg) { toast.info('Sem gravação a partir deste horário'); return }
    const offset = Math.max(0, (t - seg.start) / 1000)
    if (curSeg?.file === seg.file && video.current) { video.current.currentTime = offset; video.current.play().catch(() => {}) }
    else { pending.current = offset; setCurSeg(seg) }
  }

  function onEnded() {
    const i = segs.findIndex((s) => s.file === curSeg?.file)
    if (i >= 0 && segs[i + 1]) { pending.current = 0; setCurSeg(segs[i + 1]) }
  }

  function shiftDay(delta: number) { setDate(toDate(new Date(dayStart + delta * DAY + 3600000))) }
  const pct = (t: number) => Math.min(100, Math.max(0, ((t - dayStart) / DAY) * 100))
  const frac = (e: React.MouseEvent<HTMLDivElement>) => { const r = e.currentTarget.getBoundingClientRect(); return (e.clientX - r.left) / r.width }

  const url = curSeg && camId ? `/rec/${camId}/${curSeg.file}` : undefined

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={camId ?? ''} onValueChange={(v) => v && setCamId(v)}>
          <SelectTrigger className="w-full sm:w-56"><SelectValue placeholder="Câmera">{cam?.name}</SelectValue></SelectTrigger>
          <SelectContent>{cams.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
        </Select>
        <Button size="icon-sm" variant="outline" onClick={() => shiftDay(-1)}><ChevronLeft /></Button>
        <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="min-w-0 flex-1 sm:w-40 sm:flex-none" />
        <Button size="icon-sm" variant="outline" onClick={() => shiftDay(1)}><ChevronRight /></Button>
        <div className="flex-1" />
        <Button size="icon-sm" variant="outline" disabled={!curSeg} onClick={() => { if (video.current) video.current.currentTime -= 10 }}><SkipBack /></Button>
        <Button size="icon-sm" variant="outline" disabled={!curSeg} onClick={() => { if (video.current) video.current.currentTime += 10 }}><SkipForward /></Button>
        <Select value={rate} onValueChange={(v) => { if (!v) return; setRate(v); if (video.current) video.current.playbackRate = Number(v) }}>
          <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
          <SelectContent>{['0.5', '1', '2', '4', '8'].map((r) => <SelectItem key={r} value={r}>{r}×</SelectItem>)}</SelectContent>
        </Select>
        {curSeg && (
          <Button size="sm" variant="outline" render={<a href={url} download={`${cam?.name ?? 'camera'}_${curSeg.file}`} />}><Download />Baixar trecho</Button>
        )}
      </div>

      <div className="relative flex min-h-[40vw] flex-1 items-center justify-center overflow-hidden rounded-lg border bg-black">
        {url ? (
          <video
            ref={video} src={url} controls autoPlay className="h-full w-full object-contain"
            onLoadedMetadata={(e) => { e.currentTarget.currentTime = pending.current; e.currentTarget.playbackRate = Number(rate); e.currentTarget.play().catch(() => {}) }}
            onTimeUpdate={(e) => curSeg && setCursor(curSeg.start + e.currentTarget.currentTime * 1000)}
            onEnded={onEnded}
            onError={() => toast.error('Não foi possível reproduzir este trecho (câmera em H.265? o navegador pode não suportar)')}
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
            <Film className="size-8 opacity-40" />
            {!cam ? 'Cadastre uma câmera para ver gravações' : segs.length ? 'Clique na linha do tempo para reproduzir' : cam.record ? 'Sem trechos prontos neste dia (os trechos aparecem a cada fechamento de arquivo)' : 'Nenhuma gravação neste dia. Ative a gravação (REC) na barra lateral.'}
          </div>
        )}
      </div>

      <div>
        <div className="mb-1 flex justify-between text-xs text-muted-foreground">
          <span>{cursor ? clock(cursor) : hover !== null ? clock(dayStart + hover * DAY) : ' '}</span>
          <span>{segs.length} trecho(s)</span>
        </div>
        <div
          className="relative h-12 cursor-pointer overflow-hidden rounded-md border bg-muted/40"
          onClick={(e) => seek(dayStart + frac(e) * DAY)}
          onMouseMove={(e) => setHover(frac(e))}
          onMouseLeave={() => setHover(null)}
        >
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="absolute inset-y-0 border-l border-border/60" style={{ left: `${(h / 24) * 100}%` }} />
          ))}
          {segs.map((s) => (
            <div key={s.file} className={'absolute inset-y-2 rounded-sm ' + (curSeg?.file === s.file ? 'bg-primary' : 'bg-primary/50')}
              style={{ left: `${pct(s.start)}%`, width: `${Math.max(0.15, pct(s.end) - pct(s.start))}%` }} />
          ))}
          {cursor && <div className="absolute inset-y-0 w-0.5 bg-red-500" style={{ left: `${pct(cursor)}%` }} />}
          {hover !== null && <div className="absolute inset-y-0 w-px bg-foreground/40" style={{ left: `${hover * 100}%` }} />}
        </div>
        <div className="relative mt-1 h-4 text-[10px] text-muted-foreground">
          {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => (
            <span key={h} className="absolute -translate-x-1/2" style={{ left: `${(h / 24) * 100}%`, marginLeft: h === 0 ? 8 : 0 }}>{pad(h)}h</span>
          ))}
        </div>
      </div>
    </div>
  )
}
