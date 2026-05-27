import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router'
import type { AuthSnapshot } from './hooks/auth/use-auth.ts'
import { MachinesPage } from './pages/machines-page.tsx'
import { LoginPage } from './pages/login-page.tsx'

type RouterContext = {
  auth: AuthSnapshot
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: () => <Outlet />,
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

const machinesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/machines',
  beforeLoad: ({ context, location }) => {
    if (context.auth.status === 'unauthenticated') {
      throw redirect({
        to: '/login',
        search: { redirect: location.href },
      })
    }
  },
  component: MachinesPage,
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

const routeTree = rootRoute.addChildren([indexRoute, machinesRoute, loginRoute])

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
  context: { auth: undefined! },
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
