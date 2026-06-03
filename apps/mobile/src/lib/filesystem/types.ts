export type FilesystemEntryType = 'file' | 'directory';

export type FilesystemEntry = {
  readonly name: string;
  readonly path: string;
  readonly type: FilesystemEntryType;
  readonly size: number | null;
  readonly updatedAt: string;
  readonly isHidden: boolean;
  readonly isSymlink: boolean;
};

export type FilesystemListing = {
  readonly path: string;
  readonly name: string;
  readonly parent: string | null;
  readonly isRoot: boolean;
  readonly entries: readonly FilesystemEntry[];
};

export type FilesystemViewState = {
  readonly currentPath: string | null;
  readonly openFiles: readonly FilesystemEntry[];
};

export type FilesystemUploadFile = {
  readonly relativePath: string;
  readonly type?: 'file' | 'directory';
  readonly contentBase64?: string;
  readonly updatedAt?: string;
};

export type FilesystemUploadItem =
  | {
      readonly type: 'directory';
      readonly relativePath: string;
      readonly updatedAt?: string;
    }
  | {
      readonly type: 'file';
      readonly relativePath: string;
      readonly size: number;
      readonly updatedAt?: string;
    };

export type FilesystemUploadCreateRequest = {
  readonly path?: string;
  readonly items: readonly FilesystemUploadItem[];
};

export type FilesystemUploadCreateResponse = {
  readonly uploadId: string;
  readonly expiresAt: string;
  readonly files: readonly {
    readonly fileId: string;
    readonly relativePath: string;
    readonly size: number;
  }[];
};

export type FilesystemUploadChunkResponse = {
  readonly fileId: string;
  readonly offset: number;
  readonly bytesReceived: number;
  readonly size: number;
  readonly done: boolean;
};

export type FilesystemUploadCompleteResponse = {
  readonly entries: readonly FilesystemEntry[];
};

export type FilesystemPasteMode = 'copy' | 'move';

export type FilesystemPasteResult = {
  readonly mode: FilesystemPasteMode;
  readonly sourcePaths: readonly string[];
  readonly destinationPath: string;
  readonly entries: readonly FilesystemEntry[];
};

export type FilesystemClientMessage =
  | {
      readonly type: 'subscribe';
      readonly requestId: string;
      readonly path?: string;
      readonly showHidden?: boolean;
    }
  | { readonly type: 'refresh'; readonly requestId: string }
  | {
      readonly type: 'setOpenFiles';
      readonly requestId: string;
      readonly paths: readonly string[];
    }
  | {
      readonly type: 'createFolder';
      readonly requestId: string;
      readonly path?: string;
      readonly name?: string;
    }
  | {
      readonly type: 'upload';
      readonly requestId: string;
      readonly path?: string;
      readonly files: readonly FilesystemUploadFile[];
    }
  | {
      readonly type: 'rename';
      readonly requestId: string;
      readonly path: string;
      readonly newName: string;
    }
  | {
      readonly type: 'trash';
      readonly requestId: string;
      readonly paths: readonly string[];
    }
  | {
      readonly type: 'paste';
      readonly requestId: string;
      readonly mode: FilesystemPasteMode;
      readonly sourcePaths: readonly string[];
      readonly path: string;
    }
  | { readonly type: 'ping'; readonly requestId: string };

export type FilesystemSnapshotReason =
  | 'subscribe'
  | 'refresh'
  | 'watch'
  | 'mutation';

export type FilesystemServerMessage =
  | {
      readonly type: 'hello';
      readonly root: { readonly name: string; readonly path: '' };
      readonly serverTime: string;
      readonly viewState?: FilesystemViewState;
    }
  | {
      readonly type: 'snapshot';
      readonly requestId?: string;
      readonly reason: FilesystemSnapshotReason;
      readonly listing: FilesystemListing;
    }
  | {
      readonly type: 'ack';
      readonly requestId: string;
      readonly action:
        | 'setOpenFiles'
        | 'createFolder'
        | 'upload'
        | 'rename'
        | 'trash'
        | 'paste';
      readonly result?: unknown;
    }
  | {
      readonly type: 'error';
      readonly requestId?: string;
      readonly code: string;
      readonly message: string;
    }
  | {
      readonly type: 'pong';
      readonly requestId: string;
      readonly serverTime: string;
    };

export type FilesystemConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'closed';
