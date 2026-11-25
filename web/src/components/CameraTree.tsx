import { confirmDialog } from '@/components/ConfirmHost'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Circle, Folder, FolderOpen, FolderPlus, GripVertical,
  LayoutGrid, ListChecks, MonitorPlay, Pencil, Plus, Search, SquareX, Trash2, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { api, type Camera } from '@/lib/api'

export const NO_GROUP = 'Sem grupo'
const DRAG_TYPE = 'application/x-minivms-cams'

const ls = {
  get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* ignora */ } },
}

function StatusDot({ online }: { online: boolean | null }) {
  const cls = online === true ? 'bg-emerald-500' : online === false ? 'bg-red-500' : 'bg-muted-foreground/40'
  return <span className={'size-2 shrink-0 rounded-full ' + cls} title={online === true ? 'Online' : online === false ? 'Offline' : 'Verificando'} />
}

type Props = {
  bottom?: React.ReactNode      // rodapé da barra lateral
  top?: React.ReactNode         // cabeçalho da barra lateral (também abre o menu de contexto)
  cams: Camera[]                // todas as câmeras
  match: (c: Camera) => boolean // filtro de câmeras (IP/nome) vindo da busca principal
  filtering: boolean
  groups: string[]              // grupos salvos no servidor (inclui vazios)
  activeId: string | null
  groupFilter: string | null
  onGroupFilter: (g: string | null) => void
  onPick: (c: Camera) => void
  onToggleRec: (c: Camera) => void
  onEdit: (c: Camera) => void
  onRemove: (c: Camera) => void
  onAddCamera: () => void
  canEdit: boolean               // operador: só visualiza (sem arrastar, editar ou gravar)
  reload: () => Promise<void> | void
}

// Árvore de grupos: criar/pesquisar/renomear/excluir grupos e mover câmeras arrastando e soltando.
// Ctrl+clique seleciona várias câmeras; Shift+clique seleciona um intervalo; arrastar move toda a seleção.
export function CameraTree({ cams, match, filtering, groups, activeId, groupFilter, onGroupFilter, onPick, onToggleRec, onEdit, onRemove, onAddCamera, canEdit, reload, top, bottom }: Props) {
  const [groupQuery, setGroupQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [closed, setClosed] = useState<Set<string>>(() => new Set(JSON.parse(ls.get('closedGroups') || '[]')))
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const anchor = useRef<string | null>(null)
  const expandTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // grupos visíveis: salvos + os das câmeras + "Sem grupo"; filtrados pela pesquisa de grupos
  const tree = useMemo(() => {
    const byGroup = new Map<string, Camera[]>()
    for (const g of groups) byGroup.set(g, [])
    for (const c of cams) {
      const g = c.group || NO_GROUP
      if (!byGroup.has(g)) byGroup.set(g, [])
      if (match(c)) byGroup.get(g)!.push(c)
    }
    if (!byGroup.has(NO_GROUP)) byGroup.set(NO_GROUP, [])
    const gq = groupQuery.trim().toLowerCase()
    return [...byGroup.entries()]
      .filter(([g]) => !gq || g.toLowerCase().includes(gq))
      // com filtro de câmeras ativo, esconde grupos sem resultado; durante o arraste, todos viram destino
      .filter(([, list]) => !filtering || dragging || gq !== '' || list.length > 0)
      .filter(([g, list]) => g !== NO_GROUP || list.length > 0 || dragging) // "Sem grupo" só aparece se tiver câmeras (ou durante o arraste)
      .sort(([a], [b]) => (a === NO_GROUP ? 1 : b === NO_GROUP ? -1 : a.localeCompare(b, 'pt-BR')))
  }, [cams, groups, match, filtering, groupQuery, dragging])

  const flat = useMemo(() => tree.flatMap(([g, list]) => (closed.has(g) && !filtering ? [] : list)), [tree, closed, filtering])
  const totalGroups = tree.filter(([g]) => g !== NO_GROUP).length

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(new Set()) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function setAllClosed(close: boolean) {
    const next = close ? new Set(tree.map(([g]) => g)) : new Set<string>()
    ls.set('closedGroups', JSON.stringify([...next]))
    setClosed(next)
  }

  function toggleClosed(g: string, force?: boolean) {
    setClosed((s) => {
      const next = new Set(s)
      const close = force ?? !next.has(g)
      if (close) next.add(g); else next.delete(g)
      ls.set('closedGroups', JSON.stringify([...next]))
      return next
    })
  }

  function onItemClick(e: React.MouseEvent, c: Camera) {
    if (canEdit && (e.ctrlKey || e.metaKey)) {
      setSelected((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n })
      anchor.current = c.id
      return
    }
    if (canEdit && e.shiftKey && anchor.current) {
      const a = flat.findIndex((x) => x.id === anchor.current), b = flat.findIndex((x) => x.id === c.id)
      if (a >= 0 && b >= 0) { const [lo, hi] = a < b ? [a, b] : [b, a]; setSelected(new Set(flat.slice(lo, hi + 1).map((x) => x.id))); return }
    }
    setSelected(new Set())
    anchor.current = c.id
    onPick(c)
  }

  function onDragStart(e: React.DragEvent, c: Camera) {
    const ids = selected.has(c.id) ? [...selected] : [c.id]
    if (!selected.has(c.id)) setSelected(new Set([c.id]))
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids))
    e.dataTransfer.effectAllowed = 'move'
    // imagem do arraste mostrando quantas câmeras estão sendo movidas
    const ghost = document.createElement('div')
    ghost.textContent = ids.length > 1 ? `${ids.length} câmeras` : c.name
    ghost.style.cssText = 'position:fixed;top:-100px;padding:4px 10px;border-radius:6px;font:12px sans-serif;background:#2563eb;color:#fff'
    document.body.appendChild(ghost)
    e.dataTransfer.setDragImage(ghost, 10, 10)
    setTimeout(() => ghost.remove(), 0)
    setDragging(true)
  }

  function onDragEnd() { setDragging(false); setDragOver(null); clearTimeout(expandTimer.current) }

  function onGroupDragOver(e: React.DragEvent, g: string) {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOver !== g) {
      setDragOver(g)
      clearTimeout(expandTimer.current)
      if (closed.has(g)) expandTimer.current = setTimeout(() => toggleClosed(g, false), 700) // abre grupo fechado ao passar por cima
    }
  }

  async function onGroupDrop(e: React.DragEvent, g: string) {
    e.preventDefault()
    onDragEnd()
    let ids: string[] = []
    try { ids = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) } catch { return }
    const target = g === NO_GROUP ? '' : g
    const moving = cams.filter((c) => ids.includes(c.id) && (c.group || '') !== target)
    if (!moving.length) return
    // guarda os grupos anteriores para "Desfazer"
    const before = new Map<string, string[]>()
    for (const c of moving) { const k = c.group || ''; if (!before.has(k)) before.set(k, []); before.get(k)!.push(c.id) }
    try {
      await api.setGroup(moving.map((c) => c.id), target)
      setSelected(new Set())
      await reload()
      toast.success(`${moving.length > 1 ? `${moving.length} câmeras movidas` : `"${moving[0].name}" movida`} para ${g}`, {
        action: {
          label: 'Desfazer',
          onClick: async () => { for (const [grp, list] of before) await api.setGroup(list, grp); await reload() },
        },
      })
    } catch (err) { toast.error((err as Error).message) }
  }

  async function createGroup(name: string) {
    const g = name.trim()
    if (!g) { setCreating(false); return }
    try { await api.createGroup(g); setCreating(false); await reload(); toast.success(`Grupo "${g}" criado. Arraste câmeras para ele.`) }
    catch (err) { toast.error((err as Error).message) }
  }

  async function renameGroup(from: string, to: string) {
    const t = to.trim()
    setRenaming(null)
    if (!t || t === from) return
    try {
      await api.renameGroup(from, t)
      if (groupFilter === from) onGroupFilter(t)
      await reload()
      toast.success(`Grupo renomeado para "${t}"`)
    } catch (err) { toast.error((err as Error).message) }
  }

  async function deleteGroup(g: string, count: number) {
    if (!await confirmDialog({ title: `Excluir o grupo "${g}"?`, description: count ? `As ${count} câmera(s) dele vão para "${NO_GROUP}".` : undefined })) return
    try {
      await api.deleteGroup(g)
      if (groupFilter === g) onGroupFilter(null)
      await reload()
      toast.success(`Grupo "${g}" excluído`)
    } catch (err) { toast.error((err as Error).message) }
  }

  return (
    <ContextMenu>
    <ContextMenuTrigger className="flex min-h-0 flex-1 flex-col select-auto">
      {top}
      {/* barra de grupos: pesquisar e criar */}
      <div className="flex items-center gap-1 px-3 pb-1 pt-2">
        <span className="flex-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Grupos <span className="text-muted-foreground/60">{totalGroups}</span></span>
        <Tooltip>
          <TooltipTrigger render={<Button size="icon-xs" variant={searchOpen ? 'secondary' : 'ghost'} onClick={() => { setSearchOpen((o) => !o); if (searchOpen) setGroupQuery('') }} />}>
            <Search />
          </TooltipTrigger>
          <TooltipContent>Pesquisar grupos</TooltipContent>
        </Tooltip>
        {canEdit && (
          <Tooltip>
            <TooltipTrigger render={<Button size="icon-xs" variant={creating ? 'secondary' : 'ghost'} onClick={() => setCreating(true)} />}>
              <FolderPlus />
            </TooltipTrigger>
            <TooltipContent>Criar grupo</TooltipContent>
          </Tooltip>
        )}
      </div>
      {searchOpen && (
        <div className="relative px-3 pb-1">
          <Search className="pointer-events-none absolute left-5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input onContextMenu={(e) => e.stopPropagation()} autoFocus value={groupQuery} onChange={(e) => setGroupQuery(e.target.value)} placeholder="Nome do grupo" className="h-7 pl-7 text-xs"
            onKeyDown={(e) => { if (e.key === 'Escape') { setGroupQuery(''); setSearchOpen(false) } }} />
        </div>
      )}
      {creating && (
        <div className="px-3 pb-1">
          <Input onContextMenu={(e) => e.stopPropagation()} autoFocus placeholder="Nome do novo grupo + Enter" className="h-7 text-xs" maxLength={60}
            onKeyDown={(e) => { if (e.key === 'Enter') createGroup(e.currentTarget.value); if (e.key === 'Escape') setCreating(false) }}
            onBlur={(e) => { if (!e.currentTarget.value.trim()) setCreating(false) }} />
        </div>
      )}
      {selected.size > 1 && (
        <div className="mx-3 mb-1 flex items-center justify-between rounded-md bg-primary/10 px-2 py-1 text-[11px] text-primary">
          {selected.size} selecionadas: arraste para um grupo
          <button onClick={() => setSelected(new Set())} aria-label="Limpar seleção"><X className="size-3" /></button>
        </div>
      )}

      {/* clique direito na área vazia abre o menu de contexto (toda a barra lateral, exceto campos de texto) */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2">
        {tree.length === 0 &&<div className="px-4 py-8 text-center text-sm text-muted-foreground">{groupQuery ? 'Nenhum grupo encontrado' : 'Nenhuma câmera encontrada'}</div>}
        {tree.map(([g, list]) => {
          const isClosed = closed.has(g) && !filtering
          const over = dragOver === g
          return (
            <div key={g}
              onDragOver={(e) => canEdit && onGroupDragOver(e, g)}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver((d) => (d === g ? null : d)) }}
              onDrop={(e) => onGroupDrop(e, g)}
              className={'mb-0.5 shrink-0 rounded-md transition-colors ' + (over ? 'bg-primary/15 ring-1 ring-primary' : dragging ? 'ring-1 ring-dashed ring-border' : '')}>
              <div
                className={'group/g flex items-center gap-1 rounded-md px-1 py-1 text-xs font-medium ' + (groupFilter === g ? 'text-primary' : 'text-muted-foreground')}>
                {renaming === g ? (
                  <Input autoFocus defaultValue={g} className="h-6 text-xs" maxLength={60}
                    onKeyDown={(e) => { if (e.key === 'Enter') renameGroup(g, e.currentTarget.value); if (e.key === 'Escape') setRenaming(null) }}
                    onBlur={(e) => renameGroup(g, e.currentTarget.value)} />
                ) : (
                  <button className="flex min-w-0 flex-1 items-center gap-1 text-left" onClick={() => toggleClosed(g)}
                    onDoubleClick={() => canEdit && g !== NO_GROUP && setRenaming(g)} title={canEdit && g !== NO_GROUP ? 'Duplo clique para renomear' : undefined}>
                    {isClosed ? <ChevronRight className="size-3.5 shrink-0" /> : <ChevronDown className="size-3.5 shrink-0" />}
                    {isClosed ? <Folder className="size-3.5 shrink-0" /> : <FolderOpen className="size-3.5 shrink-0" />}
                    <span className="truncate uppercase tracking-wide">{g}</span>
                    <span className="ml-1 shrink-0 text-muted-foreground/70">{list.length}</span>
                  </button>
                )}
                {renaming !== g && (
                  <div className="flex shrink-0 items-center">
                    {list.length > 0 && (
                      <Tooltip>
                        <TooltipTrigger render={<Button size="icon-xs" variant="ghost" className={groupFilter === g ? '' : 'opacity-0 group-hover/g:opacity-100'}
                          onClick={() => onGroupFilter(groupFilter === g ? null : g)} />}>
                          <MonitorPlay />
                        </TooltipTrigger>
                        <TooltipContent>{groupFilter === g ? 'Mostrar todos na grade' : 'Ver só este grupo na grade'}</TooltipContent>
                      </Tooltip>
                    )}
                    {canEdit && g !== NO_GROUP && (
                      <>
                        <Tooltip>
                          <TooltipTrigger render={<Button size="icon-xs" variant="ghost" className="opacity-0 group-hover/g:opacity-100" onClick={() => setRenaming(g)} />}>
                            <Pencil />
                          </TooltipTrigger>
                          <TooltipContent>Renomear grupo</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger render={<Button size="icon-xs" variant="ghost" className="opacity-0 group-hover/g:opacity-100" onClick={() => deleteGroup(g, list.length)} />}>
                            <Trash2 className="text-destructive" />
                          </TooltipTrigger>
                          <TooltipContent>Excluir grupo</TooltipContent>
                        </Tooltip>
                      </>
                    )}
                  </div>
                )}
              </div>
              {!isClosed && list.length === 0 && (
                <div className="ml-5 mr-1 mb-1 rounded border border-dashed px-2 py-2 text-center text-[11px] text-muted-foreground/70">{canEdit ? 'Arraste câmeras para cá' : 'Grupo vazio'}</div>
              )}
              {!isClosed && list.map((c) => {
                const sel = selected.has(c.id)
                return (
                  <div key={c.id} draggable={canEdit} onDragStart={(e) => onDragStart(e, c)} onDragEnd={onDragEnd} onClick={(e) => onItemClick(e, c)}
                    className={'group flex cursor-pointer items-center gap-2 rounded-md py-1.5 pl-2 pr-1 ' +
                      (sel ? 'bg-primary/15 ' : activeId === c.id ? 'bg-accent ' : 'hover:bg-accent ')}>
                    {canEdit && <GripVertical className="size-3.5 shrink-0 cursor-grab text-muted-foreground/40 group-hover:text-muted-foreground" />}
                    <StatusDot online={c.online} />
                    <div className="min-w-0 flex-1 leading-tight">
                      <div className="truncate text-sm">{c.name}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{c.recError && c.record ? c.recError : c.host}</div>
                    </div>
                    {c.record && !canEdit && <Circle className="size-3 animate-pulse fill-red-500 text-red-500" />}
                    {canEdit && (
                      <>
                    <Tooltip>
                      <TooltipTrigger render={<Button size="icon-xs" variant="ghost" className={c.record ? '' : 'opacity-0 group-hover:opacity-100'}
                        onClick={(e) => { e.stopPropagation(); onToggleRec(c) }} />}>
                        <Circle className={c.record ? 'animate-pulse fill-red-500 text-red-500' : 'text-muted-foreground'} />
                      </TooltipTrigger>
                      <TooltipContent>{c.record ? 'Parar gravação' : 'Gravar (REC)'}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger render={<Button size="icon-xs" variant="ghost" className="opacity-0 group-hover:opacity-100"
                        onClick={(e) => { e.stopPropagation(); onEdit(c) }} />}>
                        <Pencil />
                      </TooltipTrigger>
                      <TooltipContent>Editar</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger render={<Button size="icon-xs" variant="ghost" className="opacity-0 group-hover:opacity-100"
                        onClick={(e) => { e.stopPropagation(); onRemove(c) }} />}>
                        <Trash2 className="text-destructive" />
                      </TooltipTrigger>
                      <TooltipContent>Remover</TooltipContent>
                    </Tooltip>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
        <div className="min-h-20 flex-1 shrink-0" />
      </div>
      <div className="border-t px-3 py-1.5 text-[10px] leading-snug text-muted-foreground/70">
        {canEdit ? 'Arraste câmeras para mover entre grupos · Ctrl+clique seleciona várias · Shift+clique seleciona intervalo' : 'Modo operador: somente visualização'}
      </div>
      {bottom}
    </ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        <ContextMenuGroup>
          <ContextMenuLabel>Câmeras e grupos</ContextMenuLabel>
          {canEdit && <ContextMenuItem onClick={() => setCreating(true)}><FolderPlus />Novo grupo</ContextMenuItem>}
          {canEdit && <ContextMenuItem onClick={onAddCamera}><Plus />Adicionar câmera</ContextMenuItem>}
          <ContextMenuItem onClick={() => setSearchOpen(true)}><Search />Pesquisar grupos</ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => setAllClosed(false)}><ChevronsUpDown />Expandir todos os grupos</ContextMenuItem>
        <ContextMenuItem onClick={() => setAllClosed(true)}><ChevronsDownUp />Recolher todos os grupos</ContextMenuItem>
        <ContextMenuSeparator />
        {canEdit && <ContextMenuItem disabled={!flat.length} onClick={() => setSelected(new Set(flat.map((c) => c.id)))}>
          <ListChecks />Selecionar câmeras visíveis<ContextMenuShortcut>{flat.length}</ContextMenuShortcut>
        </ContextMenuItem>}
        {selected.size > 0 && (
          <ContextMenuItem onClick={() => setSelected(new Set())}><SquareX />Limpar seleção<ContextMenuShortcut>Esc</ContextMenuShortcut></ContextMenuItem>
        )}
        {groupFilter !== null && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => onGroupFilter(null)}><LayoutGrid />Mostrar todos os grupos na grade</ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
