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

export async function startComputer(computerId: string): Promise<CloudComputer> {
  const response = await apiRequest<ComputerResponse>(
    `/computers/${encodeURIComponent(computerId)}/start`,
    { method: 'POST' },
  )
  return response.computer
}

export async function stopComputer(computerId: string): Promise<CloudComputer> {
  const response = await apiRequest<ComputerResponse>(
    `/computers/${encodeURIComponent(computerId)}/stop`,
    { method: 'POST' },
  )
  return response.computer
}

export type AccessSession = {
  id: string
  computerId: string
  token: string
  scopes?: readonly string[]
  expiresAt: string
}

export type AccessSessionRoutes = {
  filesystemWebSocketUrl: string
  filesystemPreviewBaseUrl?: string
  filesystemPreviewWebSocketUrl?: string
  browserControlWebSocketUrl?: string
  browserControlStatusUrl?: string
  browserViewPublishWebSocketUrl?: string
  browserViewSubscribeWebSocketUrl?: string
  agentBaseUrl: string
  capabilitiesBaseUrl?: string
}

export type AccessSessionResponse = {
  accessSession: AccessSession
  routes: AccessSessionRoutes
}

export async function createAccessSession(
  computerId: string,
  signal?: AbortSignal,
): Promise<AccessSessionResponse> {
  return apiRequest<AccessSessionResponse>(
    `/computers/${encodeURIComponent(computerId)}/access-session`,
    { method: 'POST', signal },
  )
}
