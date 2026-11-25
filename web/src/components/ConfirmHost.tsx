import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type Opts = { title: string; description?: string; confirmText?: string; destructive?: boolean }
type Pending = Opts & { resolve: (ok: boolean) => void }

let show: ((p: Pending) => void) | null = null

// substitui o confirm() do navegador: await confirmDialog({...}) devolve true/false
export function confirmDialog(opts: Opts): Promise<boolean> {
  return new Promise((resolve) => {
    if (show) show({ ...opts, resolve })
    else resolve(window.confirm(opts.title)) // host ainda não montado
  })
}

export function ConfirmHost() {
  const [p, setP] = useState<Pending | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => { show = (n) => { setP(n); setOpen(true) }; return () => { show = null } }, [])
  const close = (ok: boolean) => { p?.resolve(ok); setOpen(false) }
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(false) }}>
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{p?.title}</DialogTitle>
          {p?.description && <DialogDescription>{p.description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>Cancelar</Button>
          <Button variant={p?.destructive === false ? 'default' : 'destructive'} autoFocus onClick={() => close(true)}>{p?.confirmText ?? 'Excluir'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
