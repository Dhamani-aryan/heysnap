"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useStore } from "zustand";

import {
  editAgentThreadUserMessage,
  getAgentThread,
  resumeAgentRun,
  retrieveAgentThreadGroups,
  startAgentRun,
  steerAgentRun,
} from "./agent-client";
import type { ActiveRunState } from "./agent-store";
import { useAgentRuntime } from "./agent-runtime";
import { selectHasStreamingThreads } from "./agent-thread-list-store";
import type {
  AgentContent,
  AgentRunEvent,
  AgentThreadGroup,
  AgentThreadSummary,
  UserMessage,
} from "./types";

const agentQueryKeys = {
  thread: (agentBaseUrl: string, threadId: string | null) =>
    ["agent", agentBaseUrl, "thread", threadId] as const,
  threadGroups: (agentBaseUrl: string) =>
    ["agent", agentBaseUrl, "threadGroups"] as const,
};

export const useAgentThreadQuery = (
  threadId: string | null,
  options: {
    readonly onThreadResolved?: (threadId: string) => void;
  } = {},
) => {
  const runtime = useAgentRuntime();
  const onThreadResolved = options.onThreadResolved;
  const { applyRuntimeEvent, flushBufferedEvents } = useRuntimeEventDispatcher({
    onThreadResolved,
  });
  const enabled = threadId !== null;
  const query = useQuery({
    queryKey: agentQueryKeys.thread(runtime.agentBaseUrl, threadId),
    queryFn: async () => {
      if (threadId === null) {
        throw new Error("Thread id is required.");
      }

      return getAgentThread(runtime.agentBaseUrl, threadId);
    },
    enabled,
  });

  useEffect(() => {
    if (threadId === null) {
      runtime.activeRunHandleRef.current?.close();
      runtime.activeRunHandleRef.current = null;
      flushBufferedEvents();
      runtime.chatStore.getState().reset();
      return;
    }

    const currentActiveRun = runtime.chatStore.getState().activeRun;
    if (runtime.activeRunHandleRef.current !== null && currentActiveRun?.threadId === threadId) {
      return;
    }

    runtime.activeRunHandleRef.current?.close();
    runtime.activeRunHandleRef.current = null;
    flushBufferedEvents();
    runtime.chatStore.getState().reset();
    runtime.chatStore.getState().setThreadLoading(threadId);
  }, [flushBufferedEvents, runtime.activeRunHandleRef, runtime.chatStore, threadId]);

  useEffect(() => {
    if (query.data === undefined || threadId === null) {
      return;
    }

    const activeRun = runtime.chatStore.getState().activeRun;
    const hasLiveSelectedThreadRun =
      runtime.activeRunHandleRef.current !== null &&
      activeRun?.threadId === query.data.thread.id;

    if (!hasLiveSelectedThreadRun) {
      runtime.chatStore.getState().loadThread(query.data.thread);
    }

    runtime.threadListStore.getState().upsertThread(query.data.thread);

    if (hasLiveSelectedThreadRun || query.data.activeRun === undefined || runtime.activeRunHandleRef.current !== null) {
      return;
    }

    runtime.activeRunHandleRef.current = resumeAgentRun(runtime.agentBaseUrl, query.data.activeRun, {
      onRunStart: ({ runId, threadId: resolvedThreadId }) => {
        runtime.chatStore.getState().markRunStarted({ runId, threadId: resolvedThreadId });
        runtime.threadListStore.getState().setThreadStreaming(resolvedThreadId, true);
        onThreadResolved?.(resolvedThreadId);
      },
      onEvent: applyRuntimeEvent,
      onRunEnd: () => {
        const completedThreadId = runtime.chatStore.getState().activeRun?.threadId;
        flushBufferedEvents();
        runtime.chatStore.getState().finishRun();
        if (completedThreadId !== undefined && completedThreadId !== null) {
          runtime.threadListStore.getState().setThreadStreaming(completedThreadId, false);
        }
        runtime.activeRunHandleRef.current = null;
      },
      onError: (error) => {
        const failedThreadId = runtime.chatStore.getState().activeRun?.threadId;
        flushBufferedEvents();
        runtime.chatStore.getState().failRun(error.message);
        if (failedThreadId !== undefined && failedThreadId !== null) {
          runtime.threadListStore.getState().setThreadStreaming(failedThreadId, false);
        }
        runtime.activeRunHandleRef.current = null;
      },
    });

    void runtime.activeRunHandleRef.current.done.catch(() => {
      // The callbacks above already project the error into the store.
    });
  }, [
    applyRuntimeEvent,
    flushBufferedEvents,
    onThreadResolved,
    query.data,
    runtime.activeRunHandleRef,
    runtime.agentBaseUrl,
    runtime.chatStore,
    runtime.threadListStore,
    threadId,
  ]);

  useEffect(() => {
    if (!query.isError) {
      return;
    }

    runtime.chatStore.getState().setLoadError(
      query.error instanceof Error ? query.error.message : "Failed to load thread.",
    );
  }, [query.error, query.isError, runtime.chatStore]);

  return query;
};

export const useAgentThreadGroupsQuery = (
  options: { readonly enabled: boolean },
) => {
  const runtime = useAgentRuntime();
  const hasStreamingThreads = useStore(runtime.threadListStore, selectHasStreamingThreads);
  const query = useQuery({
    queryKey: agentQueryKeys.threadGroups(runtime.agentBaseUrl),
    queryFn: async (): Promise<AgentThreadGroup[]> =>
      retrieveAgentThreadGroups(runtime.agentBaseUrl),
    enabled: options.enabled,
    refetchInterval: options.enabled && hasStreamingThreads ? 2000 : false,
  });

  useEffect(() => {
    if (!options.enabled) {
      return;
    }

    runtime.threadListStore.getState().setLoading(query.isFetching);
  }, [options.enabled, query.isFetching, runtime.threadListStore]);

  useEffect(() => {
    if (query.data !== undefined) {
      runtime.threadListStore.getState().replaceGroups(query.data);
    }
  }, [query.data, runtime.threadListStore]);

  useEffect(() => {
    if (!query.isError) {
      return;
    }

    runtime.threadListStore.getState().setError(
      query.error instanceof Error ? query.error.message : "Failed to load chats.",
    );
  }, [query.error, query.isError, runtime.threadListStore]);

  return query;
};

export const useAgentRunMutation = ({
  currentPath,
  selectedThreadId,
  onSelectThread,
  onThreadResolved,
}: {
  readonly currentPath: string;
  readonly selectedThreadId: string | null;
  readonly onSelectThread?: (thread: AgentThreadSummary) => void;
  readonly onThreadResolved?: (threadId: string) => void;
}) => {
  const runtime = useAgentRuntime();
  const queryClient = useQueryClient();
  const { applyRuntimeEvent, flushBufferedEvents } = useRuntimeEventDispatcher({
    onThreadResolved,
  });
  const mutation = useMutation({
    mutationFn: async ({ content }: { readonly content: AgentContent }) => {
      if (runtime.activeRunHandleRef.current !== null) {
        throw new Error("An agent run is already active.");
      }

      const startedAt = Date.now();
      const optimisticUserMessage = createOptimisticUserMessage(content, currentPath, startedAt);
      const optimisticRun: ActiveRunState = {
        runId: null,
        threadId: selectedThreadId,
        startedAt,
        optimisticUserMessageId: optimisticUserMessage.id,
      };
      let latestThreadSummary: AgentThreadSummary | null = null;

      runtime.chatStore.getState().setRunError(null);
      runtime.chatStore.getState().addOptimisticUserMessage(optimisticUserMessage, optimisticRun);

      const handle = startAgentRun(runtime.agentBaseUrl, {
        threadId: selectedThreadId ?? undefined,
        path: currentPath,
        content,
      }, {
        onRunStart: ({ runId, threadId }) => {
          runtime.chatStore.getState().markRunStarted({ runId, threadId });
          runtime.threadListStore.getState().setThreadStreaming(threadId, true);
          onThreadResolved?.(threadId);
          void queryClient.invalidateQueries({
            queryKey: agentQueryKeys.threadGroups(runtime.agentBaseUrl),
          });
        },
        onEvent: (event) => {
          if (event.type === "thread.created" || event.type === "thread.updated") {
            latestThreadSummary = event.thread;
          }

          applyRuntimeEvent(event);
        },
        onRunEnd: () => {
          const completedThreadId = runtime.chatStore.getState().activeRun?.threadId;
          flushBufferedEvents();
          runtime.chatStore.getState().finishRun();
          if (completedThreadId !== undefined && completedThreadId !== null) {
            runtime.threadListStore.getState().setThreadStreaming(completedThreadId, false);
          }

          if (latestThreadSummary !== null) {
            runtime.threadListStore.getState().upsertThread({ ...latestThreadSummary, isStreaming: false });
            onSelectThread?.({ ...latestThreadSummary, isStreaming: false });
          }
        },
        onError: (error) => {
          const failedThreadId = runtime.chatStore.getState().activeRun?.threadId;
          flushBufferedEvents();
          runtime.chatStore.getState().failRun(error.message);
          if (failedThreadId !== undefined && failedThreadId !== null) {
            runtime.threadListStore.getState().setThreadStreaming(failedThreadId, false);
          }
        },
      });
      runtime.activeRunHandleRef.current = handle;
      await handle.done;
    },
    onSettled: () => {
      runtime.activeRunHandleRef.current = null;
      void queryClient.invalidateQueries({
        queryKey: agentQueryKeys.threadGroups(runtime.agentBaseUrl),
      });
    },
  });

  const submit = useCallback((input: { readonly content: AgentContent }): boolean => {
    if (runtime.activeRunHandleRef.current !== null) {
      return false;
    }

    mutation.mutate(input);
    return true;
  }, [mutation, runtime.activeRunHandleRef]);

  const cancel = useCallback((): void => {
    runtime.activeRunHandleRef.current?.cancel();
  }, [runtime.activeRunHandleRef]);

  const steer = useCallback(async (input: { readonly content: AgentContent }): Promise<boolean> => {
    const activeRun = runtime.chatStore.getState().activeRun;

    if (
      runtime.activeRunHandleRef.current === null ||
      activeRun?.threadId === undefined ||
      activeRun.threadId === null ||
      activeRun.runId === null
    ) {
      runtime.chatStore.getState().setRunError("The active turn is not ready for steering yet.");
      return false;
    }

    try {
      runtime.chatStore.getState().setRunError(null);
      await steerAgentRun(runtime.agentBaseUrl, {
        threadId: activeRun.threadId,
        runId: activeRun.runId,
        content: input.content,
      });
      return true;
    } catch (error) {
      runtime.chatStore.getState().setRunError(
        error instanceof Error ? error.message : "Failed to steer the active turn.",
      );
      return false;
    }
  }, [runtime.activeRunHandleRef, runtime.agentBaseUrl, runtime.chatStore]);

  return useMemo(() => ({
    cancel,
    submit,
    steer,
    mutation,
  }), [cancel, mutation, steer, submit]);
};

export const useAgentEditUserMessageMutation = ({
  currentPath,
  selectedThreadId,
  onSelectThread,
  onThreadResolved,
}: {
  readonly currentPath: string;
  readonly selectedThreadId: string | null;
  readonly onSelectThread?: (thread: AgentThreadSummary) => void;
  readonly onThreadResolved?: (threadId: string) => void;
}) => {
  const runtime = useAgentRuntime();
  const queryClient = useQueryClient();
  const { applyRuntimeEvent, flushBufferedEvents } = useRuntimeEventDispatcher({
    onThreadResolved,
  });
  const mutation = useMutation({
    mutationFn: async ({ messageId, content }: { readonly messageId: string; readonly content: AgentContent }) => {
      if (runtime.activeRunHandleRef.current !== null) {
        throw new Error("An agent run is already active.");
      }

      if (selectedThreadId === null) {
        throw new Error("A thread must be selected to edit a message.");
      }

      const startedAt = Date.now();
      const optimisticRun: ActiveRunState = {
        runId: null,
        threadId: selectedThreadId,
        startedAt,
        optimisticUserMessageId: messageId,
      };
      let latestThreadSummary: AgentThreadSummary | null = null;

      runtime.chatStore.getState().setRunError(null);
      runtime.chatStore.getState().startEditedUserMessageRun({
        messageId,
        content,
        activeRun: optimisticRun,
      });

      const handle = editAgentThreadUserMessage(runtime.agentBaseUrl, {
        threadId: selectedThreadId,
        path: currentPath,
        content,
      }, {
        onRunStart: ({ runId, threadId }) => {
          runtime.chatStore.getState().markRunStarted({ runId, threadId });
          runtime.threadListStore.getState().setThreadStreaming(threadId, true);
          onThreadResolved?.(threadId);
          void queryClient.invalidateQueries({
            queryKey: agentQueryKeys.threadGroups(runtime.agentBaseUrl),
          });
        },
        onEvent: (event) => {
          if (event.type === "thread.created" || event.type === "thread.updated") {
            latestThreadSummary = event.thread;
          }

          applyRuntimeEvent(event);
        },
        onRunEnd: () => {
          const completedThreadId = runtime.chatStore.getState().activeRun?.threadId;
          flushBufferedEvents();
          runtime.chatStore.getState().finishRun();
          if (completedThreadId !== undefined && completedThreadId !== null) {
            runtime.threadListStore.getState().setThreadStreaming(completedThreadId, false);
          }

          if (latestThreadSummary !== null) {
            runtime.threadListStore.getState().upsertThread({ ...latestThreadSummary, isStreaming: false });
            onSelectThread?.({ ...latestThreadSummary, isStreaming: false });
          }
        },
        onError: (error) => {
          const failedThreadId = runtime.chatStore.getState().activeRun?.threadId;
          flushBufferedEvents();
          runtime.chatStore.getState().failRun(error.message);
          if (failedThreadId !== undefined && failedThreadId !== null) {
            runtime.threadListStore.getState().setThreadStreaming(failedThreadId, false);
          }
        },
      });
      runtime.activeRunHandleRef.current = handle;
      await handle.done;
    },
    onSettled: () => {
      runtime.activeRunHandleRef.current = null;
      void queryClient.invalidateQueries({
        queryKey: agentQueryKeys.threadGroups(runtime.agentBaseUrl),
      });
      if (selectedThreadId !== null) {
        void queryClient.invalidateQueries({
          queryKey: agentQueryKeys.thread(runtime.agentBaseUrl, selectedThreadId),
        });
      }
    },
  });

  const submit = useCallback((input: { readonly messageId: string; readonly content: AgentContent }): boolean => {
    if (runtime.activeRunHandleRef.current !== null || selectedThreadId === null) {
      return false;
    }

    mutation.mutate(input);
    return true;
  }, [mutation, runtime.activeRunHandleRef, selectedThreadId]);

  return useMemo(() => ({
    submit,
    mutation,
  }), [mutation, submit]);
};

export const useCloseAgentRuntimeRunOnUnmount = (): void => {
  const runtime = useAgentRuntime();

  useEffect(() => {
    return () => {
      runtime.activeRunHandleRef.current?.close();
      runtime.activeRunHandleRef.current = null;

      if (runtime.flushFrameRef.current !== null) {
        window.cancelAnimationFrame(runtime.flushFrameRef.current);
        runtime.flushFrameRef.current = null;
      }
    };
  }, [runtime.activeRunHandleRef, runtime.flushFrameRef]);
};

const useRuntimeEventDispatcher = ({
  onThreadResolved,
}: {
  readonly onThreadResolved?: (threadId: string) => void;
}) => {
  const runtime = useAgentRuntime();

  const flushBufferedEvents = useCallback((): void => {
    if (runtime.flushFrameRef.current !== null) {
      window.cancelAnimationFrame(runtime.flushFrameRef.current);
      runtime.flushFrameRef.current = null;
    }

    runtime.chatStore.getState().flushBufferedRuntimeEvents();
  }, [runtime.chatStore, runtime.flushFrameRef]);

  const scheduleDeltaFlush = useCallback((): void => {
    if (runtime.flushFrameRef.current !== null) {
      return;
    }

    runtime.flushFrameRef.current = window.requestAnimationFrame(() => {
      runtime.flushFrameRef.current = null;
      runtime.chatStore.getState().flushBufferedRuntimeEvents();
    });
  }, [runtime.chatStore, runtime.flushFrameRef]);

  const applyRuntimeEvent = useCallback((event: AgentRunEvent): void => {
    if (event.type === "thread.created" || event.type === "thread.updated") {
      const activeRun = runtime.chatStore.getState().activeRun;
      runtime.threadListStore.getState().upsertThread({
        ...event.thread,
        isStreaming: activeRun?.threadId === event.thread.id || event.thread.isStreaming === true,
      });
      onThreadResolved?.(event.thread.id);
    }

    if (event.type === "runtime.error") {
      runtime.chatStore.getState().setRunError(event.error.message);
    }

    if (event.type === "content.delta") {
      runtime.chatStore.getState().bufferRuntimeEvent(event);
      scheduleDeltaFlush();
      return;
    }

    flushBufferedEvents();
    runtime.chatStore.getState().applyRuntimeEvent(event);
  }, [
    flushBufferedEvents,
    onThreadResolved,
    runtime.chatStore,
    runtime.threadListStore,
    scheduleDeltaFlush,
  ]);

  return useMemo(() => ({
    applyRuntimeEvent,
    flushBufferedEvents,
  }), [applyRuntimeEvent, flushBufferedEvents]);
};

const createOptimisticUserMessage = (
  content: AgentContent,
  path: string,
  timestamp: number,
): UserMessage => ({
  role: "user",
  id: `optimistic-user-${String(timestamp)}`,
  timestamp,
  content,
  path,
});
