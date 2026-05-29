import { useEffect, useState } from 'react'
import { Toaster } from 'sonner'

type ToastTheme = 'light' | 'dark'

function getResolvedTheme(): ToastTheme {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

export function AppToaster() {
  const [theme, setTheme] = useState<ToastTheme>(() => getResolvedTheme())

  useEffect(() => {
    const root = document.documentElement
    const update = () => setTheme(getResolvedTheme())
    const observer = new MutationObserver(update)
    update()
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return (
    <Toaster
      position="bottom-right"
      theme={theme}
      toastOptions={{ duration: 8000 }}
    />
  )
}
