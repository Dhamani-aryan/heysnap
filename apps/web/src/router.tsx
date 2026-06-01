import { Suspense } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router'
import type { AuthSnapshot } from './hooks/auth/use-auth.ts'
import { MachinesPage } from './pages/machines-page.tsx'
import { MachinesCreatePage } from './pages/machines-create-page.tsx'
import { MachineWorkspacePage } from './pages/machine-workspace-page.tsx'
import { LoginPage } from './pages/login-page.tsx'
import { FullPageLoader } from './components/full-page-loader.tsx'
import {
  machinesKeys,
  machinesQueryOptions,
} from './lib/machines/machines-query.ts'
import type { CloudComputer } from './lib/machines/machines-api.ts'

type RouterContext = {
  auth: AuthSnapshot
  queryClient: QueryClient
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <Suspense fallback={<FullPageLoader />}>
      <Outlet />
    </Suspense>
  ),
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: ({ context }) => {
    throw redirect({
      to: context.auth.status === 'authenticated' ? '/machines' : '/login',
    })
  },
})

const requireAuth = (
  context: RouterContext,
  location: { href: string },
) => {
  if (context.auth.status === 'unauthenticated') {
    throw redirect({
      to: '/login',
      search: { redirect: location.href },
    })
  }
}

const machinesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/machines',
  beforeLoad: ({ context, location }) => requireAuth(context, location),
  loader: async ({ context }) => {
    const cachedMachines = context.queryClient.getQueryData<CloudComputer[]>(
      machinesKeys.list,
    )
    const machines =
      cachedMachines && cachedMachines.length > 0
        ? await context.queryClient.ensureQueryData(machinesQueryOptions)
        : await context.queryClient.fetchQuery(machinesQueryOptions)

    if (machines.length === 0) {
      throw redirect({ to: '/machines/create', replace: true })
    }
  },
  component: MachinesPage,
})

const machinesCreateRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/machines/create',
  beforeLoad: ({ context, location }) => requireAuth(context, location),
  component: MachinesCreatePage,
})

const machineWorkspaceLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/machines/$computerId',
  beforeLoad: ({ context, location }) => requireAuth(context, location),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(machinesQueryOptions)
  },
  component: MachineWorkspacePage,
})

const machineWorkspaceIndexRoute = createRoute({
  getParentRoute: () => machineWorkspaceLayoutRoute,
  path: '/',
  component: () => null,
})

const machineWorkspaceThreadRoute = createRoute({
  getParentRoute: () => machineWorkspaceLayoutRoute,
  path: '$threadId',
  component: () => null,
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (search): { redirect?: string } => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  beforeLoad: ({ context }) => {
    if (context.auth.status === 'authenticated') {
      throw redirect({ to: '/machines' })
    }
  },
  component: LoginPage,
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  machinesRoute,
  machinesCreateRoute,
  machineWorkspaceLayoutRoute.addChildren([
    machineWorkspaceIndexRoute,
    machineWorkspaceThreadRoute,
  ]),
  loginRoute,
])

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
  context: { auth: undefined!, queryClient: undefined! },
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
