"use client";

import { createContext, useContext, useMemo, useRef, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useStore } from "zustand";

import type { AgentRunHandle } from "./agent-client";
import { createAgentChatStore, type AgentChatState, type AgentChatStore } from "../stores/agent/agent-store";
import {
  createAgentThreadListStore,
  type AgentThreadListState,
  type AgentThreadListStore,
} from "../stores/agent/agent-thread-list-store";

export interface AgentRuntimeProviderProps {
  readonly agentBaseUrl: string;
  readonly children: React.ReactNode;
}

export interface AgentRuntime {
  readonly agentBaseUrl: string;
  readonly chatStore: AgentChatStore;
  readonly threadListStore: AgentThreadListStore;
  readonly activeRunHandleRef: React.MutableRefObject<AgentRunHandle | null>;
  readonly flushFrameRef: React.MutableRefObject<number | null>;
}

const AgentRuntimeContext = createContext<AgentRuntime | null>(null);

export function AgentRuntimeProvider({
  agentBaseUrl,
  children,
}: AgentRuntimeProviderProps): React.ReactElement {
  const [queryClient] = useState(() =>
    new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          refetchOnWindowFocus: false,
        },
        mutations: {
          retry: false,
        },
      },
    })
  );
  const [chatStore] = useState(() => createAgentChatStore());
  const [threadListStore] = useState(() => createAgentThreadListStore());
  const activeRunHandleRef = useRef<AgentRunHandle | null>(null);
  const flushFrameRef = useRef<number | null>(null);
  const runtime = useMemo<AgentRuntime>(() => ({
    agentBaseUrl,
    chatStore,
    threadListStore,
    activeRunHandleRef,
    flushFrameRef,
  }), [agentBaseUrl, chatStore, threadListStore]);

  return (
    <QueryClientProvider client={queryClient}>
      <AgentRuntimeContext.Provider value={runtime}>
        {children}
      </AgentRuntimeContext.Provider>
    </QueryClientProvider>
  );
}

export const useOptionalAgentRuntime = (): AgentRuntime | null =>
  useContext(AgentRuntimeContext);

export const useAgentRuntime = (): AgentRuntime => {
  const runtime = useOptionalAgentRuntime();

  if (runtime === null) {
    throw new Error("AgentRuntimeProvider is required.");
  }

  return runtime;
};

export const useAgentChatStore = <T,>(selector: (state: AgentChatState) => T): T => {
  const { chatStore } = useAgentRuntime();
  return useStore(chatStore, selector);
};

export const useAgentThreadListStore = <T,>(selector: (state: AgentThreadListState) => T): T => {
  const { threadListStore } = useAgentRuntime();
  return useStore(threadListStore, selector);
};
