import type { DesktopUpdateBridge } from "../../shared/desktop-updates";

declare global {
  interface Window {
    readonly ank1015DesktopUpdates?: DesktopUpdateBridge;
    readonly ank1015DesktopWindow?: {
      readonly setTitleBarTheme: (theme: "light" | "dark") => Promise<void>;
      readonly setTitleBarColor: (color: string) => Promise<void>;
      readonly toggleFullscreen: () => Promise<void>;
    };
  }
}

export {};
