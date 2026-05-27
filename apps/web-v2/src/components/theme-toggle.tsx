import { HugeiconsIcon } from '@hugeicons/react'
import { Moon02Icon, Sun01Icon } from '@hugeicons/core-free-icons'
import { resolveTheme, useThemeStore } from '../stores/theme-store.ts'

export function ThemeToggle() {
  const theme = useThemeStore((state) => state.theme)
  const setTheme = useThemeStore((state) => state.setTheme)
  const resolved = resolveTheme(theme)
  const isDark = resolved === 'dark'

  return (
    <button
      type="button"
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-subheading transition-[transform,background-color,color] duration-150 ease-out hover:bg-secondary-hover hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ghost active:scale-[0.97]"
    >
      <HugeiconsIcon
        icon={isDark ? Sun01Icon : Moon02Icon}
        size={isDark ? 19 : 18}
        strokeWidth={1.75}
      />
    </button>
  )
}
