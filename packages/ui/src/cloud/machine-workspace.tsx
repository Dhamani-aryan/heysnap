"use client";

import { ArrowLeft02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { FilesystemExplorer } from "../filesystem/filesystem-explorer";
import type { CloudComputer } from "./cloud-client";

export interface MachineWorkspaceProps {
  readonly agentWebsocketUrl: string;
  readonly computer: CloudComputer;
  readonly filesystemWebsocketUrl: string;
  readonly onBack: () => void;
}

export function MachineWorkspace({
  agentWebsocketUrl,
  computer,
  filesystemWebsocketUrl,
  onBack,
}: MachineWorkspaceProps): React.ReactElement {
  return (
    <main className="cloud-workspace">
      <header className="cloud-workspace-bar">
        <button className="cloud-text-button" type="button" onClick={onBack}>
          <HugeiconsIcon icon={ArrowLeft02Icon} size={17} color="currentColor" strokeWidth={1.8} />
          Machines
        </button>
        <div className="cloud-workspace-title">
          <strong>{computer.name}</strong>
          <span>{computer.status}</span>
        </div>
      </header>
      <FilesystemExplorer
        websocketUrl={filesystemWebsocketUrl}
        agentWebsocketUrl={agentWebsocketUrl}
      />
    </main>
  );
}
