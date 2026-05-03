import { homedir } from "node:os";
import path, { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

import { FilesystemError } from "./errors.js";
import type { FilesystemRoot } from "./types.js";

const ROOT_ENV_NAME = "ANK1015_FILESYSTEM_ROOT";

export const resolveFilesystemRoot = (
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory = homedir(),
): FilesystemRoot => {
  const configuredRoot = env[ROOT_ENV_NAME]?.trim();
  const rawRoot = configuredRoot && configuredRoot.length > 0 ? configuredRoot : "~/Desktop";
  const expandedRoot = expandHome(rawRoot, homeDirectory);
  const absolutePath = resolve(expandedRoot);

  return {
    absolutePath,
    name: basename(absolutePath) || absolutePath,
  };
};

export const resolveClientPath = (rootPath: string, rawPath?: string): string => {
  const relativePath = normalizeClientPath(rawPath);

  if (relativePath === "") {
    return rootPath;
  }

  const targetPath = resolve(rootPath, ...relativePath.split("/"));
  ensureWithinRoot(rootPath, targetPath);

  return targetPath;
};

export const toClientPath = (rootPath: string, targetPath: string): string => {
  ensureWithinRoot(rootPath, targetPath);

  const relativePath = relative(rootPath, targetPath);

  if (relativePath === "") {
    return "";
  }

  return relativePath.split(sep).join("/");
};

export const ensureWithinRoot = (rootPath: string, targetPath: string): void => {
  const normalizedRoot = resolve(rootPath);
  const normalizedTarget = resolve(targetPath);
  const relativePath = relative(normalizedRoot, normalizedTarget);

  if (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  ) {
    return;
  }

  throw new FilesystemError("PATH_OUTSIDE_ROOT", "Path is outside the configured filesystem root");
};

export const validateEntryName = (rawName?: string): string => {
  const name = rawName?.trim();

  if (!name) {
    throw new FilesystemError("INVALID_NAME", "Name is required");
  }

  if (name === "." || name === ".." || name.includes("/") || name.includes("\\") || name.includes("\0")) {
    throw new FilesystemError("INVALID_NAME", "Name cannot contain path separators");
  }

  return name;
};

const normalizeClientPath = (rawPath?: string): string => {
  if (rawPath === undefined || rawPath === "" || rawPath === ".") {
    return "";
  }

  if (typeof rawPath !== "string") {
    throw new FilesystemError("INVALID_PATH", "Path must be a string");
  }

  if (rawPath.includes("\0") || rawPath.startsWith("/") || rawPath.includes("\\")) {
    throw new FilesystemError("INVALID_PATH", "Path must be root-relative");
  }

  const rawSegments = rawPath.split("/");

  if (rawSegments.includes("..")) {
    throw new FilesystemError("INVALID_PATH", "Path cannot contain parent directory segments");
  }

  const normalizedPath = path.posix.normalize(rawPath);

  if (normalizedPath === ".") {
    return "";
  }

  return normalizedPath;
};

const expandHome = (rawPath: string, homeDirectory: string): string => {
  if (rawPath === "~") {
    return homeDirectory;
  }

  if (rawPath.startsWith("~/") || rawPath.startsWith(`~${sep}`)) {
    return join(homeDirectory, rawPath.slice(2));
  }

  return rawPath;
};
