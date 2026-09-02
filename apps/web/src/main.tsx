import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import 'streamdown/styles.css'
import './globals.css'
import './components/agent/agent.css'
import './components/voice/voice.css'
import App from './App.tsx'
import { ThemeProvider } from './components/theme-provider.tsx'
import { queryClient } from './lib/query-client.ts'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
)
