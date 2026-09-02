import { queryOptions } from '@tanstack/react-query';
import {
  createAccessSession,
  listComputers,
  type CloudComputer,
} from './machines-api';

export const ACCESS_SESSION_REFRESH_BUFFER_MS = 60_000;

export const machinesKeys = {
  all: ['machines'] as const,
  list: ['machines', 'list'] as const,
  accessSession: (id: string) => ['machines', 'access-session', id] as const,
};

const PENDING_STATUSES: readonly CloudComputer['status'][] = [
  'starting',
  'creating',
];

const DEFAULT_INTERVAL_MS = 5_000;
const PENDING_INTERVAL_MS = 2_000;

export function hasPendingMachine(machines: CloudComputer[]): boolean {
  return machines.some((machine) => PENDING_STATUSES.includes(machine.status));
}

export const machinesQueryOptions = queryOptions({
  queryKey: machinesKeys.list,
  queryFn: ({ signal }) => listComputers(signal),
  staleTime: 0,
  refetchInterval: (query) => {
    const data = query.state.data;
    if (!data) return DEFAULT_INTERVAL_MS;
    return hasPendingMachine(data) ? PENDING_INTERVAL_MS : DEFAULT_INTERVAL_MS;
  },
});

export function accessSessionQueryOptions(computerId: string) {
  return queryOptions({
    queryKey: machinesKeys.accessSession(computerId),
    queryFn: ({ signal }) => createAccessSession(computerId, signal),
    staleTime: (query) => {
      const data = query.state.data;
      if (!data) return 0;
      const expiresAtMs = Date.parse(data.accessSession.expiresAt);
      if (!Number.isFinite(expiresAtMs)) return 0;
      return Math.max(
        0,
        expiresAtMs - Date.now() - ACCESS_SESSION_REFRESH_BUFFER_MS,
      );
    },
    refetchOnWindowFocus: true,
  });
}
