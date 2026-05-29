"use client";

import {
  useAgentEditUserMessageMutation,
  useAgentRunMutation,
  useAgentThreadQuery,
  useCloseAgentRuntimeRunOnUnmount,
} from "../query/agent/agent-queries";
import {
  AgentRuntimeProvider,
  useAgentChatStore,
  useOptionalAgentRuntime,
} from "./agent-runtime";
import { AgentEmptyThread } from "./empty-thread";
import { RightPromptComposer, type PromptAttachment, type PromptModelChoice, type PromptVoiceState } from "./prompt-composer";
import { AgentTimeline } from "./timeline";
import type { AgentContent, AgentThreadSummary, AgentUiContext } from "./types";

export interface AgentPanelProps {
  readonly agentBaseUrl: string;
  readonly selectedThreadId: string | null;
  readonly currentPath: string;
  readonly currentDirectoryName: string;
  readonly uiContext?: AgentUiContext;
  readonly workspaceRoot?: string;
  readonly promptDraft?: string;
  readonly promptAttachments?: readonly PromptAttachment[];
  readonly promptModelChoice?: PromptModelChoice;
  readonly allowModelSelection?: boolean;
  readonly promptVoiceState?: PromptVoiceState;
  readonly promptAutoFocusToken?: number;
  readonly onOpenFilePath?: (path: string) => void;
  readonly onPromptDraftChange?: (draft: string) => void;
  readonly onPromptAttachmentsChange?: (attachments: PromptAttachment[]) => void;
  readonly onPromptModelChoiceChange?: (choice: PromptModelChoice) => void;
  readonly onPromptVoiceToggle?: () => void;
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
  promptDraft,
  promptAttachments,
  promptModelChoice = "gpt",
  allowModelSelection = false,
  promptVoiceState,
  promptAutoFocusToken,
  onOpenFilePath,
  onPromptDraftChange,
  onPromptAttachmentsChange,
  onPromptModelChoiceChange,
  onPromptVoiceToggle,
  onSelectThread,
  onThreadResolved,
}: AgentPanelProps): React.ReactElement => {
  useCloseAgentRuntimeRunOnUnmount();
  useAgentThreadQuery(selectedThreadId, { onThreadResolved });

  const activeRun = useAgentChatStore((state) => state.activeRun);
  const hasMessages = useAgentChatStore((state) => state.messageOrder.length > 0);
  const loadStatus = useAgentChatStore((state) => state.loadStatus);
  const loadError = useAgentChatStore((state) => state.loadError);
  const isRunning = activeRun !== null;
  const canChangeModel =
    allowModelSelection &&
    selectedThreadId === null &&
    !isRunning &&
    onPromptModelChoiceChange !== undefined;
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
    draft: promptDraft,
    attachments: promptAttachments,
    voiceState: promptVoiceState,
    autoFocusToken: promptAutoFocusToken,
    isRunning,
    onDraftChange: onPromptDraftChange,
    onAttachmentsChange: onPromptAttachmentsChange,
    onVoiceToggle: onPromptVoiceToggle,
    onCancel: cancel,
    modelPicker: allowModelSelection ? {
      value: selectedThreadId === null ? promptModelChoice : getThreadModelChoice(selectedThreadId),
      disabled: !canChangeModel,
      onChange: onPromptModelChoiceChange ?? (() => {}),
    } : undefined,
    onSubmit: isRunning
      ? steer
      : (input: { readonly content: AgentContent }) =>
        submit({
          ...input,
          ...getNewThreadModelSelection({
            allowModelSelection,
            selectedThreadId,
            promptModelChoice,
          }),
        }),
  };

  if (selectedThreadId === null && !hasMessages && !isRunning) {
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
        <RightPromptComposer {...composerProps} />
      </div>
    </div>
  );
};

const getNewThreadModelSelection = ({
  allowModelSelection,
  selectedThreadId,
  promptModelChoice,
}: {
  readonly allowModelSelection: boolean;
  readonly selectedThreadId: string | null;
  readonly promptModelChoice: PromptModelChoice;
}) => {
  if (!allowModelSelection || selectedThreadId !== null) {
    return {};
  }

  if (promptModelChoice === "claude") {
    return {
      harness: "pi" as const,
      provider: "anthropic",
      model: "claude-opus-4-8",
    };
  }

  return { harness: "codex" as const };
};

const getThreadModelChoice = (threadId: string): PromptModelChoice =>
  decodeThreadId(threadId).startsWith("pi:") ? "claude" : "gpt";

const decodeThreadId = (threadId: string): string => {
  try {
    return decodeURIComponent(threadId);
  } catch {
    return threadId;
  }
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
