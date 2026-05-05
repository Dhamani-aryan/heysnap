import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";

import { DesktopUpdateController } from "./desktop-updates.js";
import { LocalMachineController, type SyncCloudSessionInput } from "./local-machine.js";

const localMachine = new LocalMachineController(app);
let desktopUpdates: DesktopUpdateController | null = null;

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

void app.whenReady().then(() => {
  desktopUpdates = new DesktopUpdateController(app);
  desktopUpdates.start();

  void localMachine.start().catch((error) => {
    console.error("failed to start local machine server", error);
  });

  ipcMain.handle("local-machine:get-status", () => localMachine.getStatus());
  ipcMain.handle("local-machine:sync-cloud-session", async (_event, input: SyncCloudSessionInput) =>
    await localMachine.syncCloudSession(input)
  );
  ipcMain.handle("desktop-updates:get-status", async () => await getDesktopUpdates().getStatus());
  ipcMain.handle("desktop-updates:check", async () => await getDesktopUpdates().checkForUpdates());
  ipcMain.handle("desktop-updates:download-install", async () => await getDesktopUpdates().downloadAndInstallUpdate());
  ipcMain.handle("desktop-updates:dismiss", async (_event, version: string) =>
    await getDesktopUpdates().dismissUpdate(version)
  );

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  desktopUpdates?.stop();
  void localMachine.stop().catch((error) => {
    console.error("failed to stop local machine server", error);
  });
});

const getDesktopUpdates = (): DesktopUpdateController => {
  if (desktopUpdates === null) {
    throw new Error("Desktop update controller is not ready.");
  }

  return desktopUpdates;
};
