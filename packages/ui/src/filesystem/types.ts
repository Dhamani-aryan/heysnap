export type FilesystemEntryType = "file" | "directory";

export interface FilesystemEntry {
  readonly name: string;
  readonly path: string;
  readonly type: FilesystemEntryType;
  readonly size: number | null;
  readonly updatedAt: string;
  readonly isHidden: boolean;
  readonly isSymlink: boolean;
}

export interface FilesystemListing {
  readonly path: string;
  readonly name: string;
  readonly parent: string | null;
  readonly isRoot: boolean;
  readonly entries: FilesystemEntry[];
}

export interface FilesystemUploadFile {
  readonly relativePath: string;
  readonly type?: "file" | "directory";
  readonly contentBase64?: string;
  readonly updatedAt?: string;
}

export type FilesystemUploadItem =
  | {
      readonly type: "directory";
      readonly relativePath: string;
      readonly updatedAt?: string;
    }
  | {
      readonly type: "file";
      readonly relativePath: string;
      readonly size: number;
      readonly updatedAt?: string;
    };

export interface FilesystemUploadCreateRequest {
  readonly path?: string;
  readonly items: FilesystemUploadItem[];
}

export interface FilesystemUploadCreateResponse {
  readonly uploadId: string;
  readonly expiresAt: string;
  readonly files: Array<{
    readonly fileId: string;
    readonly relativePath: string;
    readonly size: number;
  }>;
}

export interface FilesystemUploadChunkResponse {
  readonly fileId: string;
  readonly offset: number;
  readonly bytesReceived: number;
  readonly size: number;
  readonly done: boolean;
}

export interface FilesystemUploadCompleteResponse {
  readonly entries: FilesystemEntry[];
}

export interface FilesystemViewState {
  readonly currentPath: string | null;
  readonly openFiles: FilesystemEntry[];
}

export type FilesystemClientMessage =
  | { readonly type: "subscribe"; readonly requestId: string; readonly path?: string; readonly showHidden?: boolean }
  | { readonly type: "refresh"; readonly requestId: string }
  | { readonly type: "setOpenFiles"; readonly requestId: string; readonly paths: string[] }
  | { readonly type: "createFolder"; readonly requestId: string; readonly path?: string; readonly name?: string }
  | { readonly type: "upload"; readonly requestId: string; readonly path?: string; readonly files: FilesystemUploadFile[] }
  | { readonly type: "rename"; readonly requestId: string; readonly path: string; readonly newName: string }
  | { readonly type: "trash"; readonly requestId: string; readonly paths: string[] }
  | { readonly type: "ping"; readonly requestId: string };

export type FilesystemServerMessage =
  | { readonly type: "hello"; readonly root: { readonly name: string; readonly path: "" }; readonly serverTime: string; readonly viewState?: FilesystemViewState }
  | { readonly type: "snapshot"; readonly requestId?: string; readonly reason: "subscribe" | "refresh" | "watch" | "mutation"; readonly listing: FilesystemListing }
  | { readonly type: "ack"; readonly requestId: string; readonly action: "setOpenFiles" | "createFolder" | "upload" | "rename" | "trash"; readonly result?: unknown }
  | { readonly type: "error"; readonly requestId?: string; readonly code: string; readonly message: string }
  | { readonly type: "pong"; readonly requestId: string; readonly serverTime: string };
