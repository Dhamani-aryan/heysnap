"use client";

import { AnimatePresence, motion } from "motion/react";

import type { CloudComputer } from "../../../cloud/cloud-client";

import { BrowserExtensionPromptDialog } from "./browser-extension-prompt-dialog";
import { MachineWorkspaceLoader, WORKSPACE_TRANSITION } from "./machine-workspace-loader";

export function MachineWorkspaceShell({
  children,
  computer,
  isBrowserExtensionDialogOpen,
  isWorkspaceReady,
  onCloseBrowserExtensionDialog,
}: {
  readonly children: React.ReactNode;
  readonly computer: CloudComputer;
  readonly isBrowserExtensionDialogOpen: boolean;
  readonly isWorkspaceReady: boolean;
  readonly onCloseBrowserExtensionDialog: () => void;
}): React.ReactElement {
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
        {children}
      </motion.div>
      {isBrowserExtensionDialogOpen ? (
        <BrowserExtensionPromptDialog onClose={onCloseBrowserExtensionDialog} />
      ) : null}
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
