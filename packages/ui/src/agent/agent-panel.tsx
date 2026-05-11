"use client";

import {
  useAgentEditUserMessageMutation,
  useAgentRunMutation,
  useAgentThreadQuery,
  useCloseAgentRuntimeRunOnUnmount,
} from "./agent-queries";
import {
  AgentRuntimeProvider,
  useAgentChatStore,
  useOptionalAgentRuntime,
} from "./agent-runtime";
import { AgentEmptyThread } from "./empty-thread";
import { RightPromptComposer } from "./prompt-composer";
import { AgentTimeline } from "./timeline";
import type { AgentThreadSummary, AgentUiContext } from "./types";

export interface AgentPanelProps {
  readonly agentBaseUrl: string;
  readonly selectedThreadId: string | null;
  readonly currentPath: string;
  readonly currentDirectoryName: string;
  readonly uiContext?: AgentUiContext;
  readonly workspaceRoot?: string;
  readonly onOpenFilePath?: (path: string) => void;
  readonly onSelectThread?: (thread: AgentThreadSummary) => void;
  readonly onThreadResolved?: (threadId: string) => void;
}

export const AgentPanel = (props: AgentPanelProps): React.ReactElement => {
  const runtime = useOptionalAgentRuntime();

  if (runtime === null) {
    return (
      <AgentRuntimeProvider agentBaseUrl={props.agentBaseUrl}>
        <AgentPanelContent {...props} />
      </AgentRuntimeProvider>
    );
  }

  return <AgentPanelContent {...props} />;
};

const AgentPanelContent = ({
  selectedThreadId,
  currentPath,
  currentDirectoryName,
  uiContext,
  workspaceRoot,
  onOpenFilePath,
  onSelectThread,
  onThreadResolved,
}: AgentPanelProps): React.ReactElement => {
  useCloseAgentRuntimeRunOnUnmount();
  useAgentThreadQuery(selectedThreadId, { onThreadResolved });

  const activeRun = useAgentChatStore((state) => state.activeRun);
  const hasMessages = useAgentChatStore((state) => state.messageOrder.length > 0);
  const loadStatus = useAgentChatStore((state) => state.loadStatus);
  const loadError = useAgentChatStore((state) => state.loadError);
  const runError = useAgentChatStore((state) => state.runError ?? state.error);
  const isRunning = activeRun !== null;
  const { cancel, steer, submit } = useAgentRunMutation({
    currentPath,
    uiContext,
    selectedThreadId,
    onSelectThread,
    onThreadResolved,
  });
  const { submit: submitEditedUserMessage } = useAgentEditUserMessageMutation({
    currentPath,
    uiContext,
    selectedThreadId,
    onSelectThread,
    onThreadResolved,
  });
  const composerProps = {
    activeFolderName: currentDirectoryName,
    isRunning,
    onCancel: cancel,
    onSubmit: isRunning ? steer : submit,
  };

  if (selectedThreadId === null && !hasMessages && !isRunning && runError === null) {
    return <AgentEmptyThread {...composerProps} currentDirectoryName={currentDirectoryName} />;
  }

  return (
    <div className="right-prompt-surface">
      <div className="agent-thread-scroll">
        {loadError !== null ? <AgentPanelState label={loadError} variant="error" /> : null}
        {loadStatus !== "loading" && loadError === null ? (
          <AgentTimeline
            currentPath={currentPath}
            workspaceRoot={workspaceRoot}
            onOpenFilePath={onOpenFilePath}
            onSubmitUserMessageEdit={submitEditedUserMessage}
          />
        ) : null}
      </div>
      <div className="right-prompt-composer-wrap">
        {runError === null ? null : (
          <div className="agent-run-error">{runError}</div>
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
