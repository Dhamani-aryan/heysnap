import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";

import { LocalMachineController, type SyncCloudSessionInput } from "./local-machine.js";

const localMachine = new LocalMachineController(app);

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
  void localMachine.start().catch((error) => {
    console.error("failed to start local machine server", error);
  });

  ipcMain.handle("local-machine:get-status", () => localMachine.getStatus());
  ipcMain.handle("local-machine:sync-cloud-session", async (_event, input: SyncCloudSessionInput) =>
    await localMachine.syncCloudSession(input)
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
  void localMachine.stop().catch((error) => {
    console.error("failed to stop local machine server", error);
  });
});
