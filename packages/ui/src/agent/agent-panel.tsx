"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";

import { getAgentThread, startAgentRun, type AgentRunHandle } from "./agent-client";
import {
  createAgentChatStore,
  type ActiveRunState,
  type AgentChatStore,
} from "./agent-store";
import { AgentEmptyThread } from "./empty-thread";
import { RightPromptComposer } from "./prompt-composer";
import { AgentTimeline } from "./timeline";
import type {
  AgentContent,
  AgentMessage,
  AgentRunEvent,
  AgentThreadSummary,
  UserMessage,
} from "./types";

export interface AgentPanelProps {
  readonly websocketUrl: string;
  readonly selectedThreadId: string | null;
  readonly currentPath: string;
  readonly workspaceRoot?: string;
  readonly onOpenFilePath?: (path: string) => void;
  readonly onSelectThread?: (thread: AgentThreadSummary) => void;
}

export const AgentPanel = ({
  websocketUrl,
  selectedThreadId,
  currentPath,
  workspaceRoot,
  onOpenFilePath,
  onSelectThread,
}: AgentPanelProps): React.ReactElement => {
  const store = useAgentChatStoreRef();
  const activeRunHandleRef = useRef<AgentRunHandle | null>(null);
  const flushFrameRef = useRef<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const messagesById = useStore(store, (state) => state.messagesById);
  const messageOrder = useStore(store, (state) => state.messageOrder);
  const activeRun = useStore(store, (state) => state.activeRun);
  const storeError = useStore(store, (state) => state.error);
  const messages = useMemo(
    () => selectMessages(messageOrder, messagesById),
    [messageOrder, messagesById],
  );
  const isRunning = activeRun !== null;

  const flushBufferedEvents = useCallback((): void => {
    if (flushFrameRef.current !== null) {
      window.cancelAnimationFrame(flushFrameRef.current);
      flushFrameRef.current = null;
    }
    store.getState().flushBufferedRuntimeEvents();
  }, [store]);

  const scheduleDeltaFlush = useCallback((): void => {
    if (flushFrameRef.current !== null) {
      return;
    }

    flushFrameRef.current = window.requestAnimationFrame(() => {
      flushFrameRef.current = null;
      store.getState().flushBufferedRuntimeEvents();
    });
  }, [store]);

  const applyRuntimeEvent = useCallback(
    (event: AgentRunEvent): void => {
      if (event.type === "content.delta") {
        store.getState().bufferRuntimeEvent(event);
        scheduleDeltaFlush();
        return;
      }

      flushBufferedEvents();
      store.getState().applyRuntimeEvent(event);
    },
    [flushBufferedEvents, scheduleDeltaFlush, store],
  );

  const handleCancel = useCallback((): void => {
    activeRunHandleRef.current?.cancel();
  }, []);

  const handleSubmit = useCallback(
    ({ content }: { readonly content: AgentContent }): boolean => {
      if (activeRunHandleRef.current !== null) {
        return false;
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

      setRunError(null);
      setLoadError(null);
      store.getState().addOptimisticUserMessage(optimisticUserMessage, optimisticRun);

      activeRunHandleRef.current = startAgentRun(websocketUrl, {
        threadId: selectedThreadId ?? undefined,
        path: currentPath,
        content,
      }, {
        onRunStart: ({ runId, threadId }) => {
          store.getState().markRunStarted({ runId, threadId });
        },
        onEvent: (event) => {
          if (event.type === "thread.created" || event.type === "thread.updated") {
            latestThreadSummary = event.thread;
          }

          if (event.type === "runtime.error") {
            setRunError(event.error.message);
          }

          applyRuntimeEvent(event);
        },
        onRunEnd: () => {
          flushBufferedEvents();
          store.getState().finishRun();
          activeRunHandleRef.current = null;

          if (latestThreadSummary !== null) {
            onSelectThread?.(latestThreadSummary);
          }
        },
        onError: (error) => {
          flushBufferedEvents();
          setRunError(error.message);
          store.getState().failRun(error.message);
          activeRunHandleRef.current = null;
        },
      });

      return true;
    },
    [applyRuntimeEvent, currentPath, flushBufferedEvents, onSelectThread, selectedThreadId, store, websocketUrl],
  );

  useEffect(() => {
    if (selectedThreadId === null) {
      if (activeRunHandleRef.current === null) {
        store.getState().reset();
        setLoadError(null);
        setRunError(null);
        setIsLoading(false);
      }
      return;
    }

    let isCurrent = true;
    activeRunHandleRef.current?.close();
    activeRunHandleRef.current = null;
    flushBufferedEvents();
    store.getState().reset();
    setLoadError(null);
    setRunError(null);
    setIsLoading(true);

    void getAgentThread(websocketUrl, selectedThreadId)
      .then((thread) => {
        if (isCurrent) {
          store.getState().loadThread(thread);
        }
      })
      .catch((error) => {
        if (isCurrent) {
          setLoadError(error instanceof Error ? error.message : "Failed to load thread.");
        }
      })
      .finally(() => {
        if (isCurrent) {
          setIsLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [flushBufferedEvents, selectedThreadId, store, websocketUrl]);

  useEffect(() => {
    return () => {
      activeRunHandleRef.current?.close();
      activeRunHandleRef.current = null;
      if (flushFrameRef.current !== null) {
        window.cancelAnimationFrame(flushFrameRef.current);
        flushFrameRef.current = null;
      }
    };
  }, []);

  const composerProps = {
    isRunning,
    onCancel: handleCancel,
    onSubmit: handleSubmit,
  };

  if (selectedThreadId === null && messages.length === 0 && activeRun === null && runError === null && storeError === null) {
    return <AgentEmptyThread {...composerProps} />;
  }

  return (
    <div className="right-prompt-surface">
      <div className="agent-thread-scroll">
        {isLoading ? <AgentPanelState label="Loading thread..." /> : null}
        {loadError !== null ? <AgentPanelState label={loadError} variant="error" /> : null}
        {!isLoading && loadError === null ? (
          <AgentTimeline
            messages={messages}
            isWorking={isRunning}
            currentPath={currentPath}
            workspaceRoot={workspaceRoot}
            onOpenFilePath={onOpenFilePath}
          />
        ) : null}
      </div>
      <div className="right-prompt-composer-wrap">
        {runError === null && storeError === null ? null : (
          <div className="agent-run-error">{runError ?? storeError}</div>
        )}
        <RightPromptComposer {...composerProps} />
      </div>
    </div>
  );
};

const AgentPanelState = ({
  label,
  variant = "muted",
}: {
  readonly label: string;
  readonly variant?: "muted" | "error";
}): React.ReactElement => (
  <div className={variant === "error" ? "agent-panel-state error" : "agent-panel-state"}>{label}</div>
);

const useAgentChatStoreRef = (): AgentChatStore => {
  const storeRef = useRef<AgentChatStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = createAgentChatStore();
  }
  return storeRef.current;
};

const selectMessages = (
  messageOrder: readonly string[],
  messagesById: Readonly<Record<string, AgentMessage>>,
): AgentMessage[] =>
  messageOrder
    .map((id) => messagesById[id])
    .filter((message): message is AgentMessage => message !== undefined);

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
