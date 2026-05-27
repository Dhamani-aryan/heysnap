import { CenteredMessage } from '../components/centered-message.tsx'
import { ThemeToggle } from '../components/theme-toggle.tsx'

export function HomePage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center bg-background px-xl text-center text-heading">
      <div className="absolute right-sm top-sm">
        <ThemeToggle />
      </div>
      <CenteredMessage />
    </main>
  )
}
