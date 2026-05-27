import { HugeiconsIcon } from '@hugeicons/react'
import { Moon02Icon, Sun01Icon } from '@hugeicons/core-free-icons'
import { resolveTheme, useThemeStore } from '../stores/theme-store.ts'

type Props = {
  compact?: boolean
}

export function ThemeToggle({ compact = false }: Props = {}) {
  const theme = useThemeStore((state) => state.theme)
  const setTheme = useThemeStore((state) => state.setTheme)
  const resolved = resolveTheme(theme)
  const isDark = resolved === 'dark'
  const sizeClasses = compact ? 'h-7 w-7' : 'h-9 w-9'
  const hoverClass = compact ? 'hover:bg-sidebar-hover' : 'hover:bg-secondary-hover'

  return (
    <button
      type="button"
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className={`inline-flex ${sizeClasses} items-center justify-center rounded-md text-subheading transition-[transform,background-color,color] duration-150 ease-out ${hoverClass} hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ghost active:scale-[0.97]`}
    >
      <HugeiconsIcon
        icon={isDark ? Sun01Icon : Moon02Icon}
        size={isDark ? 19 : 18}
        strokeWidth={1.75}
      />
    </button>
  )
}
