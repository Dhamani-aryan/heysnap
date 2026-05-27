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
import type { AccessSessionResponse } from '../lib/machines/machines-api.ts'
import { MachineStartingLoader } from '../components/machine-starting-loader.tsx'
import { WorkspaceLayout } from '../components/workspace/layout/workspace-layout.tsx'
import {
  buildGatewayHttpUrl,
  buildGatewayWebsocketUrl,
} from '../lib/gateway-url.ts'
import { env } from '../lib/env.ts'
import { useFilesystemConnection } from '../hooks/filesystem/use-filesystem-connection.ts'
import { useBrowserConnection } from '../hooks/browser/use-browser-connection.ts'
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
    <WorkspaceLayout>
      <WorkspaceContent computer={computer} accessSession={accessQuery.data} />
    </WorkspaceLayout>
  )
}

function WorkspaceContent({
  accessSession,
}: {
  computer: CloudComputer
  accessSession: AccessSessionResponse
}) {
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

  useFilesystemConnection({ wsUrl, previewBaseUrl })
  useBrowserConnection({ controlWebSocketUrl })

  return <WorkspaceSurfaceStack />
}

