import { useEffect, useState } from 'react'
import {
  getSystemTheme,
  resolveTheme,
  useThemeStore,
  type ResolvedTheme,
} from '../stores/theme-store.ts'

export function useResolvedTheme(): ResolvedTheme {
  const theme = useThemeStore((state) => state.theme)
  const [systemTheme, setSystemTheme] = useState(getSystemTheme)

  useEffect(() => {
    if (theme !== 'system') return

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const updateSystemTheme = (): void => setSystemTheme(getSystemTheme())

    updateSystemTheme()
    media.addEventListener('change', updateSystemTheme)
    return () => media.removeEventListener('change', updateSystemTheme)
  }, [theme])

  return theme === 'system' ? systemTheme : resolveTheme(theme)
}
