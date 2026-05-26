import { useCallback, useState, type Dispatch, type ReactElement, type ReactNode, type SetStateAction } from "react";

import { AgentPanel } from "../../../agent/agent-panel";
import type { PromptAttachment, PromptModelChoice } from "../../../agent/prompt-composer";
import type { AgentThreadSummary, AgentUiContext } from "../../../agent/types";
import { CapabilitiesPanel } from "../../../cloud/capabilities-panel";
import { appendPromptTranscript, useFilesystemVoicePrompt } from "../../../hooks/filesystem-voice-prompt";
import { FilesystemVoiceOverlay } from "../voice/filesystem-voice-overlay";
import { DesktopSplitPane } from "./desktop-split-pane";
import type { WorkspacePanel } from "./workspace-types";

export const FilesystemDesktopWorkspace = ({
  children,
  leftPaneRatio,
  isRightWorkAreaOpen,
  isRightAgentAreaOpen,
  onLeftPaneRatioChange,
  agentBaseUrl,
  sarvamApiKey,
  selectedThreadId,
  currentPath,
  currentDirectoryName,
  promptDraft,
  promptAttachments,
  allowModelSelection,
  workspacePanel,
  capabilitiesBaseUrl,
  uiContext,
  onOpenFilePath,
  onPromptDraftChange,
  onPromptAttachmentsChange,
  onSelectThread,
  onThreadResolved,
}: {
  readonly children: ReactNode;
  readonly leftPaneRatio: number;
  readonly isRightWorkAreaOpen: boolean;
  readonly isRightAgentAreaOpen: boolean;
  readonly onLeftPaneRatioChange: (ratio: number) => void;
  readonly agentBaseUrl: string;
  readonly sarvamApiKey?: string;
  readonly selectedThreadId: string | null;
  readonly currentPath: string;
  readonly currentDirectoryName: string;
  readonly promptDraft: string;
  readonly promptAttachments: readonly PromptAttachment[];
  readonly allowModelSelection?: boolean;
  readonly workspacePanel: WorkspacePanel;
  readonly capabilitiesBaseUrl?: string;
  readonly uiContext: AgentUiContext;
  readonly onOpenFilePath: (path: string) => void;
  readonly onPromptDraftChange: Dispatch<SetStateAction<string>>;
  readonly onPromptAttachmentsChange: Dispatch<SetStateAction<PromptAttachment[]>>;
  readonly onSelectThread?: (thread: AgentThreadSummary) => void;
  readonly onThreadResolved?: (threadId: string) => void;
}): ReactElement => {
  const [promptFocusToken, setPromptFocusToken] = useState(0);
  const [promptModelChoice, setPromptModelChoice] = useState<PromptModelChoice>("gpt");
  const handleVoiceTranscript = useCallback((transcript: string): void => {
    onPromptDraftChange((currentDraft) => appendPromptTranscript(currentDraft, transcript));
    setPromptFocusToken((currentToken) => currentToken + 1);
  }, [onPromptDraftChange]);
  const voicePrompt = useFilesystemVoicePrompt({
    sarvamApiKey,
    onTranscript: handleVoiceTranscript,
  });
  const handleRightPromptVoiceToggle = useCallback((): void => {
    if (voicePrompt.recordingState === "idle") {
      void voicePrompt.startRecording();
      return;
    }

    if (voicePrompt.recordingState === "recording") {
      voicePrompt.stopRecording();
    }
  }, [voicePrompt]);
  const leftOverlay = (
    <FilesystemVoiceOverlay
      isVisible={!isRightAgentAreaOpen}
      promptDraft={promptDraft}
      promptAttachments={promptAttachments}
      focusToken={promptFocusToken}
      voiceState={voicePrompt.recordingState}
      currentPath={currentPath}
      selectedThreadId={selectedThreadId}
      uiContext={uiContext}
      allowModelSelection={allowModelSelection === true}
      promptModelChoice={promptModelChoice}
      onPromptDraftChange={onPromptDraftChange}
      onPromptAttachmentsChange={onPromptAttachmentsChange}
      onPromptModelChoiceChange={setPromptModelChoice}
      onStartRecording={voicePrompt.startRecording}
      onStopRecording={voicePrompt.stopRecording}
      onOpenFilePath={onOpenFilePath}
      onSelectThread={onSelectThread}
      onThreadResolved={onThreadResolved}
    />
  );
  const rightPanel = workspacePanel === "connectors" ? (
    <CapabilitiesPanel capabilitiesBaseUrl={capabilitiesBaseUrl} />
  ) : (
    <AgentPanel
      agentBaseUrl={agentBaseUrl}
      selectedThreadId={selectedThreadId}
      currentPath={currentPath}
      currentDirectoryName={currentDirectoryName}
      uiContext={uiContext}
      promptDraft={promptDraft}
      promptAttachments={promptAttachments}
      promptModelChoice={promptModelChoice}
      allowModelSelection={allowModelSelection === true}
      promptVoiceState={isRightAgentAreaOpen ? voicePrompt.recordingState : "idle"}
      promptAutoFocusToken={isRightAgentAreaOpen ? promptFocusToken : undefined}
      onOpenFilePath={onOpenFilePath}
      onPromptDraftChange={onPromptDraftChange}
      onPromptAttachmentsChange={onPromptAttachmentsChange}
      onPromptModelChoiceChange={setPromptModelChoice}
      onPromptVoiceToggle={isRightAgentAreaOpen ? handleRightPromptVoiceToggle : undefined}
      onSelectThread={onSelectThread}
      onThreadResolved={onThreadResolved}
    />
  );

  return (
    <DesktopSplitPane
      leftPaneRatio={leftPaneRatio}
      isRightWorkAreaOpen={isRightWorkAreaOpen}
      isRightAgentAreaOpen={isRightAgentAreaOpen}
      onLeftPaneRatioChange={onLeftPaneRatioChange}
      leftOverlay={leftOverlay}
      rightPanel={rightPanel}
      rightPanelLabel={workspacePanel === "connectors" ? "Connectors panel" : "Preview panel"}
    >
      {children}
    </DesktopSplitPane>
  );
};
