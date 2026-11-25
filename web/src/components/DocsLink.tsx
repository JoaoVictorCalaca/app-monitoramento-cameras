import { BookOpen, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'

export const REPO_URL = 'https://github.com/JoaoVictorCalaca/app-monitoramento-cameras'

// Link para o repositório (README com a documentação), com etiqueta "GitHub"
export function DocsLink({ className }: { className?: string }) {
  return (
    <a
      href={`${REPO_URL}#readme`} target="_blank" rel="noopener noreferrer"
      className={cn('flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground', className)}
    >
      <BookOpen className="size-3.5 shrink-0" />
      <span className="font-medium">Documentação</span>
      <span className="rounded border px-1 py-px text-[10px] leading-none">GitHub</span>
      <ExternalLink className="ml-auto size-3 shrink-0 opacity-60" />
    </a>
  )
}
