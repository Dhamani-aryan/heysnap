import { apiRequest } from '../api-client.ts'

export type CloudComputerStatus =
  | 'sleeping'
  | 'online'
  | 'idle'
  | 'starting'
  | 'creating'
  | 'failed'
  | 'offline'
  | 'deleted'

export type CloudComputer = {
  id: string
  name: string
  kind: 'cloud' | 'local'
  status: CloudComputerStatus
  ownerUserId: string
  machineServerVersion: string | null
  lastHeartbeatAt: string | null
  tunnelConnected: boolean
  createdAt: string
  updatedAt: string
}

type ListComputersResponse = {
  computers: CloudComputer[]
}

type ComputerResponse = {
  computer: CloudComputer
}

export async function listComputers(
  signal?: AbortSignal,
): Promise<CloudComputer[]> {
  const response = await apiRequest<ListComputersResponse>('/computers', {
    signal,
  })
  return response.computers
}

export async function createComputer(input: {
  name: string
}): Promise<CloudComputer> {
  const response = await apiRequest<ComputerResponse>('/computers', {
    method: 'POST',
    body: input,
  })
  return response.computer
}
