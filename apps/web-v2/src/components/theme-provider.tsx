import { useEffect } from 'react'
import { useResolvedTheme } from '../hooks/use-resolved-theme.ts'

type ThemeProviderProps = {
  children: React.ReactNode
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const resolvedTheme = useResolvedTheme()

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', resolvedTheme === 'dark')
  }, [resolvedTheme])

  return <>{children}</>
}
