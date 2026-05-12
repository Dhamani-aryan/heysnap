"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";

import { AgentRuntimeProvider } from "../agent/agent-runtime";
import type { AgentThreadSummary } from "../agent/types";
import { FilesystemExplorer } from "../filesystem/filesystem-explorer";
import type { CloudComputer } from "./cloud-client";
import { MachineWorkspaceLoader, WORKSPACE_TRANSITION } from "./machine-workspace-loader";

export interface MachineWorkspaceProps {
  readonly agentBaseUrl: string;
  readonly capabilitiesBaseUrl?: string;
  readonly computer: CloudComputer;
  readonly filesystemWebsocketUrl: string;
  readonly selectedThreadId?: string | null;
  readonly workspacePanel?: "chat" | "connectors";
  readonly onSelectThread?: (thread: AgentThreadSummary) => void;
  readonly onNewThread?: () => void;
  readonly onOpenConnectors?: () => void;
  readonly onCloseConnectors?: () => void;
  readonly onThreadResolved?: (threadId: string) => void;
  readonly onBackToMachines?: () => void;
  readonly onSleepMachine?: () => Promise<void>;
  readonly suppressConnectionLoader?: boolean;
}

export function MachineWorkspace({
  agentBaseUrl,
  capabilitiesBaseUrl,
  computer,
  filesystemWebsocketUrl,
  selectedThreadId = null,
  workspacePanel = "chat",
  onSelectThread,
  onNewThread,
  onOpenConnectors,
  onCloseConnectors,
  onThreadResolved,
  onBackToMachines,
  onSleepMachine,
  suppressConnectionLoader = false,
}: MachineWorkspaceProps): React.ReactElement {
  const [isFilesystemOpen, setIsFilesystemOpen] = useState(suppressConnectionLoader);
  const isWorkspaceReady = isFilesystemOpen;

  useEffect(() => {
    document.documentElement.dataset.cloudScreen = "workspace";

    return () => {
      if (document.documentElement.dataset.cloudScreen === "workspace") {
        delete document.documentElement.dataset.cloudScreen;
      }
    };
  }, []);

  useEffect(() => {
    if (suppressConnectionLoader) {
      setIsFilesystemOpen(true);
      return;
    }

    setIsFilesystemOpen(false);
  }, [computer.id, filesystemWebsocketUrl, suppressConnectionLoader]);

  const handleFilesystemOpen = useCallback((): void => {
    setIsFilesystemOpen(true);
  }, []);

  return (
    <main className="cloud-workspace" data-workspace-ready={isWorkspaceReady ? "true" : undefined}>
      <motion.div
        className="cloud-workspace-content"
        aria-hidden={!isWorkspaceReady ? "true" : undefined}
        initial={false}
        animate={{
          opacity: isWorkspaceReady ? 1 : 0,
          y: isWorkspaceReady ? 0 : 8,
        }}
        transition={WORKSPACE_TRANSITION}
      >
        <AgentRuntimeProvider key={computer.id} agentBaseUrl={agentBaseUrl}>
          <FilesystemExplorer
            websocketUrl={filesystemWebsocketUrl}
            agentBaseUrl={agentBaseUrl}
            capabilitiesBaseUrl={capabilitiesBaseUrl}
            selectedThreadId={selectedThreadId}
            workspacePanel={workspacePanel}
            machineName={computer.name}
            canSleepMachine={computer.kind !== "local"}
            onFilesystemOpen={handleFilesystemOpen}
            onSelectThread={onSelectThread}
            onNewThread={onNewThread}
            onOpenConnectors={onOpenConnectors}
            onCloseConnectors={onCloseConnectors}
            onThreadResolved={onThreadResolved}
            onBackToMachines={onBackToMachines}
            onSleepMachine={onSleepMachine}
          />
        </AgentRuntimeProvider>
      </motion.div>
      <AnimatePresence>
        {!isWorkspaceReady ? (
          <MachineWorkspaceLoader
            key="connecting"
            ariaLabel="Connecting to machine"
            computer={computer}
            label="Connecting"
          />
        ) : null}
      </AnimatePresence>
    </main>
  );
}
