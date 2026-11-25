import { confirmDialog } from '@/components/ConfirmHost'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowLeftRight, ChevronDown, Download, FileJson, FileSpreadsheet, KeyRound, Loader2, LogOut, ShieldCheck, Trash2, Upload, UserPlus, Users,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, type ImportResult, type Role, type User } from '@/lib/api'

const ROLE_LABEL: Record<Role, string> = { admin: 'Administrador', operator: 'Operador' }

function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export function UserMenu({ user, onLogout, onDataChanged, nav }: { user: User; onLogout: () => void; onDataChanged: () => void; nav?: boolean }) {
  const [dialog, setDialog] = useState<null | 'password' | 'users' | 'transfer'>(null)
  const isAdmin = user.role === 'admin'
  const close = (o: boolean) => { if (!o) setDialog(null) }

  async function logout() {
    try { await api.logout() } catch { /* sai mesmo assim */ }
    onLogout()
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={nav
          ? <button className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] text-muted-foreground" />
          : <Button size="sm" variant="ghost" className="gap-2" />}>
          <span className={'flex items-center justify-center rounded-full bg-primary/15 font-semibold uppercase text-primary ' + (nav ? 'size-5 text-[10px]' : 'size-6 text-xs')}>{user.username.slice(0, 2)}</span>
          {nav ? <span className="max-w-16 truncate">{user.username}</span> : <span className="hidden max-w-28 truncate sm:inline">{user.username}</span>}
          {!nav && <ChevronDown className="size-3.5 text-muted-foreground" />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side={nav ? 'top' : undefined} className="w-60">
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              <div className="text-sm font-medium text-foreground">{user.username}</div>
              <div className="text-xs font-normal">{ROLE_LABEL[user.role]}</div>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setDialog('password')}><KeyRound />Alterar minha senha</DropdownMenuItem>
          {isAdmin && <DropdownMenuItem onClick={() => setDialog('users')}><Users />Usuários</DropdownMenuItem>}
          <DropdownMenuItem onClick={() => setDialog('transfer')}><ArrowLeftRight />{isAdmin ? 'Exportar / importar' : 'Exportar lista'}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={logout}><LogOut />Sair</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangePasswordDialog open={dialog === 'password'} onOpenChange={close} />
      {isAdmin && <UsersDialog open={dialog === 'users'} onOpenChange={close} me={user} />}
      <TransferDialog open={dialog === 'transfer'} onOpenChange={close} isAdmin={isAdmin} onImported={onDataChanged} />
    </>
  )
}

function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const next = String(f.get('next') || '')
    if (next !== String(f.get('confirm') || '')) { toast.error('As senhas novas não conferem'); return }
    setBusy(true)
    try {
      await api.changePassword(String(f.get('current') || ''), next)
      toast.success('Senha alterada. Outras sessões deste usuário foram encerradas.')
      onOpenChange(false)
    } catch (err) { toast.error((err as Error).message) } finally { setBusy(false) }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Alterar minha senha</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <div className="grid gap-1.5"><Label htmlFor="cp-current">Senha atual</Label><Input id="cp-current" name="current" type="password" required autoComplete="current-password" /></div>
          <div className="grid gap-1.5"><Label htmlFor="cp-next">Nova senha</Label><Input id="cp-next" name="next" type="password" required minLength={8} autoComplete="new-password" /></div>
          <div className="grid gap-1.5"><Label htmlFor="cp-confirm">Confirmar nova senha</Label><Input id="cp-confirm" name="confirm" type="password" required minLength={8} autoComplete="new-password" /></div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={busy}>Salvar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RoleSelect({ value, onChange, className }: { value: Role; onChange: (r: Role) => void; className?: string }) {
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v as Role)}>
      <SelectTrigger size="sm" className={className}><SelectValue>{ROLE_LABEL[value]}</SelectValue></SelectTrigger>
      <SelectContent>
        <SelectItem value="admin">Administrador</SelectItem>
        <SelectItem value="operator">Operador</SelectItem>
      </SelectContent>
    </Select>
  )
}

function UsersDialog({ open, onOpenChange, me }: { open: boolean; onOpenChange: (o: boolean) => void; me: User }) {
  const [list, setList] = useState<User[]>([])
  const [newRole, setNewRole] = useState<Role>('operator')
  const [resetFor, setResetFor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  const load = async () => { try { setList(await api.users()) } catch (err) { toast.error((err as Error).message) } }
  useEffect(() => { if (open) { load(); setResetFor(null) } }, [open])

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setBusy(true)
    try {
      const u = await api.createUser(String(f.get('username') || '').trim(), String(f.get('password') || ''), newRole)
      toast.success(`Usuário "${u.username}" criado`)
      formRef.current?.reset(); setNewRole('operator')
      load()
    } catch (err) { toast.error((err as Error).message) } finally { setBusy(false) }
  }

  async function changeRole(u: User, role: Role) {
    try { await api.updateUser(u.id, { role }); toast.success(`${u.username} agora é ${ROLE_LABEL[role].toLowerCase()}`); load() }
    catch (err) { toast.error((err as Error).message) }
  }

  async function resetPassword(u: User, password: string) {
    try { await api.updateUser(u.id, { password }); toast.success(`Senha de ${u.username} redefinida`); setResetFor(null) }
    catch (err) { toast.error((err as Error).message) }
  }

  async function remove(u: User) {
    if (!await confirmDialog({ title: `Excluir o usuário "${u.username}"?`, description: 'As sessões dele serão encerradas.' })) return
    try { await api.deleteUser(u.id); toast.success('Usuário excluído'); load() }
    catch (err) { toast.error((err as Error).message) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Usuários</DialogTitle>
          <DialogDescription>Administradores gerenciam câmeras, grupos, gravação e usuários. Operadores só visualizam ao vivo e gravações.</DialogDescription>
        </DialogHeader>
        <div className="max-h-72 divide-y overflow-y-auto rounded-md border">
          {list.map((u) => (
            <div key={u.id} className="px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{u.username} {u.id === me.id && <Badge variant="secondary" className="ml-1">você</Badge>}</div>
                  <div className="text-[11px] text-muted-foreground">desde {new Date(u.createdAt).toLocaleDateString('pt-BR')}</div>
                </div>
                <RoleSelect value={u.role} onChange={(r) => changeRole(u, r)} className="w-36" />
                <Button size="icon-sm" variant="ghost" title="Redefinir senha" onClick={() => setResetFor(resetFor === u.id ? null : u.id)}><KeyRound /></Button>
                <Button size="icon-sm" variant="ghost" title="Excluir" disabled={u.id === me.id} onClick={() => remove(u)}><Trash2 className="text-destructive" /></Button>
              </div>
              {resetFor === u.id && (
                <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); resetPassword(u, String(new FormData(e.currentTarget).get('pw') || '')) }}>
                  <Input name="pw" type="password" placeholder="Nova senha (mín. 8)" minLength={8} required autoFocus autoComplete="new-password" className="h-8" />
                  <Button size="sm" type="submit">Salvar</Button>
                </form>
              )}
            </div>
          ))}
        </div>
        <Separator />
        <form ref={formRef} onSubmit={create} className="grid gap-2">
          <div className="text-sm font-medium">Novo usuário</div>
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
            <Input name="username" placeholder="Usuário" required minLength={3} maxLength={32} autoComplete="off" />
            <Input name="password" type="password" placeholder="Senha (mín. 8)" required minLength={8} autoComplete="new-password" />
            <RoleSelect value={newRole} onChange={setNewRole} className="w-36" />
          </div>
          <div className="flex justify-end"><Button type="submit" size="sm" disabled={busy}><UserPlus />Criar usuário</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type ParsedFile = { config: Record<string, unknown>; name: string }

function TransferDialog({ open, onOpenChange, isAdmin, onImported }: {
  open: boolean; onOpenChange: (o: boolean) => void; isAdmin: boolean; onImported: () => void
}) {
  const [withPass, setWithPass] = useState(false)
  const [busy, setBusy] = useState(false)
  const [file, setFile] = useState<ParsedFile | null>(null)
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [result, setResult] = useState<ImportResult | null>(null)

  useEffect(() => { if (open) { setFile(null); setResult(null); setMode('merge'); setWithPass(false) } }, [open])

  async function exportConfig(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const pass = String(f.get('passphrase') || '')
    if (withPass && pass !== String(f.get('confirm') || '')) { toast.error('As frases-senha não conferem'); return }
    setBusy(true)
    try {
      const data = await api.exportConfig(withPass, withPass ? pass : undefined)
      downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `minivms-config-${new Date().toISOString().slice(0, 10)}.json`)
      toast.success(withPass ? 'Configuração exportada com senhas protegidas pela frase-senha' : 'Configuração exportada (sem senhas)')
    } catch (err) { toast.error((err as Error).message) } finally { setBusy(false) }
  }

  async function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    setResult(null)
    const f = e.target.files?.[0]
    if (!f) { setFile(null); return }
    try {
      const config = JSON.parse(await f.text())
      if (config?.format !== 'minivms-config') throw new Error('Arquivo não é uma exportação do Mini VMS')
      setFile({ config, name: f.name })
    } catch (err) { setFile(null); toast.error((err as Error).message || 'Arquivo inválido') }
  }

  async function importConfig(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!file) return
    if (mode === 'replace' && !await confirmDialog({ title: 'Substituir tudo?', description: 'Câmeras que não estão no arquivo serão removidas (as gravações em disco ficam até a retenção).', confirmText: 'Substituir' })) return
    const passphrase = String(new FormData(e.currentTarget).get('passphrase') || '') || undefined
    setBusy(true)
    try {
      const r = await api.importConfig(file.config, mode, passphrase)
      setResult(r)
      onImported()
      toast.success(`Importação concluída: ${r.added} nova(s), ${r.updated} atualizada(s)${r.removed ? `, ${r.removed} removida(s)` : ''}`)
    } catch (err) { toast.error((err as Error).message) } finally { setBusy(false) }
  }

  const encrypted = !!file?.config.encrypted

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isAdmin ? 'Exportar / importar' : 'Exportar lista'}</DialogTitle>
          <DialogDescription>Leve câmeras e grupos para outra máquina, ou gere uma lista para planilha.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="export">
          {isAdmin && (
            <TabsList className="w-full">
              <TabsTrigger value="export"><Download />Exportar</TabsTrigger>
              <TabsTrigger value="import"><Upload />Importar</TabsTrigger>
            </TabsList>
          )}
          <TabsContent value="export" className="grid gap-4 pt-2">
            <div className="flex items-center gap-3 rounded-md border p-3">
              <FileSpreadsheet className="size-5 shrink-0 text-emerald-500" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">Lista de câmeras (CSV)</div>
                <div className="text-xs text-muted-foreground">Nome, grupo, IP, status. Abre no Excel. Sem senhas.</div>
              </div>
              <Button size="sm" variant="outline" render={<a href="/api/export/cameras.csv" download />}><Download />Baixar</Button>
            </div>
            {isAdmin && (
              <form onSubmit={exportConfig} className="grid gap-3 rounded-md border p-3">
                <div className="flex items-center gap-3">
                  <FileJson className="size-5 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">Configuração completa (JSON)</div>
                    <div className="text-xs text-muted-foreground">Câmeras e grupos, para importar em outro servidor.</div>
                  </div>
                </div>
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>Incluir senhas das câmeras</span>
                  <Switch checked={withPass} onCheckedChange={(v) => setWithPass(!!v)} />
                </label>
                {withPass && (
                  <div className="grid gap-2">
                    <div className="flex gap-2 rounded-md bg-primary/10 p-2 text-xs"><ShieldCheck className="size-4 shrink-0 text-primary" />
                      As senhas saem criptografadas com a frase-senha abaixo. Sem ela, o arquivo não pode ser importado.</div>
                    <Input name="passphrase" type="password" placeholder="Frase-senha (mín. 8)" minLength={8} required autoComplete="new-password" />
                    <Input name="confirm" type="password" placeholder="Confirmar frase-senha" minLength={8} required autoComplete="new-password" />
                  </div>
                )}
                <div className="flex justify-end">
                  <Button type="submit" size="sm" disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Download />}Exportar</Button>
                </div>
              </form>
            )}
          </TabsContent>
          {isAdmin && (
            <TabsContent value="import" className="pt-2">
              <form onSubmit={importConfig} className="grid gap-3">
                <Input type="file" accept="application/json,.json" onChange={pickFile} />
                {file && (
                  <div className="rounded-md border p-3 text-xs text-muted-foreground">
                    <div className="font-medium text-foreground">{file.name}</div>
                    {String(file.config.cameraCount ?? '?')} câmera(s) · exportado em {file.config.exportedAt ? new Date(String(file.config.exportedAt)).toLocaleString('pt-BR') : '?'}
                    <div>{encrypted ? 'Com senhas (protegidas por frase-senha)' : 'Sem senhas: câmeras novas entram sem senha; as existentes mantêm a atual'}</div>
                  </div>
                )}
                {encrypted && <Input name="passphrase" type="password" placeholder="Frase-senha da exportação" required autoComplete="off" />}
                <div className="grid gap-1.5">
                  <Label>Modo</Label>
                  <Select value={mode} onValueChange={(v) => v && setMode(v as 'merge' | 'replace')}>
                    <SelectTrigger className="w-full"><SelectValue>{mode === 'merge' ? 'Mesclar (adiciona e atualiza)' : 'Substituir tudo'}</SelectValue></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="merge">Mesclar (adiciona e atualiza)</SelectItem>
                      <SelectItem value="replace">Substituir tudo</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-[11px] text-muted-foreground">Câmeras são reconhecidas por IP + porta. A gravação (REC) não é ligada na importação.</span>
                </div>
                {result && (
                  <div className="rounded-md bg-muted p-3 text-xs">
                    <div>{result.added} adicionada(s) · {result.updated} atualizada(s) · {result.removed} removida(s)</div>
                    {result.withoutPassword > 0 && <div className="text-amber-500">{result.withoutPassword} câmera(s) nova(s) sem senha: edite para informar.</div>}
                    {result.invalid.length > 0 && <div className="mt-1 text-destructive">Ignoradas: {result.invalid.slice(0, 5).join('; ')}{result.invalid.length > 5 ? '…' : ''}</div>}
                  </div>
                )}
                <DialogFooter>
                  <Button type="submit" disabled={!file || busy}>{busy ? <Loader2 className="animate-spin" /> : <Upload />}Importar</Button>
                </DialogFooter>
              </form>
            </TabsContent>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
