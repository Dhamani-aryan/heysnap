"use client";

import { CloudRuntimeProvider } from "@ank1015-app/ui";

export interface WebCloudRuntimeProviderProps {
  readonly children: React.ReactNode;
  readonly cloudServerUrl: string;
}

export function WebCloudRuntimeProvider({
  children,
  cloudServerUrl,
}: WebCloudRuntimeProviderProps): React.ReactElement {
  return (
    <CloudRuntimeProvider
      cloudServerUrl={cloudServerUrl}
      storageKey="ank1015:web-session-token"
    >
      {children}
    </CloudRuntimeProvider>
  );
}
