import { CenteredMessage } from '../components/centered-message.tsx'
import { ThemeToggle } from '../components/theme-toggle.tsx'
import { useAuth } from '../hooks/auth/use-auth.ts'
import { useLogoutMutation } from '../hooks/auth/use-auth-mutations.ts'

export function MachinesPage() {
  const { user } = useAuth()
  const logoutMutation = useLogoutMutation()

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-background px-xl text-center text-heading">
      <div className="absolute right-sm top-sm flex items-center gap-xs">
        <button
          type="button"
          onClick={() => logoutMutation.mutate()}
          disabled={logoutMutation.isPending}
          className="inline-flex h-9 items-center rounded-md px-sm text-[13px] font-[520] text-subheading transition-[transform,background-color,color] duration-150 ease-out hover:bg-secondary-hover hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ghost active:scale-[0.97] disabled:opacity-60"
        >
          {logoutMutation.isPending ? 'Signing out…' : 'Sign out'}
        </button>
        <ThemeToggle />
      </div>

      <div className="flex flex-col items-center gap-sm">
        <CenteredMessage />
        {user && (
          <p className="text-[13px] leading-[20px] text-subheading">
            Signed in as {user.email}
          </p>
        )}
      </div>
    </main>
  )
}
