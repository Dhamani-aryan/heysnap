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
  readonly contentBase64: string;
  readonly updatedAt?: string;
}

export type FilesystemClientMessage =
  | { readonly type: "subscribe"; readonly requestId: string; readonly path?: string; readonly showHidden?: boolean }
  | { readonly type: "refresh"; readonly requestId: string }
  | { readonly type: "createFolder"; readonly requestId: string; readonly path?: string; readonly name?: string }
  | { readonly type: "upload"; readonly requestId: string; readonly path?: string; readonly files: FilesystemUploadFile[] }
  | { readonly type: "rename"; readonly requestId: string; readonly path: string; readonly newName: string }
  | { readonly type: "trash"; readonly requestId: string; readonly paths: string[] }
  | { readonly type: "ping"; readonly requestId: string };

export type FilesystemServerMessage =
  | { readonly type: "hello"; readonly root: { readonly name: string; readonly path: "" }; readonly serverTime: string }
  | { readonly type: "snapshot"; readonly requestId?: string; readonly reason: "subscribe" | "refresh" | "watch" | "mutation"; readonly listing: FilesystemListing }
  | { readonly type: "ack"; readonly requestId: string; readonly action: "createFolder" | "upload" | "rename" | "trash"; readonly result?: unknown }
  | { readonly type: "error"; readonly requestId?: string; readonly code: string; readonly message: string }
  | { readonly type: "pong"; readonly requestId: string; readonly serverTime: string };
