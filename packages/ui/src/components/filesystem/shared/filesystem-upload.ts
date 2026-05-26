import type { InputHTMLAttributes } from "react";

import type {
  FilesystemUploadChunkResponse,
  FilesystemUploadCompleteResponse,
  FilesystemUploadCreateResponse,
  FilesystemUploadFile,
  FilesystemUploadItem,
} from "../../../filesystem/types";
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

export const FILESYSTEM_UPLOAD_CHUNK_SIZE_BYTES = 4 * 1024 * 1024;

export interface FilesystemBrowserUploadProgress {
  readonly completedBytes: number;
  readonly detail: string;
  readonly phase: "preparing" | "uploading";
  readonly totalBytes: number;
}

export interface UploadBrowserSourcesToFilesystemOptions {
  readonly uploadUrl: string;
  readonly directoryPath: string;
  readonly sources: readonly BrowserUploadSource[];
  readonly onProgress?: (progress: FilesystemBrowserUploadProgress) => void;
}

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

export const toFilesystemUploadItem = (source: BrowserUploadSource): FilesystemUploadItem =>
  source.type === "directory"
    ? {
        type: "directory",
        relativePath: source.relativePath,
      }
    : {
        type: "file",
        relativePath: source.relativePath,
        size: source.file.size,
        updatedAt: Number.isFinite(source.file.lastModified) ? new Date(source.file.lastModified).toISOString() : undefined,
      };

export const uploadBrowserSourcesToFilesystem = async ({
  uploadUrl,
  directoryPath,
  sources,
  onProgress,
}: UploadBrowserSourcesToFilesystemOptions): Promise<FilesystemUploadCompleteResponse> => {
  const totalBytes = sources.reduce((sum, source) => sum + (source.type === "file" ? source.file.size : 0), 0);
  const items = sources.map(toFilesystemUploadItem);
  let uploadId: string | null = null;

  onProgress?.({
    detail: "Preparing upload...",
    completedBytes: 0,
    totalBytes,
    phase: "preparing",
  });

  try {
    const createResponse = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        path: directoryPath,
        items,
      }),
    });
    const createBody = await readJsonResponse<FilesystemUploadCreateResponse>(createResponse);
    uploadId = createBody.uploadId;
    const filesByRelativePath = new Map(createBody.files.map((file) => [file.relativePath, file]));
    let completedBytes = 0;

    for (const source of sources) {
      if (source.type === "directory") {
        continue;
      }

      const uploadFile = filesByRelativePath.get(source.relativePath);
      if (uploadFile === undefined) {
        throw new Error(`Upload session did not include ${source.relativePath}.`);
      }

      for (let offset = 0; offset < source.file.size; offset += FILESYSTEM_UPLOAD_CHUNK_SIZE_BYTES) {
        const chunk = source.file.slice(offset, Math.min(offset + FILESYSTEM_UPLOAD_CHUNK_SIZE_BYTES, source.file.size));

        onProgress?.({
          detail: source.file.name,
          completedBytes,
          totalBytes,
          phase: "uploading",
        });

        const chunkUrl = buildUploadChunkUrl(uploadUrl, uploadId, uploadFile.fileId, offset);
        const chunkResponse = await fetch(chunkUrl, {
          method: "PATCH",
          headers: {
            "content-type": "application/octet-stream",
          },
          body: chunk,
        });
        await readJsonResponse<FilesystemUploadChunkResponse>(chunkResponse);
        completedBytes += chunk.size;

        onProgress?.({
          detail: source.file.name,
          completedBytes,
          totalBytes,
          phase: "uploading",
        });
      }
    }

    const completeResponse = await fetch(buildUploadSessionUrl(uploadUrl, uploadId), {
      method: "POST",
    });
    return await readJsonResponse<FilesystemUploadCompleteResponse>(completeResponse);
  } catch (error) {
    if (uploadId !== null) {
      await fetch(buildUploadSessionUrl(uploadUrl, uploadId), { method: "DELETE" }).catch(() => undefined);
    }

    throw error;
  }
};

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
  files: readonly { readonly relativePath: string }[],
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

const buildUploadSessionUrl = (uploadUrl: string, uploadId: string): string => {
  const url = new URL(uploadUrl);
  url.pathname = `${url.pathname.replace(/\/+$/u, "")}/${encodeURIComponent(uploadId)}`;
  return url.toString();
};

const buildUploadChunkUrl = (
  uploadUrl: string,
  uploadId: string,
  fileId: string,
  offset: number,
): string => {
  const url = new URL(buildUploadSessionUrl(uploadUrl, uploadId));
  url.pathname = `${url.pathname.replace(/\/+$/u, "")}/files/${encodeURIComponent(fileId)}`;
  url.searchParams.set("offset", String(offset));
  return url.toString();
};

const readJsonResponse = async <TBody>(response: Response): Promise<TBody> => {
  let body: unknown;

  try {
    body = await response.json() as unknown;
  } catch {
    body = null;
  }

  if (!response.ok) {
    const error = typeof body === "object" && body !== null && !Array.isArray(body)
      ? body as Record<string, unknown>
      : null;
    const nestedError = typeof error?.["error"] === "object" && error["error"] !== null && !Array.isArray(error["error"])
      ? error["error"] as Record<string, unknown>
      : null;
    const message = typeof error?.["message"] === "string"
      ? error["message"]
      : typeof nestedError?.["message"] === "string"
        ? nestedError["message"]
      : `Upload request failed with ${String(response.status)}.`;
    throw new Error(message);
  }

  return body as TBody;
};
