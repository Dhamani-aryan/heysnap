"use client";

import { useParams } from "next/navigation";
import { usePathname } from "next/navigation";

import { WebCloudApp } from "../../cloud-app-client";

export type MachineWorkspacePanel = "chat" | "connectors";

export interface MachineWorkspaceRouteProps {
  readonly cloudServerUrl: string;
  readonly computerId: string;
  readonly panel?: MachineWorkspacePanel;
}

export function MachineWorkspaceRoute({
  cloudServerUrl,
  computerId,
  panel = "chat",
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
    <WebCloudApp
      cloudServerUrl={cloudServerUrl}
      route={{ view: "workspace", computerId, panel: activePanel, threadId }}
    />
  );
}
