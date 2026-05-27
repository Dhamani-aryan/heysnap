import { queryOptions } from '@tanstack/react-query'
import { listComputers, type CloudComputer } from './machines-api.ts'

export const machinesKeys = {
  all: ['machines'] as const,
  list: ['machines', 'list'] as const,
}

const PENDING_STATUSES: ReadonlyArray<CloudComputer['status']> = [
  'starting',
  'creating',
]

const DEFAULT_INTERVAL_MS = 5_000
const PENDING_INTERVAL_MS = 2_000

export function hasPendingMachine(machines: CloudComputer[]): boolean {
  return machines.some((m) => PENDING_STATUSES.includes(m.status))
}

export const machinesQueryOptions = queryOptions({
  queryKey: machinesKeys.list,
  queryFn: ({ signal }) => listComputers(signal),
  staleTime: 0,
  refetchInterval: (query) => {
    const data = query.state.data
    if (!data) return DEFAULT_INTERVAL_MS
    return hasPendingMachine(data) ? PENDING_INTERVAL_MS : DEFAULT_INTERVAL_MS
  },
})
