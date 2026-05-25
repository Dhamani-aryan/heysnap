import type { InputHTMLAttributes } from "react";

import type { FilesystemUploadFile } from "../../../filesystem/types";
import { joinClientPath } from "./filesystem-paths";

export const folderPickerAttributes = {
  webkitdirectory: "",
  directory: "",
} as InputHTMLAttributes<HTMLInputElement>;

export type BrowserUploadSource =
  | {
      readonly type: "file";
      readonly relativePath: string;
      readonly file: File;
    }
  | {
      readonly type: "directory";
      readonly relativePath: string;
    };

type BrowserFileSystemHandle = {
  readonly kind: "file" | "directory";
  readonly name: string;
};

type BrowserFileHandle = BrowserFileSystemHandle & {
  readonly kind: "file";
  getFile(): Promise<File>;
};

export type BrowserDirectoryHandle = BrowserFileSystemHandle & {
  readonly kind: "directory";
  values(): AsyncIterable<BrowserFileSystemHandle>;
};

export type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { readonly mode?: "read" | "readwrite" }) => Promise<BrowserDirectoryHandle>;
};

export const toFilesystemUploadFile = async (source: Extract<BrowserUploadSource, { readonly type: "file" }>): Promise<FilesystemUploadFile> => ({
  type: "file",
  relativePath: source.relativePath,
  contentBase64: arrayBufferToBase64(await source.file.arrayBuffer()),
  updatedAt: Number.isFinite(source.file.lastModified) ? new Date(source.file.lastModified).toISOString() : undefined,
});

export const getDirectoryUploadSources = async (directoryHandle: BrowserDirectoryHandle): Promise<BrowserUploadSource[]> => {
  const sources: BrowserUploadSource[] = [{
    type: "directory",
    relativePath: directoryHandle.name,
  }];

  await appendDirectoryUploadSources(directoryHandle, directoryHandle.name, sources);

  return sources;
};

const appendDirectoryUploadSources = async (
  directoryHandle: BrowserDirectoryHandle,
  relativePath: string,
  sources: BrowserUploadSource[],
): Promise<void> => {
  for await (const childHandle of directoryHandle.values()) {
    const childPath = `${relativePath}/${childHandle.name}`;

    if (childHandle.kind === "directory") {
      sources.push({
        type: "directory",
        relativePath: childPath,
      });
      await appendDirectoryUploadSources(childHandle as BrowserDirectoryHandle, childPath, sources);
      continue;
    }

    const file = await (childHandle as BrowserFileHandle).getFile();
    sources.push({
      type: "file",
      relativePath: childPath,
      file,
    });
  }
};

export const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "AbortError";

export const getBrowserRelativePath = (file: File): string => {
  const relativePath = (file as File & { readonly webkitRelativePath?: string }).webkitRelativePath?.trim();

  return relativePath && relativePath.length > 0 ? relativePath : file.name;
};

export const getUploadSelectionPaths = (
  directoryPath: string,
  files: readonly FilesystemUploadFile[],
): string[] => {
  const selectedTopLevelPaths = new Set<string>();

  files.forEach((file) => {
    const topLevelName = file.relativePath.split("/")[0];

    if (topLevelName !== undefined && topLevelName.length > 0) {
      selectedTopLevelPaths.add(joinClientPath(directoryPath, topLevelName));
    }
  });

  return [...selectedTopLevelPaths];
};

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return window.btoa(binary);
};
