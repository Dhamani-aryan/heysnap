"use client";

import { useParams } from "next/navigation";
import { usePathname } from "next/navigation";

import { WebCloudWorkspaceApp } from "../../cloud-workspace-client";

export type MachineWorkspacePanel = "chat" | "connectors";

export interface MachineWorkspaceRouteProps {
  readonly cloudServerUrl: string;
  readonly computerId: string;
  readonly browserControlExtensionId?: string;
  readonly panel?: MachineWorkspacePanel;
  readonly sarvamApiKey?: string;
}

export function MachineWorkspaceRoute({
  cloudServerUrl,
  computerId,
  browserControlExtensionId,
  panel = "chat",
  sarvamApiKey,
}: MachineWorkspaceRouteProps): React.ReactElement {
  const params = useParams();
  const pathname = usePathname();
  const activePanel = pathname.endsWith("/connectors") ? "connectors" : panel;
  const threadIdParam = params.threadId;
  const threadId = activePanel === "connectors"
    ? null
    : Array.isArray(threadIdParam)
      ? threadIdParam[0] ?? null
      : typeof threadIdParam === "string"
        ? threadIdParam
        : null;

  return (
    <WebCloudWorkspaceApp
      cloudServerUrl={cloudServerUrl}
      browserControlExtensionId={browserControlExtensionId}
      sarvamApiKey={sarvamApiKey}
      route={{ view: "workspace", computerId, panel: activePanel, threadId }}
    />
  );
}
