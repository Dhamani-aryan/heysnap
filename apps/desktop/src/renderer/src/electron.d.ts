import type { LocalMachineBridge } from "@ank1015-app/ui";

declare global {
  interface Window {
    readonly ank1015LocalMachine?: LocalMachineBridge;
  }
}

export {};
