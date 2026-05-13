"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { CloudDashboardApp, type CloudAppRoute, type CloudRouteChangeOptions } from "@ank1015-app/ui/cloud-dashboard-app";
import { toast } from "sonner";

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

  const handleMachineCreateStarted = useCallback((): void => {
    toast("Welcome!", {
      description: "Creating a computer can take couple of minutes",
    });
  }, []);

  return (
    <CloudDashboardApp
      cloudServerUrl={cloudServerUrl}
      route={route}
      onRouteChange={handleRouteChange}
      onMachineCreateStarted={handleMachineCreateStarted}
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
  if (route.panel === "connectors") {
    return `${machinePath}/connectors`;
  }

  return route.threadId === null || route.threadId === undefined
    ? machinePath
    : `${machinePath}/${encodeURIComponent(route.threadId)}`;
};
