"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";

import macImageUrl from "../../../../apps/assets/mac.png";
import newMacImageUrl from "../../../../apps/assets/new-mac.png";
import { FilesystemExplorer } from "../filesystem/filesystem-explorer";
import type { CloudComputer } from "./cloud-client";

type ImageAsset = string | { readonly src: string };

const WORKSPACE_LOADER_MINIMUM_MS = 2000;
const WORKSPACE_TRANSITION = { duration: 0.42, ease: [0.22, 1, 0.36, 1] as const };

const getImageSrc = (asset: ImageAsset): string => {
  return typeof asset === "string" ? asset : asset.src;
};

export interface MachineWorkspaceProps {
  readonly agentBaseUrl: string;
  readonly capabilitiesWebsocketUrl?: string;
  readonly computer: CloudComputer;
  readonly filesystemWebsocketUrl: string;
}

export function MachineWorkspace({
  agentBaseUrl,
  capabilitiesWebsocketUrl,
  computer,
  filesystemWebsocketUrl,
}: MachineWorkspaceProps): React.ReactElement {
  const [isMinimumLoaderElapsed, setIsMinimumLoaderElapsed] = useState(false);
  const [isFilesystemOpen, setIsFilesystemOpen] = useState(false);
  const isWorkspaceReady = isMinimumLoaderElapsed && isFilesystemOpen;
  const loaderImageUrl = computer.kind === "local" ? newMacImageUrl : macImageUrl;

  useEffect(() => {
    document.documentElement.dataset.cloudScreen = "workspace";

    return () => {
      if (document.documentElement.dataset.cloudScreen === "workspace") {
        delete document.documentElement.dataset.cloudScreen;
      }
    };
  }, []);

  useEffect(() => {
    setIsMinimumLoaderElapsed(false);
    setIsFilesystemOpen(false);

    const minimumTimer = window.setTimeout(() => {
      setIsMinimumLoaderElapsed(true);
    }, WORKSPACE_LOADER_MINIMUM_MS);

    return () => {
      window.clearTimeout(minimumTimer);
    };
  }, [computer.id, filesystemWebsocketUrl]);

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
        <FilesystemExplorer
          websocketUrl={filesystemWebsocketUrl}
          agentBaseUrl={agentBaseUrl}
          capabilitiesWebsocketUrl={capabilitiesWebsocketUrl}
          onFilesystemOpen={handleFilesystemOpen}
        />
      </motion.div>
      <AnimatePresence>
        {!isWorkspaceReady ? (
          <motion.section
            key="connecting"
            className="cloud-workspace-loader"
            aria-label="Connecting to machine"
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
            <p>Connecting</p>
          </motion.section>
        ) : null}
      </AnimatePresence>
    </main>
  );
}
