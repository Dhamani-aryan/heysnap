import { RouterProvider } from '@tanstack/react-router'
import { useAuth } from './hooks/auth/use-auth.ts'
import { router } from './router.tsx'
import { FullPageLoader } from './components/full-page-loader.tsx'

function App() {
  const auth = useAuth()

  if (auth.status === 'checking') {
    return <FullPageLoader />
  }

  return <RouterProvider router={router} context={{ auth }} />
}

export default App
