import { useNavigate } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { Logout05Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { toast } from 'sonner'
import { ThemeToggle } from '../components/theme-toggle.tsx'
import { useAuth } from '../hooks/auth/use-auth.ts'
import { useLogoutMutation } from '../hooks/auth/use-auth-mutations.ts'
import { useCreateComputerMutation } from '../lib/machines/machines-mutations.ts'

function defaultMachineName(username: string | null | undefined): string {
  const trimmed = (username ?? '').trim()
  if (trimmed.length === 0) return ''
  return `${trimmed[0]!.toUpperCase()}${trimmed.slice(1)}'s Computer`
}

export function MachinesCreatePage() {
  const { user } = useAuth()
  const logoutMutation = useLogoutMutation()
  const createMutation = useCreateComputerMutation()
  const navigate = useNavigate()

  const machineName = user ? defaultMachineName(user.username) : ''
  const error =
    createMutation.error instanceof Error ? createMutation.error.message : null

  const handleSubmit = (event: { preventDefault: () => void }) => {
    event.preventDefault()
    if (machineName.length === 0 || createMutation.isPending) return
    createMutation.mutate(
      { name: machineName },
      {
        onSuccess: () => {
          toast.success('Welcome!', {
            description: 'Creating a computer can take couple of minutes',
            icon: (
              <span className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[#27A644] text-white">
                <HugeiconsIcon icon={Tick02Icon} size={12} strokeWidth={3} />
              </span>
            ),
          })
          void navigate({ to: '/machines', replace: true })
        },
      },
    )
  }

  return (
    <main className="relative grid min-h-screen grid-rows-[auto_minmax(0,1fr)] bg-background text-heading">
      <header className="flex min-h-[56px] items-center justify-end gap-2xs bg-background p-sm">
        <button
          type="button"
          onClick={() => logoutMutation.mutate()}
          disabled={logoutMutation.isPending}
          aria-label="Sign out"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-subheading transition-[transform,background-color,color] duration-150 ease-out hover:bg-secondary-hover hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ghost active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <HugeiconsIcon icon={Logout05Icon} size={18} strokeWidth={1.75} />
        </button>
        <ThemeToggle />
      </header>

      <section
        className="grid self-stretch place-items-center px-xl pb-[96px] pt-0"
        aria-labelledby="cloud-remote-create-title"
      >
        <form
          onSubmit={handleSubmit}
          className="grid w-full max-w-[420px] justify-items-center gap-lg text-center"
        >
          <h1
            id="cloud-remote-create-title"
            className="m-0 text-[28px] font-[350] leading-none tracking-normal text-[#252629] dark:text-[#e3e4e6]"
          >
            Your personal, private, AI computer
          </h1>

          <div
            className="relative mx-0 my-0 -mb-[10px] mt-[4px] aspect-square w-[min(78vw,280px)]"
            aria-hidden="true"
          >
            <span
              className="pointer-events-none absolute inset-[4%] opacity-[0.36] dark:opacity-[0.64]"
              style={{
                backgroundImage:
                  'radial-gradient(circle, rgba(74, 80, 92, 0.52) 1.45px, transparent 1.65px)',
                backgroundPosition: 'center',
                backgroundSize: '14px 14px',
                maskImage:
                  'radial-gradient(circle at center, black 0%, black 56%, transparent 88%)',
                WebkitMaskImage:
                  'radial-gradient(circle at center, black 0%, black 56%, transparent 88%)',
              }}
            />
            <img
              src="/mac/mac-light.png"
              alt=""
              className="absolute inset-0 z-[1] block h-full w-full translate-y-[14px] object-contain dark:hidden"
            />
            <img
              src="/mac/mac.png"
              alt=""
              className="absolute inset-0 z-[1] hidden h-full w-full translate-y-[14px] object-contain dark:block"
            />
          </div>

          <div
            className="grid w-full max-w-[280px] -mt-[4px] text-center"
            aria-label="Machine name"
          >
            <strong className="overflow-wrap-anywhere text-[20px] font-[500] leading-[1.2] tracking-normal text-heading [overflow-wrap:anywhere]">
              {machineName}
            </strong>
          </div>

          {error !== null ? (
            <div
              role="alert"
              className="w-full rounded-lg border border-[rgba(180,35,24,0.22)] bg-[rgba(229,72,77,0.08)] px-md py-[10px] text-[13px] text-[#b42318] dark:bg-[rgba(229,72,77,0.12)] dark:text-[#f87171]"
            >
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={createMutation.isPending || machineName.length === 0}
            aria-label={
              createMutation.isPending ? 'Creating remote machine' : undefined
            }
            className="mt-[18px] flex h-[42px] w-full max-w-[280px] items-center justify-center rounded-pill bg-[#111111] px-md text-[15px] font-[520] leading-[20px] text-white transition-[transform,background-color] duration-150 ease-out hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ghost active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55 dark:bg-[#f5f5f5] dark:text-[#0f0f11] dark:hover:bg-white"
          >
            {createMutation.isPending ? (
              <span
                aria-hidden="true"
                className="block h-[18px] w-[18px] animate-spin rounded-full border-2 border-current border-r-transparent"
              />
            ) : (
              'Create'
            )}
          </button>
        </form>
      </section>
    </main>
  )
}
