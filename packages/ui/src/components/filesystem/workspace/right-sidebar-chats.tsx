import {
  ArrowRight01Icon,
  Folder01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useState, type ReactElement } from "react";

import { useAgentThreadGroupsQuery } from "../../../query/agent/agent-queries";
import {
  AgentRuntimeProvider,
  useAgentChatStore,
  useAgentThreadListStore,
  useOptionalAgentRuntime,
} from "../../../agent/agent-runtime";
import { selectHasThreads } from "../../../stores/agent/agent-thread-list-store";
import type { AgentThreadGroup, AgentThreadSummary } from "../../../agent/types";

export const RightSidebarChats = ({
  agentBaseUrl,
  isOpen,
  selectedThreadId,
  onSelectThread,
}: {
  readonly agentBaseUrl: string;
  readonly isOpen: boolean;
  readonly selectedThreadId: string | null;
  readonly onSelectThread?: (thread: AgentThreadSummary) => void;
}): ReactElement => {
  const runtime = useOptionalAgentRuntime();

  if (runtime === null) {
    return (
      <AgentRuntimeProvider agentBaseUrl={agentBaseUrl}>
        <RightSidebarChats
          agentBaseUrl={agentBaseUrl}
          isOpen={isOpen}
          selectedThreadId={selectedThreadId}
          onSelectThread={onSelectThread}
        />
      </AgentRuntimeProvider>
    );
  }

  return (
    <RightSidebarChatsContent
      isOpen={isOpen}
      selectedThreadId={selectedThreadId}
      onSelectThread={onSelectThread}
    />
  );
};

const RightSidebarChatsContent = ({
  isOpen,
  selectedThreadId,
  onSelectThread,
}: {
  readonly isOpen: boolean;
  readonly selectedThreadId: string | null;
  readonly onSelectThread?: (thread: AgentThreadSummary) => void;
}): ReactElement => {
  useAgentThreadGroupsQuery({ enabled: isOpen });
  const groups = useAgentThreadListStore((state) => state.groups);
  const isLoading = useAgentThreadListStore((state) => state.isLoading);
  const hasLoaded = useAgentThreadListStore((state) => state.hasLoaded);
  const error = useAgentThreadListStore((state) => state.error);
  const hasThreads = useAgentThreadListStore(selectHasThreads);
  const activeRun = useAgentChatStore((state) => state.activeRun);
  const activeThreadSummary = useAgentChatStore((state) => state.threadSummary);
  const activeStreamingThreadId = activeRun === null
    ? null
    : activeRun.threadId ?? activeThreadSummary?.id ?? null;

  return (
    <section className="split-right-sidebar-chats" aria-label="Chats">
      <h2>Chats</h2>
      {error !== null ? (
        <p className="split-right-sidebar-state error">{error}</p>
      ) : (!hasLoaded || isLoading) && !hasThreads ? (
        <p className="split-right-sidebar-state">Loading chats...</p>
      ) : hasThreads ? (
        <div className="split-right-sidebar-chat-groups">
          {groups.map((group) =>
            group.threads.length === 0 ? null : (
              <RightSidebarChatGroup
                key={group.path}
                group={group}
                selectedThreadId={selectedThreadId}
                activeStreamingThreadId={activeStreamingThreadId}
                onSelectThread={onSelectThread}
              />
            ),
          )}
        </div>
      ) : (
        <p className="split-right-sidebar-state">No previous chats.</p>
      )}
    </section>
  );
};

const RightSidebarChatGroup = ({
  group,
  selectedThreadId,
  activeStreamingThreadId,
  onSelectThread,
}: {
  readonly group: AgentThreadGroup;
  readonly selectedThreadId: string | null;
  readonly activeStreamingThreadId: string | null;
  readonly onSelectThread?: (thread: AgentThreadSummary) => void;
}): ReactElement => {
  const label = group.path.trim().length === 0 ? "workspace" : group.path;
  const hasSelectedThread = group.threads.some((thread) => thread.id === selectedThreadId);
  const [isExpanded, setIsExpanded] = useState(hasSelectedThread);
  const [isShowingAll, setIsShowingAll] = useState(false);
  const visibleThreads = isShowingAll ? group.threads : group.threads.slice(0, 5);
  const canToggleVisibleThreads = group.threads.length > 5;

  useEffect(() => {
    if (hasSelectedThread) {
      setIsExpanded(true);
    }
  }, [hasSelectedThread]);

  return (
    <section className="split-right-sidebar-chat-group">
      <button
        type="button"
        className={isExpanded ? "split-right-sidebar-chat-folder expanded" : "split-right-sidebar-chat-folder"}
        title={label}
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded((current) => !current)}
      >
        <HugeiconsIcon
          icon={Folder01Icon}
          size={15}
          color="currentColor"
          strokeWidth={1.8}
          className="split-right-sidebar-folder-icon"
        />
        <span>{getSidebarFolderLabel(label)}</span>
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          size={12}
          color="currentColor"
          strokeWidth={1.8}
          className="split-right-sidebar-folder-chevron"
        />
      </button>
      <div
        className={isExpanded ? "split-right-sidebar-chat-collapse open" : "split-right-sidebar-chat-collapse"}
        aria-hidden={!isExpanded}
      >
        <div className="split-right-sidebar-chat-collapse-inner">
          <div className="split-right-sidebar-chat-list">
            {visibleThreads.map((thread) => (
              <RightSidebarChatItem
                key={thread.id}
                thread={thread}
                isSelected={thread.id === selectedThreadId}
                isStreaming={thread.isStreaming === true || thread.id === activeStreamingThreadId}
                onSelectThread={onSelectThread}
              />
            ))}
            {canToggleVisibleThreads ? (
              <button
                className="split-right-sidebar-show-more"
                type="button"
                onClick={() => setIsShowingAll((current) => !current)}
                tabIndex={isExpanded ? 0 : -1}
              >
                {isShowingAll ? "Show less" : "Show more"}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
};

const RightSidebarChatItem = ({
  thread,
  isSelected,
  isStreaming,
  onSelectThread,
}: {
  readonly thread: AgentThreadSummary;
  readonly isSelected: boolean;
  readonly isStreaming: boolean;
  readonly onSelectThread?: (thread: AgentThreadSummary) => void;
}): ReactElement => {
  const updatedLabel = useMemo(() => formatSidebarChatDate(thread.updatedAt), [thread.updatedAt]);

  return (
    <button
      className={isSelected ? "split-right-sidebar-chat selected" : "split-right-sidebar-chat"}
      title={thread.title}
      type="button"
      onClick={() => onSelectThread?.(thread)}
    >
      <span className="split-right-sidebar-chat-title">{thread.title}</span>
      <span className="split-right-sidebar-chat-meta">
        {isStreaming ? (
          <span className="split-right-sidebar-chat-spinner" aria-label="Streaming" />
        ) : updatedLabel}
      </span>
    </button>
  );
};

const getSidebarFolderLabel = (path: string): string => {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  return segments.at(-1) ?? path;
};

const formatSidebarChatDate = (timestamp: number): string => {
  if (!Number.isFinite(timestamp)) {
    return "";
  }

  const elapsedMs = Date.now() - timestamp;
  const elapsedMinutes = Math.max(0, Math.floor(elapsedMs / 60_000));

  if (elapsedMinutes < 1) {
    return "now";
  }

  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);

  if (elapsedHours < 24) {
    return `${elapsedHours}h`;
  }

  const elapsedDays = Math.floor(elapsedHours / 24);

  if (elapsedDays < 7) {
    return `${elapsedDays}d`;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(timestamp));
};
