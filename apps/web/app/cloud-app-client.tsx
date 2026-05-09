"use client";

import { useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { CloudApp } from "@ank1015-app/ui";

export interface WebCloudAppProps {
  readonly cloudServerUrl: string;
  readonly initialComputerId?: string;
  readonly initialThreadId?: string;
}

export function WebCloudApp({
  cloudServerUrl,
  initialComputerId,
  initialThreadId,
}: WebCloudAppProps): React.ReactElement {
  const router = useRouter();
  const params = useParams();
  const routeComputerId = initialComputerId ?? readRouteParam(params["computerId"]);
  const routeThreadId = initialThreadId ?? readRouteParam(params["threadId"]);

  const handleWorkspaceRouteChange = useCallback((
    route: { readonly computerId: string | null; readonly threadId: string | null },
    options: { readonly replace?: boolean } = {},
  ): void => {
    const nextPath = buildWorkspacePath(route);
    if (options.replace === true) {
      router.replace(nextPath);
      return;
    }

    router.push(nextPath);
  }, [router]);

  return (
    <CloudApp
      cloudServerUrl={cloudServerUrl}
      includeLocalMachine={false}
      initialComputerId={routeComputerId}
      initialThreadId={routeThreadId}
      onWorkspaceRouteChange={handleWorkspaceRouteChange}
      storageKey="ank1015:web-session-token"
    />
  );
}

const buildWorkspacePath = (route: {
  readonly computerId: string | null;
  readonly threadId: string | null;
}): string => {
  if (route.computerId === null) {
    return "/";
  }

  const machinePath = `/${encodeURIComponent(route.computerId)}`;
  return route.threadId === null ? machinePath : `${machinePath}/${encodeURIComponent(route.threadId)}`;
};

const readRouteParam = (value: string | string[] | undefined): string | undefined => {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
};
