import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  CctvIcon, ChevronLeft, ChevronRight, Circle, Expand, FolderOpen, LayoutGrid,
  PanelLeftClose, PanelLeftOpen, Plus, Repeat, Search, X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { CameraCell } from '@/components/CameraCell'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { CameraTree, NO_GROUP } from '@/components/CameraTree'
import { UserMenu } from '@/components/UserMenu'
import { lazy, Suspense } from 'react'
import { api, type Camera, type User } from '@/lib/api'

const LAYOUTS = [1, 2, 3, 4, 5, 6, 7, 8] // até 8x8 = 64 câmeras por página
const SEQ_OPTIONS = [10, 20, 30, 60]

const ls = {
  get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* ignora */ } },
}

// Filtro: nome ou IP (parcial), ou faixa de IP "192.168.3.10-50"
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
  const [layout, setLayout] = useState(() => Math.min(8, Math.max(1, Number(ls.get('layout')) || 2)))
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
    if (!confirm(`Remover "${c.name}"? As gravações já feitas ficam em disco até a retenção apagá-las.`)) return
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
    if (view === 'playback') { setPbCam(c.id); return }
    setFocus(focus === c.id ? null : c.id)
  }

  const counts = useMemo(() => ({
    online: cams.filter((c) => c.online === true).length,
    offline: cams.filter((c) => c.online === false).length,
    rec: cams.filter((c) => c.record).length,
  }), [cams])

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col bg-background text-foreground">
        <div className="flex min-h-0 flex-1">
          <aside className={'shrink-0 overflow-hidden bg-card transition-[width] duration-200 ' + (collapsed ? 'w-0' : 'w-72 border-r')}>
            <div className="flex h-full w-72 flex-col">
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
                  {query ? `${searched.length} de ${cams.length} câmeras` : `${cams.length} câmeras · dica: faixa 192.168.3.10-50`}
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
                bottom={canEdit ? <><Separator /><div className="p-3"><Button className="w-full" onClick={() => setDialog({ open: true })}><Plus />Adicionar câmera</Button></div></> : undefined}
              />
            </div>
          </aside>

          <main className="flex min-w-0 flex-1 flex-col">
            <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
              <Tooltip>
                <TooltipTrigger render={<Button size="icon-sm" variant="ghost" onClick={toggleSidebar} />}>
                  {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
                </TooltipTrigger>
                <TooltipContent>{collapsed ? 'Mostrar' : 'Recolher'} barra lateral (Ctrl+B)</TooltipContent>
              </Tooltip>
              <Tabs value={view} onValueChange={(v) => setView(v as 'live' | 'playback')}>
                <TabsList>
                  <TabsTrigger value="live">Ao vivo</TabsTrigger>
                  <TabsTrigger value="playback">Gravações</TabsTrigger>
                </TabsList>
              </Tabs>
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
                  <div className="flex items-center gap-1">
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
                  <Separator orientation="vertical" className="h-5" />
                  <div className="flex items-center gap-1.5">
                    <LayoutGrid className="size-4 text-muted-foreground" />
                    <Select value={String(layout)} onValueChange={(v) => { if (!v) return; setLayout(Number(v)); setFocus(null); ls.set('layout', v) }}>
                      <SelectTrigger size="sm" className="w-20"><SelectValue>{layout}×{layout}</SelectValue></SelectTrigger>
                      <SelectContent>{LAYOUTS.map((v) => <SelectItem key={v} value={String(v)}>{v}×{v} ({v * v})</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </>
              )}
              {view === 'live' && (
                <Tooltip>
                  <TooltipTrigger render={<Button size="icon-sm" variant="outline" onClick={() => gridRef.current?.requestFullscreen()} />}>
                    <Expand />
                  </TooltipTrigger>
                  <TooltipContent>Tela cheia (só as câmeras)</TooltipContent>
                </Tooltip>
              )}
              <Separator orientation="vertical" className="h-5" />
              <UserMenu user={user} onLogout={onLogout} onDataChanged={load} />
            </header>

            {view === 'live' ? (
              <div ref={gridRef} className="grid min-h-0 flex-1 gap-1 bg-background p-1.5"
                style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${n}, minmax(0, 1fr))` }}>
                {Array.from({ length: n * n }, (_, i) => {
                  const c = visible[i]
                  return c ? (
                    <ErrorBoundary key={c.id + (focus ? '-hd' : '')} compact><CameraCell cam={c} hd={!!focus} low={layout >= 5}
                      onToggleFocus={toggleFocus} onToggleRec={canEdit ? recStable : undefined} /></ErrorBoundary>
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
        <footer className="flex items-center gap-4 border-t bg-card px-3 py-1 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><StatusDot online={true} />{counts.online} online</span>
          <span className="flex items-center gap-1.5"><StatusDot online={false} />{counts.offline} offline</span>
          <span>{cams.length} câmeras</span>
          <span className="flex items-center gap-1.5"><Circle className="size-2.5 fill-red-500 text-red-500" />{counts.rec} gravando</span>
          {view === 'live' && !focus && <span>Exibindo {visible.length} de {filtered.length}</span>}
          <div className="flex-1" />
          <Clock />
        </footer>
      </div>
      {dialog.open && <Suspense fallback={null}><CameraDialog open={dialog.open} camera={dialog.camera}
        onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))} onSaved={load} /></Suspense>}
    </TooltipProvider>
  )
}
