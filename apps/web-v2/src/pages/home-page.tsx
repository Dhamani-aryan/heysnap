import { CenteredMessage } from '../components/centered-message.tsx'

export function HomePage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center bg-background px-xl text-center text-heading">
      <CenteredMessage />
    </main>
  )
}
