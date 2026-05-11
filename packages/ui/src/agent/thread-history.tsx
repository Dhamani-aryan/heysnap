"use client";

import { WorkHistoryIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useAgentThreadGroupsQuery } from "./agent-queries";
import { AgentRuntimeProvider, useAgentThreadListStore, useOptionalAgentRuntime } from "./agent-runtime";
import { selectHasThreads } from "./agent-thread-list-store";
import type { AgentThreadGroup, AgentThreadSummary } from "./types";

export interface ThreadHistoryButtonProps {
  readonly agentBaseUrl?: string;
  readonly selectedThreadId?: string | null;
  readonly onSelectThread?: (thread: AgentThreadSummary) => void;
}

export const ThreadHistoryButton = ({
  agentBaseUrl = "http://localhost:4000/agent",
  selectedThreadId = null,
  onSelectThread,
}: ThreadHistoryButtonProps): React.ReactElement => {
  const runtime = useOptionalAgentRuntime();

  if (runtime === null) {
    return (
      <AgentRuntimeProvider agentBaseUrl={agentBaseUrl}>
        <ThreadHistoryButton
          agentBaseUrl={agentBaseUrl}
          selectedThreadId={selectedThreadId}
          onSelectThread={onSelectThread}
        />
      </AgentRuntimeProvider>
    );
  }

  return (
    <ThreadHistoryButtonContent
      selectedThreadId={selectedThreadId}
      onSelectThread={onSelectThread}
    />
  );
};

const ThreadHistoryButtonContent = ({
  selectedThreadId,
  onSelectThread,
}: {
  readonly selectedThreadId: string | null;
  readonly onSelectThread?: (thread: AgentThreadSummary) => void;
}): React.ReactElement => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  useAgentThreadGroupsQuery({ enabled: isOpen });
  const groups = useAgentThreadListStore((state) => state.groups);
  const isLoading = useAgentThreadListStore((state) => state.isLoading);
  const error = useAgentThreadListStore((state) => state.error);
  const hasThreads = useAgentThreadListStore(selectHasThreads);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const closeHistory = (event: MouseEvent): void => {
      const target = event.target;

      if (target instanceof Node && containerRef.current?.contains(target)) {
        return;
      }

      setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("mousedown", closeHistory);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("mousedown", closeHistory);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} className="thread-history">
      <button
        type="button"
        className={isOpen ? "thread-history-button active" : "thread-history-button"}
        aria-label="Thread history"
        title="Thread history"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <HugeiconsIcon icon={WorkHistoryIcon} size={18} color="currentColor" strokeWidth={1.8} />
      </button>

      {isOpen ? (
        <div className="thread-history-popover" role="dialog" aria-label="Thread history">
          <div className="thread-history-header">
            <span>History</span>
            {isLoading ? <SpinnerDot /> : null}
          </div>

          {error !== null ? (
            <div className="thread-history-state error">{error}</div>
          ) : isLoading && !hasThreads ? (
            <div className="thread-history-state">Loading history...</div>
          ) : hasThreads ? (
            <div className="thread-history-groups">
              {groups.map((group) =>
                group.threads.length === 0 ? null : (
                  <ThreadHistoryGroup
                    key={group.path}
                    group={group}
                    selectedThreadId={selectedThreadId}
                    onSelectThread={(thread) => {
                      onSelectThread?.(thread);
                      setIsOpen(false);
                    }}
                  />
                ),
              )}
            </div>
          ) : (
            <div className="thread-history-state">No previous threads.</div>
          )}
        </div>
      ) : null}
    </div>
  );
};

const ThreadHistoryGroup = ({
  group,
  selectedThreadId,
  onSelectThread,
}: {
  readonly group: AgentThreadGroup;
  readonly selectedThreadId: string | null;
  readonly onSelectThread: (thread: AgentThreadSummary) => void;
}): React.ReactElement => {
  const label = group.path.trim().length === 0 ? "Desktop" : group.path;

  return (
    <section className="thread-history-group">
      <h2 title={label}>{label}</h2>
      <div className="thread-history-list">
        {group.threads.map((thread) => (
          <ThreadHistoryItem
            key={thread.id}
            thread={thread}
            isSelected={thread.id === selectedThreadId}
            onSelectThread={onSelectThread}
          />
        ))}
      </div>
    </section>
  );
};

const ThreadHistoryItem = ({
  thread,
  isSelected,
  onSelectThread,
}: {
  readonly thread: AgentThreadSummary;
  readonly isSelected: boolean;
  readonly onSelectThread: (thread: AgentThreadSummary) => void;
}): React.ReactElement => {
  const updatedLabel = useMemo(() => formatHistoryDate(thread.updatedAt), [thread.updatedAt]);

  return (
    <button
      type="button"
      className={isSelected ? "thread-history-item selected" : "thread-history-item"}
      title={thread.title}
      onClick={() => onSelectThread(thread)}
    >
      <span className="thread-history-title">{thread.title}</span>
      <span className="thread-history-meta">
        {updatedLabel} · {thread.messageCount} messages
      </span>
    </button>
  );
};

const SpinnerDot = (): React.ReactElement => <span className="thread-history-spinner" aria-hidden="true" />;

const formatHistoryDate = (timestamp: number): string => {
  if (!Number.isFinite(timestamp)) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
};
