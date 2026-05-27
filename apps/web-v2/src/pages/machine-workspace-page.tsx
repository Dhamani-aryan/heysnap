import { useEffect, useRef } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import {
  accessSessionQueryOptions,
  machinesQueryOptions,
} from '../lib/machines/machines-query.ts'
import { useStartComputerMutation } from '../lib/machines/machines-mutations.ts'
import type {
  CloudComputer,
  CloudComputerStatus,
} from '../lib/machines/machines-api.ts'
import { MachineStartingLoader } from '../components/machine-starting-loader.tsx'

function isConnectable(status: CloudComputerStatus): boolean {
  return status === 'online' || status === 'idle'
}

function isPendingStartup(status: CloudComputerStatus): boolean {
  return status === 'creating' || status === 'starting'
}

function isTerminal(status: CloudComputerStatus): boolean {
  return status === 'failed' || status === 'offline' || status === 'deleted'
}

export function MachineWorkspacePage() {
  const { computerId } = useParams({ from: '/machines/$computerId' })
  const navigate = useNavigate()

  const { data: machines, isFetching: isMachinesFetching } = useSuspenseQuery(
    machinesQueryOptions,
  )
  const computer = machines.find((m): m is CloudComputer => m.id === computerId)

  const startMutation = useStartComputerMutation()
  const didAutoStartRef = useRef(false)

  useEffect(() => {
    if (!computer) return
    if (computer.kind === 'local') return
    if (computer.status !== 'sleeping') return
    if (didAutoStartRef.current) return
    if (startMutation.isPending || startMutation.isError) return
    didAutoStartRef.current = true
    startMutation.mutate(computerId)
  }, [computer, computerId, startMutation])

  const canFetchAccessSession = computer ? isConnectable(computer.status) : false
  const accessQuery = useQuery({
    ...accessSessionQueryOptions(computerId),
    enabled: canFetchAccessSession,
  })

  const shouldRedirect =
    (!computer && !isMachinesFetching) ||
    (computer && isTerminal(computer.status)) ||
    startMutation.isError ||
    accessQuery.isError

  useEffect(() => {
    if (shouldRedirect) {
      void navigate({ to: '/machines', replace: true })
    }
  }, [shouldRedirect, navigate])

  if (!computer) {
    return <MachineStartingLoader label="Loading" />
  }

  if (
    isTerminal(computer.status) ||
    startMutation.isError ||
    accessQuery.isError
  ) {
    return <MachineStartingLoader label="Loading" />
  }

  if (computer.status === 'sleeping' || isPendingStartup(computer.status)) {
    return <MachineStartingLoader />
  }

  if (!accessQuery.data) {
    return <MachineStartingLoader label="Connecting" />
  }

  return (
    <WorkspacePlaceholder
      computer={computer}
      onBack={() => navigate({ to: '/machines' })}
    />
  )
}

function WorkspacePlaceholder({
  computer,
  onBack,
}: {
  computer: CloudComputer
  onBack: () => void
}) {
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-background px-xl text-heading">
      <div className="flex flex-col items-center gap-md text-center">
        <h1 className="m-0 text-[32px] font-[500] leading-[38px] tracking-[-0.045em]">
          {computer.name}
        </h1>
        <p className="text-[15px] leading-[24px] text-subheading">
          Workspace ready. UI coming soon.
        </p>
        <button
          type="button"
          onClick={onBack}
          className="mt-md inline-flex h-9 items-center justify-center rounded-md border border-border bg-secondary px-md text-[13px] font-[520] leading-[18px] text-heading transition-colors duration-150 hover:bg-secondary-hover"
        >
          Back to machines
        </button>
      </div>
    </main>
  )
}

