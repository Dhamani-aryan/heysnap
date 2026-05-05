export interface DesktopReleaseManifest {
  readonly id: string;
  readonly target: "desktop";
  readonly channel: string;
  readonly platform: string;
  readonly version: string;
  readonly downloadUrl: string | null;
  readonly signatureUrl: string | null;
  readonly dockerImage: string | null;
  readonly notes: string | null;
  readonly metadata: unknown;
  readonly releasedAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DesktopUpdateProgress {
  readonly percent: number;
  readonly transferred: number;
  readonly total: number;
  readonly bytesPerSecond: number;
}

export type DesktopUpdateState =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "not-available"
  | "error";

export interface DesktopUpdateStatus {
  readonly state: DesktopUpdateState;
  readonly currentVersion: string;
  readonly platform: string;
  readonly channel: string;
  readonly latest: DesktopReleaseManifest | null;
  readonly progress: DesktopUpdateProgress | null;
  readonly error: string | null;
  readonly checkedAt: string | null;
  readonly dismissedVersion: string | null;
  readonly isPackaged: boolean;
}

export interface DesktopUpdateBridge {
  getUpdateStatus(): Promise<DesktopUpdateStatus>;
  checkForUpdates(): Promise<DesktopUpdateStatus>;
  downloadAndInstallUpdate(): Promise<DesktopUpdateStatus>;
  dismissUpdate(version: string): Promise<DesktopUpdateStatus>;
  onStatusChanged(callback: (status: DesktopUpdateStatus) => void): () => void;
}

export const buildDesktopReleasePlatform = (platform: string, arch: string): string => {
  if (platform === "darwin") {
    return arch === "arm64" ? "darwin-arm64" : "darwin-x64";
  }

  if (platform === "win32") {
    return arch === "arm64" ? "win32-arm64" : "win32-x64";
  }

  return `${platform}-${arch}`;
};
