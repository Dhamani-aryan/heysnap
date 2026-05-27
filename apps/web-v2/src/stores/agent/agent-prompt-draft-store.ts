import { create } from 'zustand'

export type PromptAttachment = {
  readonly id: string
  readonly type: 'image' | 'file'
  readonly fileName: string
  readonly mimeType: string
  readonly size: number
  readonly content: string
}

export type PromptDraft = {
  readonly text: string
  readonly attachments: readonly PromptAttachment[]
}

export const NEW_THREAD_DRAFT_KEY = '__new__'

export const EMPTY_PROMPT_DRAFT: PromptDraft = {
  text: '',
  attachments: [],
}

type AgentPromptDraftState = {
  drafts: Record<string, PromptDraft>
  setText: (threadId: string | null, text: string) => void
  setAttachments: (
    threadId: string | null,
    attachments: readonly PromptAttachment[],
  ) => void
  clearDraft: (threadId: string | null) => void
  rekeyDraft: (fromThreadId: string | null, toThreadId: string | null) => void
}

function keyFor(threadId: string | null): string {
  return threadId ?? NEW_THREAD_DRAFT_KEY
}

function updateDraft(
  drafts: Record<string, PromptDraft>,
  threadId: string | null,
  updater: (current: PromptDraft) => PromptDraft,
): Record<string, PromptDraft> {
  const key = keyFor(threadId)
  const current = drafts[key] ?? EMPTY_PROMPT_DRAFT
  const next = updater(current)
  if (next.text.length === 0 && next.attachments.length === 0) {
    if (drafts[key] === undefined) return drafts
    const rest = { ...drafts }
    delete rest[key]
    return rest
  }
  return { ...drafts, [key]: next }
}

export const useAgentPromptDraftStore = create<AgentPromptDraftState>(
  (set) => ({
    drafts: {},
    setText: (threadId, text) =>
      set((state) => ({
        drafts: updateDraft(state.drafts, threadId, (current) => ({
          ...current,
          text,
        })),
      })),
    setAttachments: (threadId, attachments) =>
      set((state) => ({
        drafts: updateDraft(state.drafts, threadId, (current) => ({
          ...current,
          attachments,
        })),
      })),
    clearDraft: (threadId) =>
      set((state) => {
        const key = keyFor(threadId)
        if (state.drafts[key] === undefined) return state
        const rest = { ...state.drafts }
        delete rest[key]
        return { drafts: rest }
      }),
    rekeyDraft: (fromThreadId, toThreadId) =>
      set((state) => {
        const fromKey = keyFor(fromThreadId)
        const toKey = keyFor(toThreadId)
        if (fromKey === toKey) return state
        const draft = state.drafts[fromKey]
        if (draft === undefined) return state
        const rest = { ...state.drafts }
        delete rest[fromKey]
        return { drafts: { ...rest, [toKey]: draft } }
      }),
  }),
)

export function selectPromptDraft(
  threadId: string | null,
): (state: AgentPromptDraftState) => PromptDraft {
  const key = keyFor(threadId)
  return (state) => state.drafts[key] ?? EMPTY_PROMPT_DRAFT
}
