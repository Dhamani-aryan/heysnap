import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowRight02Icon,
  Logout05Icon,
  PlusSignIcon,
} from '@hugeicons/core-free-icons'
import { ThemeToggle } from '../components/theme-toggle.tsx'
import { useLogoutMutation } from '../hooks/auth/use-auth-mutations.ts'
import {
  accessSessionQueryOptions,
  machinesQueryOptions,
} from '../lib/machines/machines-query.ts'
import type { CloudComputer } from '../lib/machines/machines-api.ts'

const DOT_BG_LIGHT =
  'radial-gradient(circle, rgba(74, 80, 92, 0.55) 1.45px, transparent 1.65px)'
const DOT_BG_DARK =
  'radial-gradient(circle, rgba(148, 163, 184, 0.58) 1.45px, transparent 1.65px)'
const DOT_MASK =
  'radial-gradient(circle at center, black 0%, black 56%, transparent 90%)'
const GLOW_LIGHT =
  'radial-gradient(circle at 50% 40%, rgba(143, 153, 178, 0.36), transparent 28%), radial-gradient(circle at 44% 54%, rgba(112, 144, 196, 0.18), transparent 36%)'
const GLOW_DARK =
  'radial-gradient(circle at 50% 40%, rgba(70, 130, 180, 0.24), transparent 28%), radial-gradient(circle at 44% 54%, rgba(153, 159, 222, 0.14), transparent 36%)'
const GLOW_MASK =
  'radial-gradient(circle at center, black 0%, black 46%, transparent 86%)'

type DisplayStatus = {
  status: string
  label: string
  canOpen: boolean
}

function formatStatus(status: string): string {
  return status
    .split('-')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function getDisplayStatus(computer: CloudComputer): DisplayStatus {
  if (computer.kind === 'local' && computer.tunnelConnected !== true) {
    return {
      status: 'tunnel-disconnected',
      label: 'Tunnel disconnected',
      canOpen: false,
    }
  }
  return {
    status: computer.status,
    label: formatStatus(computer.status),
    canOpen:
      computer.status !== 'creating' &&
      computer.status !== 'starting' &&
      computer.status !== 'failed',
  }
}

function statusDotColor(status: string): string {
  switch (status) {
    case 'online':
    case 'idle':
      return '#22c55e'
    case 'creating':
    case 'starting':
      return '#f59e0b'
    case 'failed':
    case 'tunnel-disconnected':
      return '#ef4444'
    case 'sleeping':
    case 'offline':
    case 'deleted':
    default:
      return '#9ca3af'
  }
}

function compareForDisplay(a: CloudComputer, b: CloudComputer): number {
  const ar = a.kind === 'local' ? 1 : 0
  const br = b.kind === 'local' ? 1 : 0
  if (ar !== br) return ar - br
  return a.createdAt.localeCompare(b.createdAt)
}

export function MachinesPage() {
  const logoutMutation = useLogoutMutation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: machines } = useSuspenseQuery(machinesQueryOptions)

  useEffect(() => {
    if (machines.length === 0) {
      void navigate({ to: '/machines/create', replace: true })
    }
  }, [machines.length, navigate])

  const sorted = [...machines].sort(compareForDisplay)
  const canCreate = sorted.length === 0

  return (
    <main className="grid min-h-[100dvh] grid-rows-[auto_minmax(0,1fr)] bg-background text-heading">
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

      <section className="min-h-0 overflow-auto px-[32px] pb-[48px] pt-[12px]">
        <div className="mx-auto w-full max-w-[1020px]">
          <h1 className="m-0 whitespace-nowrap text-[28px] font-[350] leading-none tracking-normal text-[#252629] dark:text-[#e3e4e6]">
            Computers
          </h1>
          <p className="mt-[10px] mb-0 text-[16px] font-[300] leading-[1.25] tracking-normal text-[#6f7073] dark:text-[#737375]">
            Your personal, private, AI computers.
          </p>

          <div className="mt-[80px] grid w-full grid-cols-2 gap-[32px] max-[680px]:mt-[64px] max-[680px]:grid-cols-1 max-[680px]:gap-[24px]">
            {sorted.map((computer) => (
              <MachineCard
                key={computer.id}
                computer={computer}
                onOpen={() =>
                  navigate({
                    to: '/machines/$computerId',
                    params: { computerId: computer.id },
                  })
                }
                onPrefetch={() => {
                  void queryClient.prefetchQuery(
                    accessSessionQueryOptions(computer.id),
                  )
                }}
              />
            ))}
            {canCreate ? (
              <button
                type="button"
                aria-label="Create remote machine"
                onClick={() => navigate({ to: '/machines/create' })}
                className="grid aspect-[4/3] grid-rows-[minmax(0,1fr)_auto] cursor-pointer place-items-center overflow-hidden border-0 bg-[#f1f1f1] p-0 text-[rgba(0,0,0,0.52)] hover:text-[#1f1f1f] focus-visible:text-[#1f1f1f] dark:bg-[#171719] dark:text-[rgba(255,255,255,0.62)] dark:hover:text-white dark:focus-visible:text-white"
              >
                <HugeiconsIcon
                  icon={PlusSignIcon}
                  size={34}
                  strokeWidth={1.6}
                />
              </button>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  )
}

function MachineCard({
  computer,
  onOpen,
  onPrefetch,
}: {
  computer: CloudComputer
  onOpen: () => void
  onPrefetch: () => void
}) {
  const display = getDisplayStatus(computer)
  const canOpen = display.canOpen
  const canPrefetch =
    canOpen && (computer.status === 'online' || computer.status === 'idle')

  const handlePrefetch = () => {
    if (canPrefetch) onPrefetch()
  }

  return (
    <button
      type="button"
      data-can-open={canOpen ? 'true' : 'false'}
      onClick={() => {
        if (!canOpen) return
        onOpen()
      }}
      onMouseEnter={handlePrefetch}
      onFocus={handlePrefetch}
      className="group relative grid aspect-[4/3] grid-rows-[minmax(0,1fr)_auto] cursor-pointer overflow-hidden rounded-none border border-[rgba(0,0,0,0.04)] bg-[#fbfbfb] p-0 text-left data-[can-open=false]:cursor-not-allowed dark:border-[rgba(255,255,255,0.06)] dark:bg-[#111113]"
    >
      <span
        title={display.label}
        aria-label={`Status: ${display.label}`}
        className="absolute left-[12px] top-[12px] z-[4] h-[12px] w-[12px] rounded-full border-2 border-[rgba(255,255,255,0.86)] dark:border-[rgba(17,17,19,0.9)]"
        style={{
          background: statusDotColor(display.status),
          boxShadow: '0 1px 4px rgba(0, 0, 0, 0.16)',
        }}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-[31px] top-[7px] z-[4] flex h-[22px] items-center whitespace-nowrap rounded-full border border-[rgba(0,0,0,0.06)] bg-[rgba(255,255,255,0.86)] px-[8px] text-[11px] font-normal leading-none tracking-normal text-[#37383b] opacity-0 -translate-x-[4px] transition-[opacity,transform] duration-150 ease-out group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100 dark:border-[rgba(255,255,255,0.07)] dark:bg-[rgba(24,24,27,0.88)] dark:text-[#d0d0d3]"
      >
        {display.label}
      </span>

      <div className="relative min-h-0 overflow-hidden p-[28px]">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.38] dark:opacity-[0.68]"
          style={{
            backgroundImage: 'var(--card-dot-bg)',
            backgroundPosition: 'center',
            backgroundSize: '14px 14px',
            maskImage: DOT_MASK,
            WebkitMaskImage: DOT_MASK,
            // @ts-expect-error CSS custom property
            '--card-dot-bg': DOT_BG_LIGHT,
          }}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 hidden opacity-[0.68] dark:block"
          style={{
            backgroundImage: DOT_BG_DARK,
            backgroundPosition: 'center',
            backgroundSize: '14px 14px',
            maskImage: DOT_MASK,
            WebkitMaskImage: DOT_MASK,
          }}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.32] dark:opacity-[0.22]"
          style={{
            background: 'var(--card-glow)',
            maskImage: GLOW_MASK,
            WebkitMaskImage: GLOW_MASK,
            // @ts-expect-error CSS custom property
            '--card-glow': GLOW_LIGHT,
          }}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 hidden opacity-[0.22] dark:block"
          style={{
            background: GLOW_DARK,
            maskImage: GLOW_MASK,
            WebkitMaskImage: GLOW_MASK,
          }}
        />

        <img
          src="/mac/mac-light.png"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 z-[2] m-auto block max-h-[86%] w-[min(74%,300px)] translate-y-[14px] object-contain dark:hidden"
        />
        <img
          src="/mac/mac.png"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 z-[2] m-auto hidden max-h-[86%] w-[min(74%,300px)] translate-y-[14px] object-contain dark:block"
        />
      </div>

      <div className="relative z-[3] flex min-h-[52px] items-center justify-between gap-[14px] px-[18px] text-[16px] font-[350] leading-[1.2] tracking-normal text-[#37383b] dark:text-[#d0d0d3]">
        <span className="min-w-0">{`Work on ${computer.name}`}</span>
        <span
          aria-hidden="true"
          className="flex-none -translate-x-[4px] opacity-0 transition-[opacity,transform] duration-200 ease-out group-data-[can-open=true]:group-hover:translate-x-0 group-data-[can-open=true]:group-hover:opacity-100 group-data-[can-open=true]:group-focus-within:translate-x-0 group-data-[can-open=true]:group-focus-within:opacity-100"
        >
          <HugeiconsIcon
            icon={ArrowRight02Icon}
            size={18}
            strokeWidth={1.65}
          />
        </span>
      </div>
    </button>
  )
}
