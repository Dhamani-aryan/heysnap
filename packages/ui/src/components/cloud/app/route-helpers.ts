import type { CloudComputer } from "../../../cloud/cloud-client";

import type { CloudAppRoute } from "./cloud-app-core";

export const getPostAuthRoute = (computers: readonly CloudComputer[]): CloudAppRoute =>
  computers.length === 0 ? { view: "machine-create" } : { view: "machines" };
