import { create } from 'zustand'

type AgentPromptFocusState = {
  focusToken: number
  requestFocus: () => void
}

export const useAgentPromptFocusStore = create<AgentPromptFocusState>((set) => ({
  focusToken: 0,
  requestFocus: () => set((state) => ({ focusToken: state.focusToken + 1 })),
}))
