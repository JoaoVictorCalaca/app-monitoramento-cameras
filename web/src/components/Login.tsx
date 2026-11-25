import { ThemeToggle } from '@/components/ThemeToggle'
import { useState } from 'react'
import { CctvIcon, Loader2, LogIn, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, type User } from '@/lib/api'

// Tela de login. Com setup=true, cria o primeiro administrador (só aparece enquanto não existe nenhum usuário).
export function LoginPage({ setup, onLogin }: { setup: boolean; onLogin: (u: User) => void }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const username = String(f.get('username') || '').trim()
    const password = String(f.get('password') || '')
    if (setup && password !== String(f.get('confirm') || '')) { setError('As senhas não conferem'); return }
    setBusy(true); setError('')
    try {
      const r = setup ? await api.setup(username, password) : await api.login(username, password)
      onLogin(r.user)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
      <div className="absolute right-3 top-3"><ThemeToggle /></div>
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-lg">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground"><CctvIcon className="size-5" /></div>
          <div className="leading-tight">
            <div className="text-lg font-semibold">Mini VMS</div>
            <div className="text-sm text-muted-foreground">{setup ? 'Primeiro acesso' : 'Monitoramento de câmeras'}</div>
          </div>
        </div>
        {setup && (
          <div className="mb-4 flex gap-2 rounded-md border border-primary/30 bg-primary/10 p-3 text-xs text-foreground">
            <ShieldCheck className="size-4 shrink-0 text-primary" />
            Crie o usuário administrador. Ele poderá cadastrar câmeras e outros usuários.
          </div>
        )}
        <form onSubmit={submit} className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="username">Usuário</Label>
            <Input id="username" name="username" required autoFocus autoComplete="username" minLength={3} maxLength={32} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="password">Senha</Label>
            <Input id="password" name="password" type="password" required autoComplete={setup ? 'new-password' : 'current-password'} minLength={setup ? 8 : 1} />
          </div>
          {setup && (
            <div className="grid gap-1.5">
              <Label htmlFor="confirm">Confirmar senha</Label>
              <Input id="confirm" name="confirm" type="password" required autoComplete="new-password" minLength={8} />
              <span className="text-[11px] text-muted-foreground">Mínimo de 8 caracteres.</span>
            </div>
          )}
          {error && <div role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
          <Button type="submit" disabled={busy} className="mt-1">
            {busy ? <Loader2 className="animate-spin" /> : setup ? <ShieldCheck /> : <LogIn />}
            {setup ? 'Criar administrador' : 'Entrar'}
          </Button>
        </form>
      </div>
    </div>
  )
}
