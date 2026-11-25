import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark' | 'system'
const KEY = 'vms.theme'
const mq = window.matchMedia('(prefers-color-scheme: dark)')
const listeners = new Set<() => void>()

function read(): Theme {
  try { const v = localStorage.getItem(KEY); if (v === 'light' || v === 'dark' || v === 'system') return v } catch { /* sem storage */ }
  return 'dark'
}
let current: Theme = read()
const isDark = () => current === 'dark' || (current === 'system' && mq.matches)

function apply() {
  document.documentElement.classList.toggle('dark', isDark())
  document.documentElement.style.colorScheme = isDark() ? 'dark' : 'light'
  listeners.forEach((l) => l())
}
mq.addEventListener('change', () => { if (current === 'system') apply() })

export function setTheme(t: Theme) {
  current = t
  try { localStorage.setItem(KEY, t) } catch { /* ignora */ }
  apply()
}
export const initTheme = apply

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
/** tema escolhido e o tema efetivo (claro/escuro) */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, () => current)
  const resolved: 'light' | 'dark' = useSyncExternalStore(subscribe, () => (isDark() ? 'dark' : 'light'))
  return { theme, resolved }
}
