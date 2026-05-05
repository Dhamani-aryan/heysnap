import { contextBridge, ipcRenderer } from "electron";

window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.dataset.desktop = "true";
});

contextBridge.exposeInMainWorld("ank1015LocalMachine", {
  getStatus: () => ipcRenderer.invoke("local-machine:get-status"),
  syncCloudSession: (input: { readonly cloudServerUrl: string; readonly sessionToken: string }) =>
    ipcRenderer.invoke("local-machine:sync-cloud-session", input),
});
