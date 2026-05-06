import { lstat, mkdir, readdir, realpath, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import path, { basename, dirname, join } from "node:path";

import trash from "trash";
import { FilesystemError } from "./errors.js";
import { ensureWithinRoot, resolveClientPath, toClientPath, validateEntryName } from "./paths.js";
import type { FilesystemEntry, FilesystemEntryType, FilesystemListing, FilesystemUploadFile } from "./types.js";

export type TrashFunction = (input: string | readonly string[]) => Promise<void>;

export interface FilesystemServiceOptions {
  readonly rootPath: string;
  readonly trashFunction?: TrashFunction;
}

const DEFAULT_FOLDER_NAME = "untitled folder";

export class FilesystemService {
  private readonly rootPath: string;
  private readonly trashFunction: TrashFunction;

  constructor(options: FilesystemServiceOptions) {
    this.rootPath = options.rootPath;
    this.trashFunction = options.trashFunction ?? ((input) => trash(input, { glob: false }));
  }

  async listDirectory(rawPath: string | undefined, showHidden: boolean): Promise<FilesystemListing> {
    const directoryPath = resolveClientPath(this.rootPath, rawPath);
    const directoryStats = await this.getStats(directoryPath);

    if (!directoryStats.isDirectory()) {
      throw new FilesystemError("NOT_DIRECTORY", "Path is not a directory");
    }

    const dirEntries = await readdir(directoryPath, { withFileTypes: true });
    const mappedEntries = await Promise.all(
      dirEntries.map(async (entry): Promise<FilesystemEntry | null> => {
        const entryPath = join(directoryPath, entry.name);
        const isSymlink = entry.isSymbolicLink();

        if (isSymlink && !(await this.isSafeSymlink(entryPath))) {
          return null;
        }

        try {
          const entryStats = await lstat(entryPath);
          const resolvedStats = isSymlink ? await stat(entryPath) : entryStats;
          const type = classifyEntryType(resolvedStats.isDirectory(), resolvedStats.isFile());

          if (type === null) {
            return null;
          }

          return {
            name: entry.name,
            path: toClientPath(this.rootPath, entryPath),
            type,
            size: type === "file" ? entryStats.size : null,
            updatedAt: entryStats.mtime.toISOString(),
            isHidden: entry.name.startsWith("."),
            isSymlink,
          };
        } catch {
          return null;
        }
      }),
    );

    const entries = mappedEntries
      .filter((entry): entry is FilesystemEntry => entry !== null)
      .filter((entry) => showHidden || !entry.isHidden)
      .sort(compareEntries);
    const clientPath = toClientPath(this.rootPath, directoryPath);
    const parentDirectory = dirname(directoryPath);
    const parent =
      directoryPath === this.rootPath ? null : toClientPath(this.rootPath, parentDirectory);

    return {
      path: clientPath,
      name: basename(directoryPath) || directoryPath,
      parent,
      isRoot: directoryPath === this.rootPath,
      entries,
    };
  }

  async createFolder(rawDirectoryPath: string | undefined, rawName?: string): Promise<FilesystemEntry> {
    const directoryPath = resolveClientPath(this.rootPath, rawDirectoryPath);
    const directoryStats = await this.getStats(directoryPath);

    if (!directoryStats.isDirectory()) {
      throw new FilesystemError("NOT_DIRECTORY", "Path is not a directory");
    }

    const folderPath = rawName === undefined
      ? await this.getAvailableFolderPath(directoryPath)
      : join(directoryPath, validateEntryName(rawName));

    ensureWithinRoot(this.rootPath, folderPath);
    await this.ensurePathAvailable(folderPath);
    await mkdir(folderPath);

    return this.getEntry(folderPath);
  }

  async uploadFiles(
    rawDirectoryPath: string | undefined,
    files: readonly FilesystemUploadFile[],
  ): Promise<{ readonly entries: FilesystemEntry[] }> {
    if (files.length === 0) {
      throw new FilesystemError("INVALID_UPLOAD", "At least one file is required");
    }

    const directoryPath = resolveClientPath(this.rootPath, rawDirectoryPath);
    const directoryStats = await this.getStats(directoryPath);

    if (!directoryStats.isDirectory()) {
      throw new FilesystemError("NOT_DIRECTORY", "Path is not a directory");
    }

    const targetPaths = files.map((file) => {
      const relativePath = validateUploadRelativePath(file.relativePath);
      const targetPath = join(directoryPath, ...relativePath.split("/"));
      ensureWithinRoot(this.rootPath, targetPath);
      ensureWithinRoot(directoryPath, targetPath);
      return targetPath;
    });

    const uniquePaths = new Set(targetPaths);

    if (uniquePaths.size !== targetPaths.length) {
      throw new FilesystemError("DUPLICATE_UPLOAD_PATH", "Upload contains duplicate file paths");
    }

    await Promise.all(targetPaths.map((targetPath) => this.ensurePathAvailable(targetPath)));

    const uploadedEntries: FilesystemEntry[] = [];

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const targetPath = targetPaths[index];

      if (file === undefined || targetPath === undefined) {
        continue;
      }

      const content = decodeBase64(file.contentBase64);
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, content, { flag: "wx" });

      if (file.updatedAt !== undefined) {
        const updatedAt = new Date(file.updatedAt);

        if (!Number.isNaN(updatedAt.getTime())) {
          await utimes(targetPath, updatedAt, updatedAt);
        }
      }

      uploadedEntries.push(await this.getEntry(targetPath));
    }

    return { entries: uploadedEntries };
  }

  async renameEntry(rawPath: string, rawNewName: string): Promise<FilesystemEntry> {
    const targetPath = resolveClientPath(this.rootPath, rawPath);
    await this.getStats(targetPath);

    const nextPath = join(dirname(targetPath), validateEntryName(rawNewName));
    ensureWithinRoot(this.rootPath, nextPath);

    if (nextPath === targetPath) {
      return this.getEntry(targetPath);
    }

    await this.ensurePathAvailable(nextPath);
    await rename(targetPath, nextPath);

    return this.getEntry(nextPath);
  }

  async trashEntries(rawPaths: readonly string[]): Promise<{ readonly paths: string[] }> {
    if (rawPaths.length === 0) {
      throw new FilesystemError("INVALID_PATH", "At least one path is required");
    }

    const targetPaths = await Promise.all(
      rawPaths.map(async (rawPath) => {
        const targetPath = resolveClientPath(this.rootPath, rawPath);
        await this.getStats(targetPath);
        return targetPath;
      }),
    );

    await this.trashFunction(targetPaths);

    return { paths: rawPaths.map((rawPath) => toClientPath(this.rootPath, resolveClientPath(this.rootPath, rawPath))) };
  }

  private async getEntry(entryPath: string): Promise<FilesystemEntry> {
    let entryStats;
    let resolvedStats;

    try {
      entryStats = await lstat(entryPath);
      resolvedStats = entryStats.isSymbolicLink() ? await stat(entryPath) : entryStats;
    } catch {
      throw new FilesystemError("PATH_NOT_FOUND", "Path not found");
    }

    const type = classifyEntryType(resolvedStats.isDirectory(), resolvedStats.isFile());

    if (type === null) {
      throw new FilesystemError("UNSUPPORTED_ENTRY", "Unsupported entry type");
    }

    return {
      name: basename(entryPath),
      path: toClientPath(this.rootPath, entryPath),
      type,
      size: type === "file" ? entryStats.size : null,
      updatedAt: entryStats.mtime.toISOString(),
      isHidden: basename(entryPath).startsWith("."),
      isSymlink: entryStats.isSymbolicLink(),
    };
  }

  private async getStats(targetPath: string): Promise<Awaited<ReturnType<typeof stat>>> {
    try {
      return await stat(targetPath);
    } catch {
      throw new FilesystemError("PATH_NOT_FOUND", "Path not found");
    }
  }

  private async getAvailableFolderPath(directoryPath: string): Promise<string> {
    for (let index = 1; index < 1000; index += 1) {
      const folderName = index === 1 ? DEFAULT_FOLDER_NAME : `${DEFAULT_FOLDER_NAME} ${String(index)}`;
      const folderPath = join(directoryPath, folderName);

      if (await this.isPathAvailable(folderPath)) {
        return folderPath;
      }
    }

    throw new FilesystemError("NO_AVAILABLE_NAME", "Could not find an available folder name");
  }

  private async ensurePathAvailable(targetPath: string): Promise<void> {
    if (!(await this.isPathAvailable(targetPath))) {
      throw new FilesystemError("PATH_EXISTS", "An item with that name already exists");
    }
  }

  private async isPathAvailable(targetPath: string): Promise<boolean> {
    try {
      await lstat(targetPath);
      return false;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return true;
      }

      throw error;
    }
  }

  private async isSafeSymlink(entryPath: string): Promise<boolean> {
    try {
      ensureWithinRoot(await realpath(this.rootPath), await realpath(entryPath));
      return true;
    } catch {
      return false;
    }
  }
}

export const removeEntriesForTest: TrashFunction = async (input) => {
  const paths = Array.isArray(input) ? input : [input];
  await Promise.all(paths.map((targetPath) => rm(targetPath, { recursive: true, force: false })));
};

const classifyEntryType = (isDirectory: boolean, isFile: boolean): FilesystemEntryType | null => {
  if (isDirectory) {
    return "directory";
  }

  if (isFile) {
    return "file";
  }

  return null;
};

const compareEntries = (a: FilesystemEntry, b: FilesystemEntry): number => {
  if (a.type !== b.type) {
    return a.type === "directory" ? -1 : 1;
  }

  return a.name.localeCompare(b.name);
};

const validateUploadRelativePath = (rawPath: string): string => {
  if (typeof rawPath !== "string" || rawPath.trim().length === 0) {
    throw new FilesystemError("INVALID_UPLOAD_PATH", "Upload path is required");
  }

  if (rawPath.includes("\0") || rawPath.startsWith("/") || rawPath.includes("\\")) {
    throw new FilesystemError("INVALID_UPLOAD_PATH", "Upload path must be relative");
  }

  const normalizedPath = path.posix.normalize(rawPath);

  if (normalizedPath === "." || normalizedPath.startsWith("../") || normalizedPath === "..") {
    throw new FilesystemError("INVALID_UPLOAD_PATH", "Upload path cannot leave the target folder");
  }

  normalizedPath.split("/").forEach(validateEntryName);

  return normalizedPath;
};

const decodeBase64 = (contentBase64: string): Buffer => {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(contentBase64) || contentBase64.length % 4 !== 0) {
    throw new FilesystemError("INVALID_UPLOAD_CONTENT", "Upload content must be base64 encoded");
  }

  return Buffer.from(contentBase64, "base64");
};

const isNodeError = (value: unknown): value is NodeJS.ErrnoException =>
  value instanceof Error && "code" in value;
