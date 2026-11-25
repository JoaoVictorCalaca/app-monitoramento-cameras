import { Check, Monitor, Moon, Smartphone, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useIsMobile } from '@/lib/mobile'
import { setTheme, useTheme, type Theme } from '@/lib/theme'

const OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Escuro', icon: Moon },
  { value: 'system', label: 'Sistema', icon: Monitor },
]

export function ThemeToggle() {
  const { theme, resolved } = useTheme()
  const mobile = useIsMobile()
  const options = OPTIONS.map((o) => (o.value === 'system' && mobile ? { ...o, icon: Smartphone } : o)) // no celular, "Sistema" mostra um celular
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label="Tema" title="Tema" />}>
        {resolved === 'dark' ? <Moon /> : <Sun />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        {options.map(({ value, label, icon: Icon }) => (
          <DropdownMenuItem key={value} onClick={() => setTheme(value)}>
            <Icon />{label}{theme === value && <Check className="ml-auto" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
