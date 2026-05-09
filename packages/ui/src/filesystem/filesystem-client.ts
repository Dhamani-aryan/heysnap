import type {
  FilesystemEntry,
  FilesystemClientMessage,
  FilesystemListing,
  FilesystemServerMessage,
  FilesystemUploadFile,
} from "./types";

export type FilesystemConnectionStatus = "connecting" | "alive" | "closed";

type PendingRequest = {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
};

type OpenWaiter = {
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

export interface FilesystemClientOptions {
  readonly initialPath?: string;
  readonly onListing: (listing: FilesystemListing) => void;
  readonly onLoading: (loading: boolean) => void;
  readonly onError: (message: string | null) => void;
  readonly onFileUpdates?: (updates: { readonly entries: FilesystemEntry[]; readonly missingPaths: string[] }) => void;
  readonly onOpen?: () => void;
  readonly onClose?: () => void;
  readonly onConnectionStatus?: (status: FilesystemConnectionStatus) => void;
}

const HEARTBEAT_INTERVAL_MS = 15_000;
const HEARTBEAT_TIMEOUT_MS = 45_000;
const RECONNECT_DELAY_MS = 1_000;
const OPEN_WAIT_TIMEOUT_MS = 5_000;

export class FilesystemClient {
  private socket: WebSocket | null = null;
  private requestCounter = 0;
  private readonly pending = new Map<string, PendingRequest>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingHeartbeatRequestId: string | null = null;
  private pendingHeartbeatStartedAt = 0;
  private subscribedPath: string | undefined;
  private watchedFilePaths: string[] = [];
  private readonly openWaiters: OpenWaiter[] = [];
  private shouldReconnect = false;

  constructor(
    private readonly url: string,
    private readonly options: FilesystemClientOptions,
  ) {
    this.subscribedPath = options.initialPath;
  }

  connect(): void {
    this.disconnect();
    this.shouldReconnect = true;
    this.options.onLoading(true);
    this.options.onError(null);
    this.openSocket();
  }

  private openSocket(): void {
    this.options.onConnectionStatus?.("connecting");
    const socket = new WebSocket(this.getSocketUrl());
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.options.onOpen?.();
      this.resolveOpenWaiters();
      this.startHeartbeat(socket);
      this.resendWatchedFiles();
    });
    socket.addEventListener("message", (event) => {
      this.handleMessage(event.data);
    });
    socket.addEventListener("error", () => {
      this.options.onError("Filesystem connection failed.");
      this.options.onLoading(false);
    });
    socket.addEventListener("close", () => {
      if (this.socket !== socket) {
        return;
      }

      this.socket = null;
      this.stopHeartbeat();
      this.rejectAll("Filesystem connection closed.");
      this.options.onClose?.();
      this.options.onConnectionStatus?.("closed");
      this.scheduleReconnect();
    });
  }

  close(): void {
    this.shouldReconnect = false;
    this.disconnect();
  }

  private disconnect(): void {
    this.clearReconnectTimer();
    this.stopHeartbeat();

    if (this.socket !== null) {
      const socket = this.socket;
      this.socket = null;
      socket.close();
    }

    this.rejectAll("Filesystem connection closed.");
    this.rejectOpenWaiters("Filesystem connection closed.");
    this.options.onConnectionStatus?.("closed");
  }

  subscribe(path?: string): Promise<void> {
    this.subscribedPath = path ?? "";
    return this.request({ type: "subscribe", requestId: this.nextRequestId(), path }).then(() => undefined);
  }

  createFolder(path?: string): Promise<unknown> {
    return this.request({ type: "createFolder", requestId: this.nextRequestId(), path });
  }

  upload(path: string | undefined, files: FilesystemUploadFile[]): Promise<unknown> {
    return this.request({ type: "upload", requestId: this.nextRequestId(), path, files });
  }

  rename(path: string, newName: string): Promise<unknown> {
    return this.request({ type: "rename", requestId: this.nextRequestId(), path, newName });
  }

  trash(paths: string[]): Promise<unknown> {
    return this.request({ type: "trash", requestId: this.nextRequestId(), paths });
  }

  watchFiles(paths: readonly string[]): Promise<void> {
    this.watchedFilePaths = [...new Set(paths)].sort((left, right) => left.localeCompare(right));
    return this.request({
      type: "watchFiles",
      requestId: this.nextRequestId(),
      paths: this.watchedFilePaths,
    }).then(() => undefined);
  }

  private request(message: FilesystemClientMessage): Promise<unknown> {
    const socket = this.socket;

    if (socket === null || socket.readyState !== WebSocket.OPEN) {
      if (this.shouldReconnect) {
        this.scheduleReconnect();
        return this.waitForOpen().then(() => this.request(message));
      }

      return Promise.reject(new Error("Filesystem connection is not open."));
    }

    return new Promise((resolve, reject) => {
      this.pending.set(message.requestId, { resolve, reject });
      socket.send(JSON.stringify(message));
    });
  }

  private handleMessage(rawData: unknown): void {
    const parse = async (): Promise<FilesystemServerMessage> => {
      if (typeof rawData === "string") {
        return JSON.parse(rawData) as FilesystemServerMessage;
      }

      if (rawData instanceof Blob) {
        return JSON.parse(await rawData.text()) as FilesystemServerMessage;
      }

      return JSON.parse(String(rawData)) as FilesystemServerMessage;
    };

    void parse()
      .then((message) => {
        this.handleServerMessage(message);
      })
      .catch(() => {
        this.options.onError("Received an invalid filesystem message.");
      });
  }

  private handleServerMessage(message: FilesystemServerMessage): void {
    switch (message.type) {
      case "hello":
        return;
      case "snapshot":
        this.options.onLoading(false);
        this.options.onError(null);
        this.options.onListing(message.listing);
        if (message.requestId !== undefined) {
          this.resolvePending(message.requestId, message.listing);
        }
        return;
      case "fileUpdates":
        this.options.onFileUpdates?.({
          entries: message.entries,
          missingPaths: message.missingPaths,
        });
        return;
      case "ack":
        this.resolvePending(message.requestId, message.result);
        return;
      case "error":
        this.options.onLoading(false);
        this.options.onError(message.message);
        if (message.requestId !== undefined) {
          this.rejectPending(message.requestId, message.message);
        }
        return;
      case "pong":
        if (message.requestId === this.pendingHeartbeatRequestId) {
          this.pendingHeartbeatRequestId = null;
          this.pendingHeartbeatStartedAt = 0;
          this.options.onConnectionStatus?.("alive");
        }

        this.resolvePending(message.requestId, message);
        return;
    }
  }

  private startHeartbeat(socket: WebSocket): void {
    this.stopHeartbeat();
    this.sendHeartbeat(socket);
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat(socket);
    }, HEARTBEAT_INTERVAL_MS);
  }

  private sendHeartbeat(socket: WebSocket): void {
    if (socket !== this.socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    if (
      this.pendingHeartbeatRequestId !== null &&
      Date.now() - this.pendingHeartbeatStartedAt > HEARTBEAT_TIMEOUT_MS
    ) {
      socket.close();
      return;
    }

    if (this.pendingHeartbeatRequestId !== null) {
      return;
    }

    const requestId = this.nextRequestId();
    this.pendingHeartbeatRequestId = requestId;
    this.pendingHeartbeatStartedAt = Date.now();
    socket.send(JSON.stringify({ type: "ping", requestId }));
  }

  private resendWatchedFiles(): void {
    if (this.watchedFilePaths.length === 0) {
      return;
    }

    void this.watchFiles(this.watchedFilePaths).catch((error) => {
      if (this.shouldReconnect) {
        this.options.onError(error instanceof Error ? error.message : "Failed to watch open files.");
      }
    });
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.pendingHeartbeatRequestId !== null) {
      this.pending.delete(this.pendingHeartbeatRequestId);
      this.pendingHeartbeatRequestId = null;
    }

    this.pendingHeartbeatStartedAt = 0;
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectTimer !== null) {
      return;
    }

    if (this.socket?.readyState === WebSocket.CONNECTING || this.socket?.readyState === WebSocket.OPEN) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, RECONNECT_DELAY_MS);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private getSocketUrl(): string {
    if (this.subscribedPath === undefined) {
      return this.url;
    }

    const baseUrl = typeof window === "undefined" ? "http://localhost" : window.location.href;
    const socketUrl = new URL(this.url, baseUrl);

    if (socketUrl.protocol === "http:") {
      socketUrl.protocol = "ws:";
    } else if (socketUrl.protocol === "https:") {
      socketUrl.protocol = "wss:";
    }

    socketUrl.searchParams.set("path", this.subscribedPath);

    return socketUrl.toString();
  }

  private waitForOpen(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const waiter: OpenWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const waiterIndex = this.openWaiters.indexOf(waiter);

          if (waiterIndex >= 0) {
            this.openWaiters.splice(waiterIndex, 1);
          }

          reject(new Error("Filesystem connection is not open."));
        }, OPEN_WAIT_TIMEOUT_MS),
      };

      this.openWaiters.push(waiter);
    });
  }

  private resolveOpenWaiters(): void {
    const waiters = this.openWaiters.splice(0);

    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
  }

  private rejectOpenWaiters(message: string): void {
    const waiters = this.openWaiters.splice(0);

    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(message));
    }
  }

  private nextRequestId(): string {
    this.requestCounter += 1;
    return `fs-${String(this.requestCounter)}`;
  }

  private resolvePending(requestId: string, value: unknown): void {
    const pending = this.pending.get(requestId);

    if (pending === undefined) {
      return;
    }

    this.pending.delete(requestId);
    pending.resolve(value);
  }

  private rejectPending(requestId: string, message: string): void {
    const pending = this.pending.get(requestId);

    if (pending === undefined) {
      return;
    }

    this.pending.delete(requestId);
    pending.reject(new Error(message));
  }

  private rejectAll(message: string): void {
    for (const [requestId, pending] of this.pending) {
      pending.reject(new Error(message));
      this.pending.delete(requestId);
    }
  }
}
