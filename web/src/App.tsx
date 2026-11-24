import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  CctvIcon, ChevronDown, ChevronLeft, ChevronRight, Circle, Expand, FolderInput, FolderOpen, LayoutGrid,
  MonitorPlay, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Repeat, Search, Trash2, X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Toaster } from '@/components/ui/sonner'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { CameraCell } from '@/components/CameraCell'
import { CameraDialog, GroupDialog } from '@/components/CameraDialog'
import { Playback } from '@/components/Playback'
import { api, type Camera } from '@/lib/api'

const LAYOUTS = [1, 2, 3, 4, 5, 6, 7, 8] // até 8x8 = 64 câmeras por página
const SEQ_OPTIONS = [10, 20, 30, 60]
const NO_GROUP = 'Sem grupo'

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

export default function App() {
  const [cams, setCams] = useState<Camera[]>([])
  const [layout, setLayout] = useState(() => Math.min(8, Math.max(1, Number(ls.get('layout')) || 2)))
  const [focus, setFocus] = useState<string | null>(null)
  const [dialog, setDialog] = useState<{ open: boolean; camera?: Camera }>({ open: false })
  const [groupDialog, setGroupDialog] = useState(false)
  const [view, setView] = useState<'live' | 'playback'>('live')
  const [pbCam, setPbCam] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(() => ls.get('sidebar') === 'closed')
  const [query, setQuery] = useState('')
  const [groupFilter, setGroupFilter] = useState<string | null>(null)
  const [closedGroups, setClosedGroups] = useState<Set<string>>(() => new Set(JSON.parse(ls.get('closedGroups') || '[]')))
  const [page, setPage] = useState(0)
  const [seq, setSeq] = useState(false)
  const [seqSec, setSeqSec] = useState(20)
  const gridRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try { setCams(await api.list()) } catch { toast.error('Servidor indisponível') }
  }, [])
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t) }, [load])

  const toggleSidebar = useCallback(() => {
    setCollapsed((c) => { ls.set('sidebar', c ? 'open' : 'closed'); return !c })
  }, [])

  // ---- filtros e grupos ----
  const match = useMemo(() => matcher(query), [query])
  const searched = useMemo(() => cams.filter(match), [cams, match])
  const filtered = useMemo(() => groupFilter === null ? searched : searched.filter((c) => (c.group || NO_GROUP) === groupFilter), [searched, groupFilter])
  const groups = useMemo(() => [...new Set(cams.map((c) => c.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [cams])
  const tree = useMemo(() => {
    const m = new Map<string, Camera[]>()
    for (const c of searched) { const g = c.group || NO_GROUP; if (!m.has(g)) m.set(g, []); m.get(g)!.push(c) }
    return [...m.entries()].sort(([a], [b]) => (a === NO_GROUP ? 1 : b === NO_GROUP ? -1 : a.localeCompare(b, 'pt-BR')))
  }, [searched])

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

  async function toggleRec(c: Camera) {
    try {
      await api.setRecord(c.id, !c.record)
      toast.success(c.record ? `Gravação de "${c.name}" parada` : `Gravando "${c.name}"`)
      load()
    } catch (e) { toast.error((e as Error).message) }
  }

  function pick(c: Camera) {
    if (view === 'playback') { setPbCam(c.id); return }
    setFocus(focus === c.id ? null : c.id)
  }

  function toggleGroup(g: string) {
    setClosedGroups((s) => {
      const next = new Set(s)
      if (next.has(g)) next.delete(g); else next.add(g)
      ls.set('closedGroups', JSON.stringify([...next]))
      return next
    })
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
                  <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filtrar por IP ou nome" className="h-8 pl-8 pr-8" />
                  {query && (
                    <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setQuery('')} aria-label="Limpar filtro">
                      <X className="size-4" />
                    </button>
                  )}
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{query ? `${searched.length} de ${cams.length} câmeras` : `${cams.length} câmeras`}</span>
                  {query && searched.length > 0 && (
                    <Button size="xs" variant="ghost" onClick={() => setGroupDialog(true)}><FolderInput />Agrupar filtradas</Button>
                  )}
                </div>
                {!query && <div className="text-[11px] text-muted-foreground/70">Dica: use uma faixa, ex. 192.168.3.10-50</div>}
              </div>
              <Separator />
              <ScrollArea className="min-h-0 flex-1 px-2 py-1">
                {cams.length === 0 && (
                  <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground">
                    <CctvIcon className="size-8 opacity-40" />Nenhuma câmera cadastrada
                  </div>
                )}
                {cams.length > 0 && searched.length === 0 && <div className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhuma câmera encontrada</div>}
                {tree.map(([g, list]) => {
                  const closed = closedGroups.has(g) && !query
                  return (
                    <div key={g} className="mb-1">
                      <div className={'group/g flex items-center gap-1 rounded-md px-1 py-1 text-xs font-medium hover:bg-accent/50 ' + (groupFilter === g ? 'text-primary' : 'text-muted-foreground')}>
                        <button className="flex min-w-0 flex-1 items-center gap-1" onClick={() => toggleGroup(g)}>
                          {closed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                          <FolderOpen className="size-3.5" />
                          <span className="truncate uppercase tracking-wide">{g}</span>
                          <span className="ml-1 text-muted-foreground/70">{list.length}</span>
                        </button>
                        {tree.length > 1 && (
                          <Tooltip>
                            <TooltipTrigger render={<Button size="icon-xs" variant="ghost" className={groupFilter === g ? '' : 'opacity-0 group-hover/g:opacity-100'}
                              onClick={() => { setGroupFilter(groupFilter === g ? null : g); setFocus(null); setView('live') }} />}>
                              <MonitorPlay />
                            </TooltipTrigger>
                            <TooltipContent>{groupFilter === g ? 'Mostrar todos na grade' : 'Ver só este grupo na grade'}</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                      {!closed && list.map((c) => {
                        const active = view === 'playback' ? pbCam === c.id : focus === c.id
                        return (
                          <div key={c.id} onClick={() => pick(c)}
                            className={'group flex cursor-pointer items-center gap-2.5 rounded-md py-1.5 pl-5 pr-1 hover:bg-accent ' + (active ? 'bg-accent' : '')}>
                            <StatusDot online={c.online} />
                            <div className="min-w-0 flex-1 leading-tight">
                              <div className="truncate text-sm">{c.name}</div>
                              <div className="truncate text-[11px] text-muted-foreground">{c.recError && c.record ? c.recError : c.host}</div>
                            </div>
                            <Tooltip>
                              <TooltipTrigger render={<Button size="icon-xs" variant="ghost" className={c.record ? '' : 'opacity-0 group-hover:opacity-100'}
                                onClick={(e) => { e.stopPropagation(); toggleRec(c) }} />}>
                                <Circle className={c.record ? 'animate-pulse fill-red-500 text-red-500' : 'text-muted-foreground'} />
                              </TooltipTrigger>
                              <TooltipContent>{c.record ? 'Parar gravação' : 'Gravar (REC)'}</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger render={<Button size="icon-xs" variant="ghost" className="opacity-0 group-hover:opacity-100"
                                onClick={(e) => { e.stopPropagation(); setDialog({ open: true, camera: c }) }} />}>
                                <Pencil />
                              </TooltipTrigger>
                              <TooltipContent>Editar</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger render={<Button size="icon-xs" variant="ghost" className="opacity-0 group-hover:opacity-100"
                                onClick={(e) => { e.stopPropagation(); remove(c) }} />}>
                                <Trash2 className="text-destructive" />
                              </TooltipTrigger>
                              <TooltipContent>Remover</TooltipContent>
                            </Tooltip>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </ScrollArea>
              <Separator />
              <div className="p-3"><Button className="w-full" onClick={() => setDialog({ open: true })}><Plus />Adicionar câmera</Button></div>
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
            </header>

            {view === 'live' ? (
              <div ref={gridRef} className="grid min-h-0 flex-1 gap-1 bg-background p-1.5"
                style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${n}, minmax(0, 1fr))` }}>
                {Array.from({ length: n * n }, (_, i) => {
                  const c = visible[i]
                  return c ? (
                    <CameraCell key={c.id + (focus ? '-hd' : '')} cam={c} hd={!!focus} low={layout >= 5}
                      onToggleFocus={() => setFocus(focus ? null : c.id)} onToggleRec={() => toggleRec(c)} />
                  ) : (
                    <div key={'e' + i} className="flex items-center justify-center rounded-md border border-dashed text-muted-foreground/30"><CctvIcon className="size-4" /></div>
                  )
                })}
              </div>
            ) : (
              <Playback cams={cams} camId={pbCam} setCamId={setPbCam} />
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
      <CameraDialog open={dialog.open} camera={dialog.camera} groups={groups}
        onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))} onSaved={load} />
      <GroupDialog open={groupDialog} onOpenChange={setGroupDialog} ids={searched.map((c) => c.id)} groups={groups} onSaved={load} />
      <Toaster theme="dark" />
    </TooltipProvider>
  )
}
