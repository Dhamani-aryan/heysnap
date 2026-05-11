"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";

import macImageUrl from "../../../../apps/assets/mac.png";
import newMacImageUrl from "../../../../apps/assets/new-mac.png";
import { AgentRuntimeProvider } from "../agent/agent-runtime";
import type { AgentThreadSummary } from "../agent/types";
import { FilesystemExplorer } from "../filesystem/filesystem-explorer";
import type { CloudComputer } from "./cloud-client";

type ImageAsset = string | { readonly src: string };

const WORKSPACE_TRANSITION = { duration: 0.42, ease: [0.22, 1, 0.36, 1] as const };

const getImageSrc = (asset: ImageAsset): string => {
  return typeof asset === "string" ? asset : asset.src;
};

export interface MachineWorkspaceProps {
  readonly agentBaseUrl: string;
  readonly capabilitiesWebsocketUrl?: string;
  readonly computer: CloudComputer;
  readonly filesystemWebsocketUrl: string;
  readonly selectedThreadId?: string | null;
  readonly onSelectThread?: (thread: AgentThreadSummary) => void;
  readonly onNewThread?: () => void;
  readonly onThreadResolved?: (threadId: string) => void;
  readonly onBackToMachines?: () => void;
  readonly onSleepMachine?: () => Promise<void>;
  readonly suppressConnectionLoader?: boolean;
}

export function MachineWorkspace({
  agentBaseUrl,
  capabilitiesWebsocketUrl,
  computer,
  filesystemWebsocketUrl,
  selectedThreadId = null,
  onSelectThread,
  onNewThread,
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
            capabilitiesWebsocketUrl={capabilitiesWebsocketUrl}
            selectedThreadId={selectedThreadId}
            machineName={computer.name}
            canSleepMachine={computer.kind !== "local"}
            onFilesystemOpen={handleFilesystemOpen}
            onSelectThread={onSelectThread}
            onNewThread={onNewThread}
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

export function MachineWorkspaceLoader({
  ariaLabel,
  computer,
  label,
}: {
  readonly ariaLabel: string;
  readonly computer: CloudComputer;
  readonly label: string;
}): React.ReactElement {
  const loaderImageUrl = computer.kind === "local" ? newMacImageUrl : macImageUrl;

  return (
    <motion.section
      className="cloud-workspace-loader"
      aria-label={ariaLabel}
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, y: -6 }}
      transition={WORKSPACE_TRANSITION}
    >
      <img
        className="cloud-workspace-loader-image"
        src={getImageSrc(loaderImageUrl)}
        alt=""
        aria-hidden="true"
      />
      <p>{label}</p>
    </motion.section>
  );
}
