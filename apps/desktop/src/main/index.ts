import { app, BrowserWindow, ipcMain, nativeTheme } from "electron";
import { join } from "node:path";

import { DesktopUpdateController } from "./desktop-updates.js";
import { LocalMachineController, type SyncCloudSessionInput } from "./local-machine.js";

const localMachine = new LocalMachineController(app);
let desktopUpdates: DesktopUpdateController | null = null;
let isQuitInProgress = false;
const desktopTitle = "HeySnap";
const titleBarBackgroundByTheme = {
  light: "#ffffff",
  dark: "#0f0f11",
} as const;

type Theme = keyof typeof titleBarBackgroundByTheme;

function createWindow() {
  const mainWindow = new BrowserWindow({
    title: desktopTitle,
    width: 1100,
    height: 760,
    backgroundColor: nativeTheme.shouldUseDarkColors
      ? titleBarBackgroundByTheme.dark
      : titleBarBackgroundByTheme.light,
    titleBarStyle: "hiddenInset",
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
  app.setName(desktopTitle);

  desktopUpdates = new DesktopUpdateController(app);
  desktopUpdates.start();

  void localMachine.start().catch((error) => {
    console.error("failed to start local machine server", error);
  });

  ipcMain.handle("local-machine:get-status", () => localMachine.getStatus());
  ipcMain.handle("local-machine:get-registration-preview", async () =>
    await localMachine.getRegistrationPreview()
  );
  ipcMain.handle("local-machine:sync-cloud-session", async (_event, input: SyncCloudSessionInput) =>
    await localMachine.syncCloudSession(input)
  );
  ipcMain.handle("desktop-updates:get-status", async () => await getDesktopUpdates().getStatus());
  ipcMain.handle("desktop-updates:check", async () => await getDesktopUpdates().checkForUpdates());
  ipcMain.handle("desktop-updates:download-install", async () => await getDesktopUpdates().downloadAndInstallUpdate());
  ipcMain.handle("desktop-updates:dismiss", async (_event, version: string) =>
    await getDesktopUpdates().dismissUpdate(version)
  );
  ipcMain.handle("desktop-window:set-title-bar-theme", (event, theme: Theme) => {
    if (theme !== "light" && theme !== "dark") {
      return;
    }

    nativeTheme.themeSource = theme;
    const window = BrowserWindow.fromWebContents(event.sender);
    window?.setBackgroundColor(titleBarBackgroundByTheme[theme]);
  });
  ipcMain.handle("desktop-window:set-title-bar-color", (event, color: string) => {
    if (typeof color !== "string" || color.trim().length === 0) {
      return;
    }

    const window = BrowserWindow.fromWebContents(event.sender);
    window?.setBackgroundColor(color.trim());
  });
  ipcMain.handle("desktop-window:toggle-fullscreen", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);

    if (window === null) {
      return;
    }

    window.setFullScreen(!window.isFullScreen());
  });

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

app.on("before-quit", (event) => {
  if (isQuitInProgress) {
    return;
  }

  event.preventDefault();
  desktopUpdates?.stop();
  void localMachine.stop()
    .catch((error) => {
      console.error("failed to stop local machine server", error);
    })
    .finally(() => {
      isQuitInProgress = true;
      app.quit();
    });
});

const getDesktopUpdates = (): DesktopUpdateController => {
  if (desktopUpdates === null) {
    throw new Error("Desktop update controller is not ready.");
  }

  return desktopUpdates;
};
