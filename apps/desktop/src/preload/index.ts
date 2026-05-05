import { contextBridge, ipcRenderer } from "electron";

import type { DesktopUpdateStatus } from "../shared/desktop-updates.js";

window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.dataset.desktop = "true";
});

contextBridge.exposeInMainWorld("ank1015LocalMachine", {
  getStatus: () => ipcRenderer.invoke("local-machine:get-status"),
  syncCloudSession: (input: { readonly cloudServerUrl: string; readonly sessionToken: string }) =>
    ipcRenderer.invoke("local-machine:sync-cloud-session", input),
});

contextBridge.exposeInMainWorld("ank1015DesktopUpdates", {
  getUpdateStatus: () => ipcRenderer.invoke("desktop-updates:get-status"),
  checkForUpdates: () => ipcRenderer.invoke("desktop-updates:check"),
  downloadAndInstallUpdate: () => ipcRenderer.invoke("desktop-updates:download-install"),
  dismissUpdate: (version: string) => ipcRenderer.invoke("desktop-updates:dismiss", version),
  onStatusChanged: (callback: (status: DesktopUpdateStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: DesktopUpdateStatus) => {
      callback(status);
    };

    ipcRenderer.on("desktop-updates:status", listener);

    return () => {
      ipcRenderer.removeListener("desktop-updates:status", listener);
    };
  },
});
