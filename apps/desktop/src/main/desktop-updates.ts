import type { App } from "electron";
import { BrowserWindow, shell } from "electron";
import electronUpdater from "electron-updater";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  buildDesktopReleasePlatform,
  type DesktopReleaseManifest,
  type DesktopUpdateProgress,
  type DesktopUpdateStatus,
} from "../shared/desktop-updates.js";

const { autoUpdater } = electronUpdater;

const DEFAULT_CLOUD_SERVER_URL = "https://api.heysnap.xyz";
const DEFAULT_UPDATE_FEED_URL = "https://downloads.heysnap.xyz/desktop/stable";
const DEFAULT_RELEASE_CHANNEL = "stable";
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const STARTUP_CHECK_DELAY_MS = 10_000;

interface ReleaseCheckResponse {
  readonly latest: DesktopReleaseManifest | null;
  readonly currentVersion: string | null;
  readonly updateAvailable: boolean;
}

interface UpdatePreferences {
  readonly dismissedVersion: string | null;
}

export class DesktopUpdateController {
  private readonly cloudServerUrl: string;
  private readonly updateFeedUrl: string;
  private readonly preferencesPath: string;
  private checkTimer: NodeJS.Timeout | null = null;
  private preferencesLoaded = false;
  private status: DesktopUpdateStatus;

  constructor(private readonly electronApp: App) {
    const channel = process.env.DESKTOP_UPDATE_CHANNEL?.trim() || DEFAULT_RELEASE_CHANNEL;
    this.cloudServerUrl = normalizeBaseUrl(
      process.env.CLOUD_SERVER_URL ?? process.env.VITE_CLOUD_SERVER_URL ?? DEFAULT_CLOUD_SERVER_URL,
    );
    this.updateFeedUrl = normalizeBaseUrl(process.env.DESKTOP_UPDATE_FEED_URL ?? DEFAULT_UPDATE_FEED_URL);
    this.preferencesPath = join(electronApp.getPath("userData"), "desktop-updates.json");
    this.status = {
      state: "idle",
      currentVersion: electronApp.getVersion(),
      platform: buildDesktopReleasePlatform(process.platform, process.arch),
      channel,
      latest: null,
      progress: null,
      error: null,
      checkedAt: null,
      dismissedVersion: null,
      isPackaged: electronApp.isPackaged,
    };

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    this.bindAutoUpdaterEvents();
  }

  start(): void {
    if (this.checkTimer !== null) {
      return;
    }

    this.checkTimer = setInterval(() => {
      void this.checkForUpdates().catch((error) => {
        console.error("desktop update check failed", error);
      });
    }, CHECK_INTERVAL_MS);

    setTimeout(() => {
      void this.checkForUpdates().catch((error) => {
        console.error("desktop update check failed", error);
      });
    }, STARTUP_CHECK_DELAY_MS);
  }

  stop(): void {
    if (this.checkTimer !== null) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  async getStatus(): Promise<DesktopUpdateStatus> {
    await this.loadPreferences();
    return this.status;
  }

  async checkForUpdates(): Promise<DesktopUpdateStatus> {
    await this.loadPreferences();
    this.setStatus({
      state: "checking",
      progress: null,
      error: null,
    });

    try {
      const response = await this.fetchLatestRelease();
      const checkedAt = new Date().toISOString();

      if (response.latest !== null && response.updateAvailable) {
        this.setStatus({
          state: "available",
          latest: response.latest,
          progress: null,
          error: null,
          checkedAt,
        });
        return this.status;
      }

      this.setStatus({
        state: "not-available",
        latest: response.latest,
        progress: null,
        error: null,
        checkedAt,
      });
    } catch (error) {
      this.setStatus({
        state: "error",
        latest: null,
        progress: null,
        error: error instanceof Error ? error.message : "Failed to check for updates.",
        checkedAt: new Date().toISOString(),
      });
    }

    return this.status;
  }

  async dismissUpdate(version: string): Promise<DesktopUpdateStatus> {
    await this.writePreferences({ dismissedVersion: version });
    this.setStatus({ dismissedVersion: version });
    return this.status;
  }

  async downloadAndInstallUpdate(): Promise<DesktopUpdateStatus> {
    await this.loadPreferences();

    if (this.status.state === "downloaded") {
      autoUpdater.quitAndInstall(false, true);
      return this.status;
    }

    let latest = this.status.latest;

    if (latest === null || this.status.state === "not-available" || this.status.state === "idle") {
      await this.checkForUpdates();
      latest = this.status.latest;
    }

    if (latest === null || this.status.state !== "available") {
      this.setStatus({
        state: "error",
        error: "No desktop update is available.",
      });
      return this.status;
    }

    if (!this.electronApp.isPackaged) {
      if (latest.downloadUrl === null) {
        this.setStatus({
          state: "error",
          error: "This update does not include a download URL.",
        });
        return this.status;
      }

      await shell.openExternal(latest.downloadUrl);
      return this.status;
    }

    this.setStatus({
      state: "downloading",
      progress: null,
      error: null,
    });

    try {
      autoUpdater.setFeedURL({
        provider: "generic",
        url: readFeedUrl(latest, this.updateFeedUrl),
        channel: this.status.channel,
      });
      await autoUpdater.checkForUpdates();
      await autoUpdater.downloadUpdate();
    } catch (error) {
      this.setStatus({
        state: "error",
        progress: null,
        error: error instanceof Error ? error.message : "Failed to download the update.",
      });
    }

    return this.status;
  }

  private async fetchLatestRelease(): Promise<ReleaseCheckResponse> {
    const url = new URL("/releases/desktop/latest", this.cloudServerUrl);
    url.searchParams.set("platform", this.status.platform);
    url.searchParams.set("channel", this.status.channel);
    url.searchParams.set("currentVersion", this.status.currentVersion);

    const response = await fetch(url);
    const body = await readJson(response);

    if (!response.ok) {
      throw new Error(readErrorMessage(body));
    }

    return parseReleaseCheckResponse(body);
  }

  private bindAutoUpdaterEvents(): void {
    autoUpdater.on("download-progress", (progress) => {
      this.setStatus({
        state: "downloading",
        progress: serializeProgress(progress),
        error: null,
      });
    });

    autoUpdater.on("update-downloaded", () => {
      this.setStatus({
        state: "downloaded",
        progress: {
          percent: 100,
          transferred: this.status.progress?.total ?? 0,
          total: this.status.progress?.total ?? 0,
          bytesPerSecond: 0,
        },
        error: null,
      });
    });

    autoUpdater.on("error", (error) => {
      this.setStatus({
        state: "error",
        progress: null,
        error: error.message,
      });
    });
  }

  private async loadPreferences(): Promise<void> {
    if (this.preferencesLoaded) {
      return;
    }

    this.preferencesLoaded = true;
    const preferences = await this.readPreferences();
    this.setStatus({ dismissedVersion: preferences.dismissedVersion });
  }

  private async readPreferences(): Promise<UpdatePreferences> {
    try {
      const raw = await readFile(this.preferencesPath, "utf8");
      const parsed = JSON.parse(raw) as unknown;

      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "dismissedVersion" in parsed &&
        (typeof parsed.dismissedVersion === "string" || parsed.dismissedVersion === null)
      ) {
        return { dismissedVersion: parsed.dismissedVersion };
      }
    } catch {
      // Missing or malformed preferences should not block update checks.
    }

    return { dismissedVersion: null };
  }

  private async writePreferences(preferences: UpdatePreferences): Promise<void> {
    await mkdir(dirname(this.preferencesPath), { recursive: true });
    await writeFile(this.preferencesPath, `${JSON.stringify(preferences, null, 2)}\n`, "utf8");
  }

  private setStatus(patch: Partial<DesktopUpdateStatus>): void {
    this.status = {
      ...this.status,
      ...patch,
    };
    this.emitStatus();
  }

  private emitStatus(): void {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send("desktop-updates:status", this.status);
    }
  }
}

const normalizeBaseUrl = (input: string): string => input.replace(/\/+$/, "");

const readFeedUrl = (manifest: DesktopReleaseManifest, fallback: string): string => {
  if (
    typeof manifest.metadata === "object" &&
    manifest.metadata !== null &&
    "feedUrl" in manifest.metadata &&
    typeof manifest.metadata.feedUrl === "string" &&
    manifest.metadata.feedUrl.trim().length > 0
  ) {
    return normalizeBaseUrl(manifest.metadata.feedUrl);
  }

  return fallback;
};

const serializeProgress = (progress: {
  readonly percent?: number;
  readonly transferred?: number;
  readonly total?: number;
  readonly bytesPerSecond?: number;
}): DesktopUpdateProgress => ({
  percent: typeof progress.percent === "number" ? progress.percent : 0,
  transferred: typeof progress.transferred === "number" ? progress.transferred : 0,
  total: typeof progress.total === "number" ? progress.total : 0,
  bytesPerSecond: typeof progress.bytesPerSecond === "number" ? progress.bytesPerSecond : 0,
});

const readJson = async (response: Response): Promise<unknown> => {
  const text = await response.text();

  if (text.length === 0) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
};

const readErrorMessage = (body: unknown): string => {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "object" &&
    body.error !== null &&
    "message" in body.error &&
    typeof body.error.message === "string"
  ) {
    return body.error.message;
  }

  return "Failed to check for updates.";
};

const parseReleaseCheckResponse = (body: unknown): ReleaseCheckResponse => {
  if (typeof body !== "object" || body === null) {
    throw new Error("Invalid update response.");
  }

  const value = body as {
    readonly latest?: unknown;
    readonly currentVersion?: unknown;
    readonly updateAvailable?: unknown;
  };

  return {
    latest: parseReleaseManifest(value.latest),
    currentVersion: typeof value.currentVersion === "string" ? value.currentVersion : null,
    updateAvailable: value.updateAvailable === true,
  };
};

const parseReleaseManifest = (value: unknown): DesktopReleaseManifest | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "object") {
    throw new Error("Invalid update manifest.");
  }

  const manifest = value as Record<string, unknown>;
  const id = readRequiredString(manifest, "id");
  const target = readRequiredString(manifest, "target");
  const channel = readRequiredString(manifest, "channel");
  const platform = readRequiredString(manifest, "platform");
  const version = readRequiredString(manifest, "version");
  const releasedAt = readRequiredString(manifest, "releasedAt");
  const createdAt = readRequiredString(manifest, "createdAt");
  const updatedAt = readRequiredString(manifest, "updatedAt");

  if (target !== "desktop") {
    throw new Error("Invalid desktop update manifest.");
  }

  return {
    id,
    target,
    channel,
    platform,
    version,
    downloadUrl: readNullableString(manifest, "downloadUrl"),
    signatureUrl: readNullableString(manifest, "signatureUrl"),
    dockerImage: readNullableString(manifest, "dockerImage"),
    notes: readNullableString(manifest, "notes"),
    metadata: manifest.metadata ?? {},
    releasedAt,
    createdAt,
    updatedAt,
  };
};

const readRequiredString = (value: Record<string, unknown>, key: string): string => {
  const field = value[key];

  if (typeof field !== "string" || field.length === 0) {
    throw new Error("Invalid update manifest.");
  }

  return field;
};

const readNullableString = (value: Record<string, unknown>, key: string): string | null => {
  const field = value[key];
  return typeof field === "string" ? field : null;
};
