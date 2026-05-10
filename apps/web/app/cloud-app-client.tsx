"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { CloudApp, type CloudAppRoute, type CloudRouteChangeOptions } from "@ank1015-app/ui";

export interface WebCloudAppProps {
  readonly cloudServerUrl: string;
  readonly route: CloudAppRoute;
}

export function WebCloudApp({
  cloudServerUrl,
  route,
}: WebCloudAppProps): React.ReactElement {
  const router = useRouter();

  const handleRouteChange = useCallback((
    nextRoute: CloudAppRoute,
    options: CloudRouteChangeOptions = {},
  ): void => {
    const nextPath = buildRoutePath(nextRoute);
    if (options.replace === true) {
      router.replace(nextPath);
      return;
    }

    router.push(nextPath);
  }, [router]);

  return (
    <CloudApp
      cloudServerUrl={cloudServerUrl}
      route={route}
      onRouteChange={handleRouteChange}
      storageKey="ank1015:web-session-token"
    />
  );
}

const buildRoutePath = (route: CloudAppRoute): string => {
  if (route.view === "home") {
    return "/";
  }

  if (route.view === "login") {
    return "/login";
  }

  if (route.view === "machines") {
    return "/machines";
  }

  if (route.view === "machine-create") {
    return "/machines/create";
  }

  const machinePath = `/machines/${encodeURIComponent(route.computerId)}`;
  return route.threadId === null || route.threadId === undefined
    ? machinePath
    : `${machinePath}/${encodeURIComponent(route.threadId)}`;
};
