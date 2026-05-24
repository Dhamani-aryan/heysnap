import type { FilesystemEntry } from "../../../filesystem/types";
import type { OpenFileTab } from "../finder/finder-types";

export const normalizeInitialFilesystemPath = (path: string | undefined): string | undefined => {
  if (path === undefined) {
    return undefined;
  }

  const normalizedPath = path.trim();
  return normalizedPath.length === 0 ? "" : normalizedPath;
};

export const createInitialNavigationHistory = (path: string): string[] => {
  const segments = path.trim().split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return [];
  }

  return [
    "",
    ...segments.map((_, index) => segments.slice(0, index + 1).join("/")),
  ];
};

export const isInvalidInitialFilesystemPathError = (message: string): boolean =>
  /path (?:is not a directory|not found)/iu.test(message);

const isFilesystemConnectionErrorMessage = (message: string): boolean =>
  message === "Filesystem connection failed." ||
  message === "Filesystem connection closed." ||
  message === "Filesystem connection is not open.";

export const toListingErrorMessage = (message: string | null): string | null => {
  if (message === null || isFilesystemConnectionErrorMessage(message)) {
    return null;
  }

  return message;
};

export const isFilesystemEntry = (value: unknown): value is FilesystemEntry => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record["name"] === "string" &&
    typeof record["path"] === "string" &&
    (record["type"] === "file" || record["type"] === "directory")
  );
};

export const toOpenFileTab = (entry: FilesystemEntry): OpenFileTab => ({
  name: entry.name,
  path: entry.path,
  size: entry.size,
  updatedAt: entry.updatedAt,
});

export const normalizeOpenFilePath = (rawPath: string): string | null => {
  const path = rawPath.trim().replaceAll("\\", "/");
  if (path.length === 0 || path.includes("\0")) {
    return null;
  }

  if (path.startsWith("/")) {
    if (path === "/workspace") {
      return "";
    }
    if (path.startsWith("/workspace/")) {
      const relativePath = path.slice("/workspace/".length);
      return !relativePath.split("/").includes("..") ? relativePath : null;
    }

    const desktopIndex = path.indexOf("/Desktop/");
    if (desktopIndex < 0) {
      return null;
    }

    const relativePath = path.slice(desktopIndex + "/Desktop/".length);
    return relativePath.length > 0 && !relativePath.split("/").includes("..") ? relativePath : null;
  }

  const relativePath = path;
  if (relativePath.startsWith("/") || relativePath.split("/").includes("..")) {
    return null;
  }

  return relativePath;
};

export const getParentPath = (path: string): string => {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) {
    return "";
  }

  return parts.slice(0, -1).join("/");
};

export const joinClientPath = (directoryPath: string, name: string): string =>
  directoryPath.length === 0 ? name : `${directoryPath}/${name}`;

export const buildFilesystemDownloadUrl = (
  filesystemWebsocketUrl: string,
  paths: readonly string[],
): string => {
  const baseUrl = typeof window !== "undefined" && typeof window.location?.href === "string" ? window.location.href : "http://localhost";
  const url = new URL(filesystemWebsocketUrl, baseUrl);

  if (url.protocol === "ws:") {
    url.protocol = "http:";
  } else if (url.protocol === "wss:") {
    url.protocol = "https:";
  }

  url.pathname = url.pathname.replace(/\/filesystem\/?$/u, "/filesystem/download");
  url.searchParams.delete("path");
  url.searchParams.delete("showHidden");
  url.searchParams.delete("v");
  paths.forEach((path) => {
    url.searchParams.append("path", path);
  });

  return url.toString();
};
