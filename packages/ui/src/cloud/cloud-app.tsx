"use client";

import { Suspense, lazy } from "react";

import {
  CloudAppCore,
  type CloudAppProps,
  type CloudWorkspaceLoaderRendererProps,
  type CloudWorkspaceRendererProps,
} from "./cloud-app-core";
import { MachineWorkspaceLoader } from "./machine-workspace-loader";

const MachineWorkspace = lazy(() =>
  import("./machine-workspace").then((module) => ({ default: module.MachineWorkspace })),
);

export type { CloudAppProps, CloudAppRoute, CloudRouteChangeOptions } from "./cloud-app-core";

export function CloudApp(props: CloudAppProps): React.ReactElement {
  return (
    <CloudAppCore
      {...props}
      renderWorkspace={renderWorkspace}
      renderWorkspaceLoader={renderWorkspaceLoader}
    />
  );
}

const renderWorkspace = (props: CloudWorkspaceRendererProps): React.ReactElement => (
  <Suspense
    fallback={(
      <main className="cloud-workspace">
        <MachineWorkspaceLoader
          ariaLabel="Loading machine workspace"
          computer={props.computer}
          label="Loading"
        />
      </main>
    )}
  >
    <MachineWorkspace {...props} />
  </Suspense>
);

const renderWorkspaceLoader = (props: CloudWorkspaceLoaderRendererProps): React.ReactElement => (
  <MachineWorkspaceLoader {...props} />
);
