import type { AgentHarnessName } from './types.ts'

export type PromptModelChoice = 'gpt' | 'claude'

export type NewThreadModelSelection = {
  readonly harness?: AgentHarnessName
  readonly provider?: string
  readonly model?: string
}

export function getNewThreadModelSelection({
  allowModelSelection,
  selectedThreadId,
  promptModelChoice,
}: {
  readonly allowModelSelection: boolean
  readonly selectedThreadId: string | null
  readonly promptModelChoice: PromptModelChoice
}): NewThreadModelSelection {
  if (!allowModelSelection || selectedThreadId !== null) {
    return {}
  }

  if (promptModelChoice === 'claude') {
    return {
      harness: 'pi',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
    }
  }

  return { harness: 'codex' }
}

export function getThreadModelChoice(threadId: string): PromptModelChoice {
  return decodeThreadId(threadId).startsWith('pi:') ? 'claude' : 'gpt'
}

function decodeThreadId(threadId: string): string {
  try {
    return decodeURIComponent(threadId)
  } catch {
    return threadId
  }
}
