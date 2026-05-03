import type { FilesystemClientMessage, FilesystemListing, FilesystemServerMessage } from "./types";

type PendingRequest = {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
};

export interface FilesystemClientOptions {
  readonly onListing: (listing: FilesystemListing) => void;
  readonly onLoading: (loading: boolean) => void;
  readonly onError: (message: string | null) => void;
  readonly onOpen?: () => void;
  readonly onClose?: () => void;
}

export class FilesystemClient {
  private socket: WebSocket | null = null;
  private requestCounter = 0;
  private readonly pending = new Map<string, PendingRequest>();

  constructor(
    private readonly url: string,
    private readonly options: FilesystemClientOptions,
  ) {}

  connect(): void {
    this.close();
    this.options.onLoading(true);
    this.options.onError(null);

    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.options.onOpen?.();
    });
    socket.addEventListener("message", (event) => {
      this.handleMessage(event.data);
    });
    socket.addEventListener("error", () => {
      this.options.onError("Filesystem connection failed.");
      this.options.onLoading(false);
    });
    socket.addEventListener("close", () => {
      this.rejectAll("Filesystem connection closed.");
      this.options.onClose?.();
    });
  }

  close(): void {
    if (this.socket !== null) {
      const socket = this.socket;
      this.socket = null;
      socket.close();
    }

    this.rejectAll("Filesystem connection closed.");
  }

  subscribe(path?: string): Promise<void> {
    return this.request({ type: "subscribe", requestId: this.nextRequestId(), path }).then(() => undefined);
  }

  createFolder(path?: string): Promise<unknown> {
    return this.request({ type: "createFolder", requestId: this.nextRequestId(), path });
  }

  rename(path: string, newName: string): Promise<unknown> {
    return this.request({ type: "rename", requestId: this.nextRequestId(), path, newName });
  }

  trash(paths: string[]): Promise<unknown> {
    return this.request({ type: "trash", requestId: this.nextRequestId(), paths });
  }

  private request(message: FilesystemClientMessage): Promise<unknown> {
    const socket = this.socket;

    if (socket === null || socket.readyState !== WebSocket.OPEN) {
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
        this.resolvePending(message.requestId, message);
        return;
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
