import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api, type Camera } from '@/lib/api'

const BRANDS = [
  { value: 'hikvision', label: 'Hikvision' },
  { value: 'intelbras', label: 'Intelbras' },
  { value: 'dahua', label: 'Dahua' },
  { value: 'generic', label: 'Genérica (RTSP)' },
]

// camera = undefined → nova câmera; senão edita a existente (senha em branco mantém a atual)
export function CameraDialog({ open, onOpenChange, onSaved, camera }: {
  open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void; camera?: Camera
}) {
  const [brand, setBrand] = useState('hikvision')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) setBrand(camera?.brand ?? 'hikvision') }, [open, camera])

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const g = (k: string) => String(f.get(k) || '').trim()
    const data = {
      name: g('name'), brand, host: g('host'), port: Number(g('port') || 554), user: g('user'), pass: String(f.get('pass') || ''),
      mainPath: g('mainPath') || undefined, subPath: g('subPath') || undefined,
    }
    setBusy(true)
    try {
      if (camera) await api.update(camera.id, data)
      else await api.create(data)
      toast.success(camera ? 'Câmera atualizada' : 'Câmera adicionada')
      onOpenChange(false)
      onSaved()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{camera ? 'Editar câmera' : 'Adicionar câmera'}</DialogTitle>
          <DialogDescription>Conexão via RTSP. Para mudar o grupo, arraste a câmera na barra lateral.</DialogDescription>
        </DialogHeader>
        <form key={camera?.id ?? 'new'} onSubmit={submit} className="grid gap-3">
          <div className="grid gap-1.5"><Label htmlFor="name">Nome</Label><Input id="name" name="name" required defaultValue={camera?.name} placeholder="Entrada principal" /></div>
          <div className="grid grid-cols-[1fr_110px] gap-3">
            <div className="grid gap-1.5">
              <Label>Marca</Label>
              <Select value={brand} onValueChange={(v) => v && setBrand(v)}>
                <SelectTrigger className="w-full"><SelectValue>{BRANDS.find((b) => b.value === brand)?.label}</SelectValue></SelectTrigger>
                <SelectContent>{BRANDS.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5"><Label htmlFor="port">Porta</Label><Input id="port" name="port" type="number" defaultValue={camera?.port ?? 554} /></div>
          </div>
          <div className="grid gap-1.5"><Label htmlFor="host">IP / Host</Label><Input id="host" name="host" required defaultValue={camera?.host} placeholder="192.168.1.64" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label htmlFor="user">Usuário</Label><Input id="user" name="user" defaultValue={camera?.user ?? 'admin'} autoComplete="off" /></div>
            <div className="grid gap-1.5">
              <Label htmlFor="pass">Senha</Label>
              <Input id="pass" name="pass" type="password" autoComplete="new-password" placeholder={camera ? '(sem alteração)' : ''} />
            </div>
          </div>
          <details className="text-sm text-muted-foreground">
            <summary className="cursor-pointer select-none">Avançado</summary>
            <div className="mt-2 grid gap-3">
              <div className="grid gap-1.5"><Label htmlFor="mainPath">Caminho do stream principal</Label><Input id="mainPath" name="mainPath" defaultValue={camera?.mainPath} placeholder="/Streaming/Channels/101" /></div>
              <div className="grid gap-1.5"><Label htmlFor="subPath">Caminho do substream</Label><Input id="subPath" name="subPath" defaultValue={camera?.subPath} placeholder="/Streaming/Channels/102" /></div>
            </div>
          </details>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={busy}>Salvar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
