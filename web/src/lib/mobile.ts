import { useSyncExternalStore } from 'react'

// celulares e tablets pequenos em pé: < 768px (mesmo ponto do breakpoint "md" do Tailwind)
const mq = typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)') : null
const sub = (cb: () => void) => { mq?.addEventListener('change', cb); return () => mq?.removeEventListener('change', cb) }
export const useIsMobile = () => useSyncExternalStore(sub, () => !!mq?.matches, () => false)
