import { create } from 'zustand'
import type { PromptModelChoice } from '../../lib/agent/model-selection'

type AgentModelSelectionState = {
  promptModelChoice: PromptModelChoice
  setPromptModelChoice: (choice: PromptModelChoice) => void
}

export const useAgentModelSelectionStore = create<AgentModelSelectionState>(
  (set) => ({
    promptModelChoice: 'gpt',
    setPromptModelChoice: (choice) => set({ promptModelChoice: choice }),
  }),
)
