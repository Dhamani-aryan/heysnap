import { CenteredMessage } from '../components/centered-message.tsx'

export function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-center text-white">
      <CenteredMessage />
    </main>
  )
}
