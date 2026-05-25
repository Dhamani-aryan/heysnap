import { createStore, type StoreApi } from "zustand/vanilla";

import type { AgentThreadGroup, AgentThreadSummary } from "../../agent/types";

export interface AgentThreadListState {
  readonly groups: readonly AgentThreadGroup[];
  readonly isLoading: boolean;
  readonly hasLoaded: boolean;
  readonly error: string | null;
  readonly setLoading: (isLoading: boolean) => void;
  readonly replaceGroups: (groups: readonly AgentThreadGroup[]) => void;
  readonly setError: (message: string | null) => void;
  readonly upsertThread: (thread: AgentThreadSummary) => void;
  readonly setThreadStreaming: (threadId: string, isStreaming: boolean) => void;
  readonly reset: () => void;
}

export type AgentThreadListStore = StoreApi<AgentThreadListState>;

export const createAgentThreadListStore = (): AgentThreadListStore =>
  createStore<AgentThreadListState>((set) => ({
    groups: [],
    isLoading: false,
    hasLoaded: false,
    error: null,
    setLoading: (isLoading) => {
      set({
        isLoading,
        ...(isLoading ? { error: null } : {}),
      });
    },
    replaceGroups: (groups) => {
      set({
        groups: groups.map((group) => ({
          path: group.path,
          threads: [...group.threads],
        })),
        isLoading: false,
        hasLoaded: true,
        error: null,
      });
    },
    setError: (message) => {
      set({
        isLoading: false,
        hasLoaded: true,
        error: message,
      });
    },
    upsertThread: (thread) => {
      set((state) => {
        const targetPath = thread.lastPath.trim().length > 0 ? thread.lastPath : thread.startPath;
        const groupPath = targetPath.trim();
        let didPlaceThread = false;
        const groups = state.groups.map((group) => {
          const existingThread = group.threads.find((currentThread) => currentThread.id === thread.id);
          const withoutThread = group.threads.filter((currentThread) => currentThread.id !== thread.id);

          if (group.path !== groupPath && existingThread === undefined) {
            return group;
          }

          if (group.path !== groupPath) {
            return { ...group, threads: withoutThread };
          }

          didPlaceThread = true;
          return {
            ...group,
            threads: sortThreadsByUpdatedAt([thread, ...withoutThread]),
          };
        });

        if (!didPlaceThread) {
          groups.unshift({ path: groupPath, threads: [thread] });
        }

        return {
          groups,
          hasLoaded: true,
          error: null,
        };
      });
    },
    setThreadStreaming: (threadId, isStreaming) => {
      set((state) => {
        let didChange = false;
        const groups = state.groups.map((group) => {
          const threads = group.threads.map((thread) => {
            if (thread.id !== threadId || thread.isStreaming === isStreaming) {
              return thread;
            }

            didChange = true;
            return { ...thread, isStreaming };
          });

          return didChange ? { ...group, threads } : group;
        });

        return didChange ? { groups } : state;
      });
    },
    reset: () => {
      set({
        groups: [],
        isLoading: false,
        hasLoaded: false,
        error: null,
      });
    },
  }));

export const selectHasThreads = (state: AgentThreadListState): boolean =>
  state.groups.some((group) => group.threads.length > 0);

export const selectHasStreamingThreads = (state: AgentThreadListState): boolean =>
  state.groups.some((group) => group.threads.some((thread) => thread.isStreaming === true));

const sortThreadsByUpdatedAt = (threads: readonly AgentThreadSummary[]): AgentThreadSummary[] =>
  [...threads].sort((left, right) => right.updatedAt - left.updatedAt);
