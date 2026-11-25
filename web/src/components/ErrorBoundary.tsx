import { Component, type ReactNode } from 'react'

// Evita que um erro de renderização apague a tela inteira: mostra um aviso com opção de tentar de novo
export class ErrorBoundary extends Component<{ children: ReactNode; compact?: boolean }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error) { console.error('Erro de interface:', error) }
  render() {
    if (!this.state.error) return this.props.children
    const retry = () => this.setState({ error: null })
    if (this.props.compact) {
      return (
        <div className="flex flex-col items-center justify-center gap-1 rounded-md border bg-black p-2 text-center text-[11px] text-muted-foreground">
          Erro nesta janela
          <button className="underline" onClick={retry}>Tentar de novo</button>
        </div>
      )
    }
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center text-foreground">
        <p className="text-sm">Algo deu errado na interface.</p>
        <p className="max-w-md text-xs text-muted-foreground">{this.state.error.message}</p>
        <div className="flex gap-2">
          <button className="rounded-md border px-3 py-1.5 text-sm" onClick={retry}>Tentar de novo</button>
          <button className="rounded-md border px-3 py-1.5 text-sm" onClick={() => location.reload()}>Recarregar página</button>
        </div>
      </div>
    )
  }
}
