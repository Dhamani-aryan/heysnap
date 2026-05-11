"use client";

import { useParams } from "next/navigation";

import { WebCloudApp } from "../../cloud-app-client";

export interface MachineWorkspaceRouteProps {
  readonly cloudServerUrl: string;
  readonly computerId: string;
}

export function MachineWorkspaceRoute({
  cloudServerUrl,
  computerId,
}: MachineWorkspaceRouteProps): React.ReactElement {
  const params = useParams();
  const threadIdParam = params.threadId;
  const threadId = Array.isArray(threadIdParam)
    ? threadIdParam[0] ?? null
    : typeof threadIdParam === "string"
      ? threadIdParam
      : null;

  return (
    <WebCloudApp
      cloudServerUrl={cloudServerUrl}
      route={{ view: "workspace", computerId, threadId }}
    />
  );
}
