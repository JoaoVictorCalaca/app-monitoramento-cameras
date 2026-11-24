import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Toaster } from '@/components/ui/sonner'
import { LoginPage } from '@/components/Login'
import { ApiError, api, setUnauthorizedHandler, type User } from '@/lib/api'
import App from './App'

// Decide entre tela de login, primeiro acesso (criar admin) e o app.
export default function Root() {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'login'; setup: boolean } | { status: 'app'; user: User }>({ status: 'loading' })

  const check = useCallback(async () => {
    try {
      const { user } = await api.me()
      setState({ status: 'app', user })
    } catch (err) {
      const setup = err instanceof ApiError && err.data.setupRequired === true
      setState({ status: 'login', setup })
    }
  }, [])

  useEffect(() => {
    check()
    setUnauthorizedHandler(() => setState((s) => (s.status === 'app' ? { status: 'login', setup: false } : s)))
  }, [check])

  return (
    <>
      {state.status === 'loading' && (
        <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground"><Loader2 className="size-6 animate-spin" /></div>
      )}
      {state.status === 'login' && <LoginPage setup={state.setup} onLogin={(user) => setState({ status: 'app', user })} />}
      {state.status === 'app' && <App key={state.user.id} user={state.user} onLogout={() => setState({ status: 'login', setup: false })} />}
      <Toaster theme="dark" />
    </>
  )
}
