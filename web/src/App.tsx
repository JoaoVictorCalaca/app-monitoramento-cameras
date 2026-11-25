import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  CctvIcon, ChevronLeft, ChevronRight, Circle, Expand, FolderOpen, LayoutGrid,
  PanelLeftClose, PanelLeftOpen, Play, Plus, Repeat, Search, Video, X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { CameraCell } from '@/components/CameraCell'
import { confirmDialog } from '@/components/ConfirmHost'
import { DocsLink } from '@/components/DocsLink'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { CameraTree, NO_GROUP } from '@/components/CameraTree'
import { ThemeToggle } from '@/components/ThemeToggle'
import { UserMenu } from '@/components/UserMenu'
import { lazy, Suspense } from 'react'
import { api, type Camera, type User } from '@/lib/api'
import { useIsMobile } from '@/lib/mobile'

const LAYOUTS = [1, 2, 3, 4, 5, 6, 7, 8] // até 8x8 = 64 câmeras por página
const MOBILE_LAYOUTS = [1, 2, 3] // no celular: 1 coluna (padrão), 2 ou 3
const SEQ_OPTIONS = [10, 20, 30, 60]

const ls = {
  get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* ignora */ } },
}

// Filtro: nome ou IP (parcial), ou faixa de IP "192.168.1.10-50"
function matcher(query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return () => true
  const range = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.)(\d{1,3})\s*-\s*(\d{1,3})$/.exec(q)
  if (range) {
    const [, prefix, a, b] = range
    const lo = Math.min(+a, +b), hi = Math.max(+a, +b)
    return (c: Camera) => c.host.startsWith(prefix) && +c.host.slice(prefix.length) >= lo && +c.host.slice(prefix.length) <= hi
  }
  return (c: Camera) => c.host.toLowerCase().includes(q) || c.name.toLowerCase().includes(q) || (c.group || '').toLowerCase().includes(q)
}

function StatusDot({ online }: { online: boolean | null }) {
  const cls = online === true ? 'bg-emerald-500' : online === false ? 'bg-red-500' : 'bg-muted-foreground/40'
  return <span className={'size-2 shrink-0 rounded-full ' + cls} title={online === true ? 'Online' : online === false ? 'Offline' : 'Verificando'} />
}

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])
  return <span className="tabular-nums">{now.toLocaleDateString('pt-BR')} {now.toLocaleTimeString('pt-BR')}</span>
}

// telas pesadas só são baixadas quando usadas
const Playback = lazy(() => import('@/components/Playback').then((m) => ({ default: m.Playback })))
const CameraDialog = lazy(() => import('@/components/CameraDialog').then((m) => ({ default: m.CameraDialog })))

export default function App({ user, onLogout }: { user: User; onLogout: () => void }) {
  const canEdit = user.role === 'admin' // operador só visualiza
  const [cams, setCams] = useState<Camera[]>([])
  const mobile = useIsMobile()
  const [drawer, setDrawer] = useState(false) // gaveta da lista de câmeras (só no celular)
  const [layoutD, setLayout] = useState(() => Math.min(8, Math.max(1, Number(ls.get('layout')) || 2)))
  const [layoutM, setLayoutM] = useState(() => Math.min(3, Math.max(1, Number(ls.get('layoutM')) || 1)))
  const layout = mobile ? layoutM : layoutD
  const [focus, setFocus] = useState<string | null>(null)
  const [dialog, setDialog] = useState<{ open: boolean; camera?: Camera }>({ open: false })
  const [groups, setGroups] = useState<string[]>([])
  const [view, setView] = useState<'live' | 'playback'>('live')
  const [pbCam, setPbCam] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(() => ls.get('sidebar') === 'closed')
  const [query, setQuery] = useState('')
  const [groupFilter, setGroupFilter] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [seq, setSeq] = useState(false)
  const [seqSec, setSeqSec] = useState(20)
  const gridRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const [c, g] = await Promise.all([api.list(), api.groups()])
      setCams(c); setGroups(g)
    } catch { toast.error('Servidor indisponível') }
  }, [])
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t) }, [load])

  const toggleSidebar = useCallback(() => {
    setCollapsed((c) => { ls.set('sidebar', c ? 'open' : 'closed'); return !c })
  }, [])

  // ---- filtros e grupos ----
  const match = useMemo(() => matcher(query), [query])
  const searched = useMemo(() => cams.filter(match), [cams, match])
  const filtered = useMemo(() => groupFilter === null ? searched : searched.filter((c) => (c.group || NO_GROUP) === groupFilter), [searched, groupFilter])

  // ---- paginação e sequência automática (troca de página sozinha, como no iVMS) ----
  const perPage = layout * layout
  const pages = Math.max(1, Math.ceil(filtered.length / perPage))
  useEffect(() => { setPage(0) }, [query, groupFilter, layout])
  useEffect(() => { if (page >= pages) setPage(pages - 1) }, [page, pages])
  useEffect(() => {
    if (!seq || pages < 2 || focus || view !== 'live') return
    const t = setInterval(() => setPage((p) => (p + 1) % pages), seqSec * 1000)
    return () => clearInterval(t)
  }, [seq, seqSec, pages, focus, view])

  const n = focus ? 1 : layout
  // celular: telas altas, então a grade só tem colunas e as janelas ficam em 16:9 com rolagem
  const rowsAuto = mobile && !focus
  const visible = focus ? cams.filter((c) => c.id === focus) : filtered.slice(page * perPage, page * perPage + perPage)

  // atalhos: Ctrl+B barra lateral, ←/→ páginas, Esc sai da câmera ampliada
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest('input, textarea, [contenteditable]')
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleSidebar(); return }
      if (typing || view !== 'live') return
      if (e.key === 'Escape') setFocus(null)
      if (!focus && e.key === 'ArrowRight') setPage((p) => (p + 1) % pages)
      if (!focus && e.key === 'ArrowLeft') setPage((p) => (p - 1 + pages) % pages)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleSidebar, pages, focus, view])

  async function remove(c: Camera) {
    if (!await confirmDialog({ title: `Remover "${c.name}"?`, description: 'As gravações já feitas ficam em disco até a retenção apagá-las.', confirmText: 'Remover' })) return
    try {
      await api.remove(c.id)
      if (focus === c.id) setFocus(null)
      toast.success('Câmera removida')
      load()
    } catch (e) { toast.error((e as Error).message) }
  }

  // callbacks estáveis: as janelas (React.memo) não re-renderizam quando só o relógio/estado do App muda
  const toggleFocus = useCallback((id: string) => setFocus((f) => (f ? null : id)), [])
  const recRef = useRef<(c: Camera) => void>(() => {})
  const recStable = useCallback((c: Camera) => recRef.current(c), [])
  async function toggleRec(c: Camera) {
    try {
      await api.setRecord(c.id, !c.record)
      toast.success(c.record ? `Gravação de "${c.name}" parada` : `Gravando "${c.name}"`)
      load()
    } catch (e) { toast.error((e as Error).message) }
  }

  recRef.current = toggleRec

  function pick(c: Camera) {
    setDrawer(false)
    if (view === 'playback') { setPbCam(c.id); return }
    setFocus(focus === c.id ? null : c.id)
  }

  // deslizar para os lados troca de página (celular)
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const onSwipeStart = (e: React.TouchEvent) => { swipe.current = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null }
  const onSwipeEnd = (e: React.TouchEvent) => {
    const s0 = swipe.current; swipe.current = null
    if (!s0 || focus || pages < 2) return
    const dx = e.changedTouches[0].clientX - s0.x, dy = e.changedTouches[0].clientY - s0.y
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2) setPage((p) => (dx < 0 ? (p + 1) % pages : (p - 1 + pages) % pages))
  }

  const counts = useMemo(() => ({
    online: cams.filter((c) => c.online === true).length,
    offline: cams.filter((c) => c.online === false).length,
    rec: cams.filter((c) => c.record).length,
  }), [cams])

  return (
    <TooltipProvider>
      <div className="flex h-dvh flex-col bg-background pt-[env(safe-area-inset-top)] text-foreground">
        <div className="flex min-h-0 flex-1">
          {mobile && drawer && <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setDrawer(false)} />}
          <aside className={mobile
            ? 'fixed inset-y-0 left-0 z-50 w-[85vw] max-w-80 overflow-hidden border-r bg-card pt-[env(safe-area-inset-top)] transition-transform duration-200 ' + (drawer ? 'translate-x-0' : '-translate-x-full')
            : 'shrink-0 overflow-hidden bg-card transition-[width] duration-200 ' + (collapsed ? 'w-0' : 'w-72 border-r')}>
            <div className={'flex h-full flex-col ' + (mobile ? 'w-full' : 'w-72')}>
              <CameraTree
                top={<>
              <div className="flex items-center gap-2 px-4 py-4">
                <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground"><CctvIcon className="size-4" /></div>
                <div className="leading-tight">
                  <div className="text-sm font-semibold">Mini VMS</div>
                  <div className="text-xs text-muted-foreground">Monitoramento de câmeras</div>
                </div>
              </div>
              <Separator />
              <div className="space-y-2 px-3 py-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input onContextMenu={(e) => e.stopPropagation()} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filtrar por IP ou nome" className="h-8 pl-8 pr-8" />
                  {query && (
                    <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setQuery('')} aria-label="Limpar filtro">
                      <X className="size-4" />
                    </button>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {query ? `${searched.length} de ${cams.length} câmeras` : `${cams.length} câmeras · dica: faixa 192.168.1.10-50`}
                </div>
              </div>
              <Separator />
                </>}
                cams={cams} match={match} filtering={!!query.trim()} groups={groups}
                activeId={view === 'playback' ? pbCam : focus}
                groupFilter={groupFilter}
                onGroupFilter={(g) => { setGroupFilter(g); setFocus(null); if (g !== null) setView('live') }}
                onPick={pick} onToggleRec={toggleRec} onRemove={remove}
                onEdit={(c) => setDialog({ open: true, camera: c })}
                onAddCamera={() => setDialog({ open: true })}
                canEdit={canEdit}
                reload={load}
                bottom={<><Separator /><div className="space-y-1 p-3">{canEdit && <Button className="w-full" onClick={() => setDialog({ open: true })}><Plus />Adicionar câmera</Button>}<DocsLink /></div></>}
              />
            </div>
          </aside>

          <main className="flex min-w-0 flex-1 flex-col">
            <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2 max-md:gap-1.5 max-md:px-2">
              <Tooltip>
                <TooltipTrigger render={<Button size="icon-sm" variant="ghost" onClick={mobile ? () => setDrawer(true) : toggleSidebar} />}>
                  {mobile ? <Video /> : collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
                </TooltipTrigger>
                <TooltipContent>{mobile ? 'Lista de câmeras' : `${collapsed ? 'Mostrar' : 'Recolher'} barra lateral (Ctrl+B)`}</TooltipContent>
              </Tooltip>
              {mobile ? <span className="text-sm font-semibold">Mini VMS</span> : <Tabs value={view} onValueChange={(v) => setView(v as 'live' | 'playback')}>
                <TabsList>
                  <TabsTrigger value="live">Ao vivo</TabsTrigger>
                  <TabsTrigger value="playback">Gravações</TabsTrigger>
                </TabsList>
              </Tabs>}
              {view === 'live' && focus && <Button size="sm" variant="outline" onClick={() => setFocus(null)}><ChevronLeft />Voltar à grade</Button>}
              {view === 'live' && groupFilter !== null && !focus && (
                <Badge variant="secondary" className="gap-1">
                  <FolderOpen className="size-3" />{groupFilter}
                  <button onClick={() => setGroupFilter(null)} aria-label="Remover filtro de grupo"><X className="size-3" /></button>
                </Badge>
              )}
              {view === 'live' && query && !focus && <Badge variant="secondary" className="gap-1"><Search className="size-3" />{query}</Badge>}
              <div className="flex-1" />
              {view === 'live' && !focus && (
                <>
                  <div className="flex items-center gap-1">
                    <Button size="icon-sm" variant="ghost" disabled={pages < 2} onClick={() => setPage((p) => (p - 1 + pages) % pages)}><ChevronLeft /></Button>
                    <span className="min-w-16 text-center text-xs tabular-nums text-muted-foreground">Página {page + 1}/{pages}</span>
                    <Button size="icon-sm" variant="ghost" disabled={pages < 2} onClick={() => setPage((p) => (p + 1) % pages)}><ChevronRight /></Button>
                  </div>
                  <div className="flex items-center gap-1 max-md:hidden">
                    <Tooltip>
                      <TooltipTrigger render={<Button size="icon-sm" variant={seq ? 'default' : 'ghost'} disabled={pages < 2} onClick={() => setSeq((s) => !s)} />}>
                        <Repeat />
                      </TooltipTrigger>
                      <TooltipContent>{seq ? 'Parar sequência' : 'Sequência automática de páginas'}</TooltipContent>
                    </Tooltip>
                    {seq && (
                      <Select value={String(seqSec)} onValueChange={(v) => v && setSeqSec(Number(v))}>
                        <SelectTrigger size="sm" className="w-20"><SelectValue>{seqSec}s</SelectValue></SelectTrigger>
                        <SelectContent>{SEQ_OPTIONS.map((s) => <SelectItem key={s} value={String(s)}>{s}s</SelectItem>)}</SelectContent>
                      </Select>
                    )}
                  </div>
                  <Separator orientation="vertical" className="h-5 max-md:hidden" />
                  <div className="flex items-center gap-1.5">
                    <LayoutGrid className="size-4 text-muted-foreground" />
                    <Select value={String(layout)} onValueChange={(v) => { if (!v) return; setFocus(null); if (mobile) { setLayoutM(Number(v)); ls.set('layoutM', v) } else { setLayout(Number(v)); ls.set('layout', v) } }}>
                      <SelectTrigger size="sm" className="w-20"><SelectValue>{layout}×{layout}</SelectValue></SelectTrigger>
                      <SelectContent>{(mobile ? MOBILE_LAYOUTS : LAYOUTS).map((v) => <SelectItem key={v} value={String(v)}>{v}×{v} ({v * v})</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </>
              )}
              {view === 'live' && !mobile && (
                <Tooltip>
                  <TooltipTrigger render={<Button size="icon-sm" variant="outline" onClick={() => gridRef.current?.requestFullscreen()} />}>
                    <Expand />
                  </TooltipTrigger>
                  <TooltipContent>Tela cheia (só as câmeras)</TooltipContent>
                </Tooltip>
              )}
              <Separator orientation="vertical" className="h-5 max-md:hidden" />
              <ThemeToggle />
              {!mobile && <UserMenu user={user} onLogout={onLogout} onDataChanged={load} />}
            </header>

            {view === 'live' ? (
              <div ref={gridRef} className={'grid min-h-0 flex-1 gap-1 bg-background p-1.5 ' + (rowsAuto ? 'auto-rows-min content-start overflow-y-auto overscroll-contain' : '')}
                onTouchStart={mobile ? onSwipeStart : undefined} onTouchEnd={mobile ? onSwipeEnd : undefined}
                style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, ...(rowsAuto ? {} : { gridTemplateRows: `repeat(${n}, minmax(0, 1fr))` }) }}>
                {Array.from({ length: rowsAuto ? visible.length : n * n }, (_, i) => {
                  const c = visible[i]
                  return c ? (
                    <ErrorBoundary key={c.id + (focus ? '-hd' : '')} compact><div className={rowsAuto ? 'aspect-video' : 'contents'}><CameraCell cam={c} hd={!!focus} low={layout >= 5}
                      onToggleFocus={toggleFocus} onToggleRec={canEdit ? recStable : undefined} /></div></ErrorBoundary>
                  ) : (
                    <div key={'e' + i} className="flex items-center justify-center rounded-md border border-dashed text-muted-foreground/30"><CctvIcon className="size-4" /></div>
                  )
                })}
              </div>
            ) : (
              <Suspense fallback={null}><Playback cams={cams} camId={pbCam} setCamId={setPbCam} /></Suspense>
            )}
          </main>
        </div>

        {/* barra de status, como no rodapé do iVMS */}
        <footer className="flex items-center gap-4 border-t bg-card px-3 py-1 text-[11px] text-muted-foreground max-md:hidden">
          <span className="flex items-center gap-1.5"><StatusDot online={true} />{counts.online} online</span>
          <span className="flex items-center gap-1.5"><StatusDot online={false} />{counts.offline} offline</span>
          <span>{cams.length} câmeras</span>
          <span className="flex items-center gap-1.5"><Circle className="size-2.5 fill-red-500 text-red-500" />{counts.rec} gravando</span>
          {view === 'live' && !focus && <span>Exibindo {visible.length} de {filtered.length}</span>}
          <div className="flex-1" />
          <Clock />
        </footer>

        {/* navegação inferior (celular) */}
        {mobile && (
          <nav className="flex border-t bg-card pb-[env(safe-area-inset-bottom)]">
            {([['live', 'Ao vivo', Video], ['playback', 'Gravações', Play]] as const).map(([v, label, Icon]) => (
              <button key={v} onClick={() => { setView(v); setDrawer(false) }}
                className={'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ' + (view === v ? 'text-primary' : 'text-muted-foreground')}>
                <Icon className="size-5" />{label}
              </button>
            ))}
            <button onClick={() => setDrawer(true)} className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] text-muted-foreground">
              <CctvIcon className="size-5" />
              <span className="flex items-center gap-1"><StatusDot online={counts.offline ? false : true} />{counts.online}/{cams.length}</span>
            </button>
            <UserMenu nav user={user} onLogout={onLogout} onDataChanged={load} />
          </nav>
        )}
      </div>
      {dialog.open && <Suspense fallback={null}><CameraDialog open={dialog.open} camera={dialog.camera}
        onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))} onSaved={load} /></Suspense>}
    </TooltipProvider>
  )
}
