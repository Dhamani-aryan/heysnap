import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import {
  accessSessionQueryOptions,
  machinesQueryOptions,
} from '../lib/machines/machines-query.ts'
import {
  useStartComputerMutation,
  useStopComputerMutation,
} from '../lib/machines/machines-mutations.ts'
import type {
  CloudComputer,
  CloudComputerStatus,
} from '../lib/machines/machines-api.ts'
import type { AccessSessionResponse } from '../lib/machines/machines-api.ts'
import { MachineStartingLoader } from '../components/machine-starting-loader.tsx'
import { WorkspaceLayout } from '../components/workspace/layout/workspace-layout.tsx'
import {
  buildGatewayHttpUrl,
  buildGatewayWebsocketUrl,
  normalizeGatewayConnectionIdentity,
} from '../lib/gateway-url.ts'
import { env } from '../lib/env.ts'
import { useFilesystemConnection } from '../hooks/filesystem/use-filesystem-connection.ts'
import { useBrowserConnection } from '../hooks/browser/use-browser-connection.ts'
import { useAgentConnection } from '../hooks/agent/use-agent-connection.ts'
import { useAgentThreadRoute } from '../hooks/agent/use-agent-thread-route.ts'
import { WorkspaceSurfaceStack } from '../components/workspace/layout/workspace-surface-stack.tsx'

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
  const stopMutation = useStopComputerMutation()
  const didAutoStartRef = useRef(false)
  const [isShuttingDown, setIsShuttingDown] = useState(false)
  const [mountedWorkspaceComputerId, setMountedWorkspaceComputerId] = useState<
    string | null
  >(null)
  const hasMountedWorkspace = mountedWorkspaceComputerId === computerId

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

  const goBackToMachines = useCallback((): void => {
    void navigate({ to: '/machines' })
  }, [navigate])

  const markWorkspaceMounted = useCallback((): void => {
    setMountedWorkspaceComputerId(computerId)
  }, [computerId])

  const shutDownMachine = useCallback(async (): Promise<void> => {
    if (stopMutation.isPending || isShuttingDown) return
    setIsShuttingDown(true)
    try {
      await stopMutation.mutateAsync(computerId)
      await navigate({ to: '/machines' })
    } catch (error) {
      console.error('Failed to shut down machine:', error)
      setIsShuttingDown(false)
    }
  }, [computerId, isShuttingDown, navigate, stopMutation])

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

  if (isShuttingDown) {
    return <MachineStartingLoader label="Shutting down" />
  }

  if (computer.status === 'sleeping' || isPendingStartup(computer.status)) {
    return <MachineStartingLoader />
  }

  if (!accessQuery.data) {
    return <MachineStartingLoader label="Connecting" />
  }

  if (computer.tunnelConnected !== true && !hasMountedWorkspace) {
    return <MachineStartingLoader label="Connecting" />
  }

  const browserViewPublishWebSocketUrl = accessQuery.data.routes
    .browserViewPublishWebSocketUrl
    ? buildGatewayWebsocketUrl({
        baseUrl: env.cloudServerUrl,
        path: accessQuery.data.routes.browserViewPublishWebSocketUrl,
        token: accessQuery.data.accessSession.token,
      })
    : undefined

  return (
    <WorkspaceLayout
      browserViewPublishWebSocketUrl={browserViewPublishWebSocketUrl}
    >
      <WorkspaceContent
        computer={computer}
        accessSession={accessQuery.data}
        isShuttingDown={isShuttingDown}
        onBackToMachines={goBackToMachines}
        onMounted={markWorkspaceMounted}
        onShutDownMachine={shutDownMachine}
      />
    </WorkspaceLayout>
  )
}

function WorkspaceContent({
  accessSession,
  computer,
  isShuttingDown,
  onBackToMachines,
  onMounted,
  onShutDownMachine,
}: {
  computer: CloudComputer
  accessSession: AccessSessionResponse
  isShuttingDown: boolean
  onBackToMachines: () => void
  onMounted: () => void
  onShutDownMachine: () => Promise<void>
}) {
  const workspaceIdentity = computer.id
  const wsUrl = buildGatewayWebsocketUrl({
    baseUrl: env.cloudServerUrl,
    path: accessSession.routes.filesystemWebSocketUrl,
    token: accessSession.accessSession.token,
  })
  const previewBaseUrl = accessSession.routes.filesystemPreviewBaseUrl
    ? buildGatewayHttpUrl({
        baseUrl: env.cloudServerUrl,
        path: accessSession.routes.filesystemPreviewBaseUrl,
        token: accessSession.accessSession.token,
      })
    : undefined
  const controlWebSocketUrl = accessSession.routes.browserControlWebSocketUrl
    ? buildGatewayWebsocketUrl({
        baseUrl: env.cloudServerUrl,
        path: accessSession.routes.browserControlWebSocketUrl,
        token: accessSession.accessSession.token,
      })
    : undefined

  const agentBaseUrl = buildGatewayHttpUrl({
    baseUrl: env.cloudServerUrl,
    path: accessSession.routes.agentBaseUrl,
    token: accessSession.accessSession.token,
  })
  const filesystemConnectionIdentity =
    normalizeGatewayConnectionIdentity(wsUrl)
  const browserControlConnectionIdentity = controlWebSocketUrl
    ? normalizeGatewayConnectionIdentity(controlWebSocketUrl)
    : undefined
  const agentIdentity = normalizeGatewayConnectionIdentity(agentBaseUrl)

  useEffect(() => {
    onMounted()
  }, [onMounted])

  useBrowserConnection({
    controlWebSocketUrl,
    controlConnectionIdentity: browserControlConnectionIdentity,
    workspaceIdentity,
  })
  useFilesystemConnection({
    wsUrl,
    previewBaseUrl,
    connectionIdentity: filesystemConnectionIdentity,
    workspaceIdentity,
  })
  useAgentConnection({ agentBaseUrl, agentIdentity })
  useAgentThreadRoute()

  return (
    <WorkspaceSurfaceStack
      isShuttingDown={isShuttingDown}
      onBackToMachines={onBackToMachines}
      onShutDownMachine={onShutDownMachine}
    />
  )
}
