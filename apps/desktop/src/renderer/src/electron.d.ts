import type { LocalMachineBridge } from "@ank1015-app/ui";

import type { DesktopUpdateBridge } from "../../shared/desktop-updates";

declare global {
  interface Window {
    readonly ank1015LocalMachine?: LocalMachineBridge;
    readonly ank1015DesktopUpdates?: DesktopUpdateBridge;
  }
}

export {};
