import { useEffect } from 'react'
import { RouterProvider } from '@tanstack/react-router'
import { useAuth } from './hooks/auth/use-auth.ts'
import { router } from './router.tsx'
import { queryClient } from './lib/query-client.ts'
import { FullPageLoader } from './components/full-page-loader.tsx'
import { AppToaster } from './components/app-toaster.tsx'

function App() {
  const auth = useAuth()

  useEffect(() => {
    if (auth.status === 'checking') return
    void router.invalidate()
  }, [auth.status])

  if (auth.status === 'checking') {
    return <FullPageLoader />
  }

  return (
    <>
      <RouterProvider router={router} context={{ auth, queryClient }} />
      <AppToaster />
    </>
  )
}

export default App
