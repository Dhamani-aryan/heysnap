import { readFile } from "node:fs/promises";

import { WebSocket, type RawData } from "ws";

export interface MachineTunnelClientOptions {
  readonly cloudServerPublicUrl: string;
  readonly computerId: string;
  readonly tokenFile: string;
  readonly localPort: number;
  readonly reconnectMs?: number;
}

export const startMachineTunnelClient = (options: MachineTunnelClientOptions): void => {
  const client = new MachineTunnelClient(options);
  client.start();
};

class MachineTunnelClient {
  private cloudWebSocket: WebSocket | null = null;
  private readonly localConnections = new Map<string, LocalTunnelConnection>();
  private stopped = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: MachineTunnelClientOptions) {}

  start(): void {
    this.connectSoon(0);
  }

  private connectSoon(delayMs: number): void {
    if (this.stopped || this.reconnectTimer !== null) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delayMs);
  }

  private async connect(): Promise<void> {
    if (this.stopped) {
      return;
    }

    const token = await this.readToken();

    if (token === null) {
      this.connectSoon(this.options.reconnectMs ?? 5000);
      return;
    }

    const webSocket = new WebSocket(buildTunnelUrl(this.options.cloudServerPublicUrl), {
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    this.cloudWebSocket = webSocket;

    webSocket.on("open", () => {
      console.log(`machine tunnel connected for ${this.options.computerId}`);
    });
    webSocket.on("message", (data) => {
      this.handleCloudMessage(data);
    });
    webSocket.on("close", () => {
      this.closeLocalConnections(1011, "Cloud tunnel closed");
      this.cloudWebSocket = null;
      this.connectSoon(this.options.reconnectMs ?? 5000);
    });
    webSocket.on("error", (error) => {
      console.error("machine tunnel error", error);
      webSocket.close();
    });
  }

  private async readToken(): Promise<string | null> {
    try {
      const token = (await readFile(this.options.tokenFile, "utf8")).trim();
      return token.length > 0 ? token : null;
    } catch {
      return null;
    }
  }

  private handleCloudMessage(data: RawData): void {
    const message = parseCloudMessage(data);

    if (message === null) {
      this.cloudWebSocket?.close(1003, "Invalid tunnel message");
      return;
    }

    switch (message.type) {
      case "open":
        this.openLocalConnection(message.connectionId, message.path);
        break;
      case "httpRequest":
        void this.handleHttpRequest(message.connectionId, message.path);
        break;
      case "data": {
        const localConnection = this.localConnections.get(message.connectionId);

        if (localConnection === undefined) {
          break;
        }

        if (localConnection.opened && localConnection.webSocket.readyState === WebSocket.OPEN) {
          localConnection.webSocket.send(tunnelPayloadToRawData(message));
        } else {
          localConnection.pendingData.push(message);
        }
        break;
      }
      case "close":
        this.localConnections.get(message.connectionId)?.webSocket.close(
          normalizeWebSocketCloseCode(message.code),
          message.reason,
        );
        this.localConnections.delete(message.connectionId);
        break;
    }
  }

  private async handleHttpRequest(connectionId: string, path: string): Promise<void> {
    try {
      const response = await fetch(`http://127.0.0.1:${String(this.options.localPort)}${path}`);
      const body = Buffer.from(await response.arrayBuffer());
      this.sendToCloud({
        type: "httpResponse",
        connectionId,
        statusCode: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        bodyBase64: body.toString("base64"),
      });
    } catch (error) {
      const body = Buffer.from(error instanceof Error ? error.message : "Failed to proxy HTTP request", "utf8");
      this.sendToCloud({
        type: "httpResponse",
        connectionId,
        statusCode: 502,
        headers: {
          "content-type": "text/plain; charset=utf-8",
        },
        bodyBase64: body.toString("base64"),
      });
    }
  }

  private openLocalConnection(connectionId: string, path: string): void {
    const localWebSocket = new WebSocket(`ws://127.0.0.1:${String(this.options.localPort)}${path}`);
    const localConnection: LocalTunnelConnection = {
      webSocket: localWebSocket,
      opened: false,
      pendingData: [],
    };

    this.localConnections.set(connectionId, localConnection);
    localWebSocket.on("open", () => {
      localConnection.opened = true;
      this.sendToCloud({ type: "openResult", connectionId, ok: true });

      for (const message of localConnection.pendingData.splice(0)) {
        localWebSocket.send(tunnelPayloadToRawData(message));
      }
    });
    localWebSocket.on("message", (data, isBinary) => {
      this.sendToCloud({
        type: "data",
        connectionId,
        ...rawDataToTunnelPayload(data, isBinary),
      });
    });
    localWebSocket.on("close", (code, reason) => {
      this.localConnections.delete(connectionId);
      this.sendToCloud({
        type: "close",
        connectionId,
        code: normalizeWebSocketCloseCode(code),
        reason: reason.toString("utf8"),
      });
    });
    localWebSocket.on("error", (error) => {
      this.localConnections.delete(connectionId);

      if (!localConnection.opened) {
        this.sendToCloud({
          type: "openResult",
          connectionId,
          ok: false,
          error: error instanceof Error ? error.message : "Failed to open local route",
        });
      }
    });
  }

  private sendToCloud(message: MachineTunnelMessage): void {
    if (this.cloudWebSocket?.readyState === WebSocket.OPEN) {
      this.cloudWebSocket.send(JSON.stringify(message));
    }
  }

  private closeLocalConnections(code: number, reason: string): void {
    for (const localConnection of this.localConnections.values()) {
      localConnection.webSocket.close(code, reason);
    }

    this.localConnections.clear();
  }
}

interface LocalTunnelConnection {
  readonly webSocket: WebSocket;
  opened: boolean;
  readonly pendingData: Extract<CloudTunnelMessage, { readonly type: "data" }>[];
}

type CloudTunnelMessage =
  | { readonly type: "open"; readonly connectionId: string; readonly path: string }
  | { readonly type: "httpRequest"; readonly connectionId: string; readonly path: string }
  | { readonly type: "data"; readonly connectionId: string; readonly data: string; readonly dataType?: TunnelPayloadType }
  | { readonly type: "close"; readonly connectionId: string; readonly code?: number; readonly reason?: string };

type MachineTunnelMessage =
  | { readonly type: "openResult"; readonly connectionId: string; readonly ok: true }
  | { readonly type: "openResult"; readonly connectionId: string; readonly ok: false; readonly error: string }
  | {
      readonly type: "httpResponse";
      readonly connectionId: string;
      readonly statusCode: number;
      readonly headers: Record<string, string>;
      readonly bodyBase64: string;
    }
  | { readonly type: "data"; readonly connectionId: string; readonly data: string; readonly dataType: TunnelPayloadType }
  | { readonly type: "close"; readonly connectionId: string; readonly code?: number; readonly reason?: string };

type TunnelPayloadType = "text" | "binary";

const buildTunnelUrl = (cloudServerPublicUrl: string): string => {
  const url = new URL("/machines/tunnel", cloudServerPublicUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
};

const parseCloudMessage = (data: RawData): CloudTunnelMessage | null => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawDataToText(data)) as unknown;
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const message = parsed as Record<string, unknown>;

  if (typeof message["connectionId"] !== "string" || typeof message["type"] !== "string") {
    return null;
  }

  switch (message["type"]) {
    case "open":
      return typeof message["path"] === "string"
        ? { type: "open", connectionId: message["connectionId"], path: message["path"] }
        : null;
    case "httpRequest":
      return typeof message["path"] === "string"
        ? { type: "httpRequest", connectionId: message["connectionId"], path: message["path"] }
        : null;
    case "data":
      return typeof message["data"] === "string"
        ? {
            type: "data",
            connectionId: message["connectionId"],
            data: message["data"],
            dataType: parseTunnelPayloadType(message["dataType"]),
          }
        : null;
    case "close":
      return {
        type: "close",
        connectionId: message["connectionId"],
        code: typeof message["code"] === "number" ? message["code"] : undefined,
        reason: typeof message["reason"] === "string" ? message["reason"] : undefined,
      };
    default:
      return null;
  }
};

const rawDataToText = (data: RawData): string => {
  if (typeof data === "string") {
    return data;
  }

  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }

  return Buffer.concat(data).toString("utf8");
};

const rawDataToBase64 = (data: RawData): string => {
  if (typeof data === "string") {
    return Buffer.from(data, "utf8").toString("base64");
  }

  if (Buffer.isBuffer(data)) {
    return data.toString("base64");
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("base64");
  }

  return Buffer.concat(data).toString("base64");
};

const rawDataToTunnelPayload = (
  data: RawData,
  isBinary: boolean,
): { readonly data: string; readonly dataType: TunnelPayloadType } => ({
  data: rawDataToBase64(data),
  dataType: isBinary ? "binary" : "text",
});

const tunnelPayloadToRawData = (
  message: { readonly data: string; readonly dataType?: TunnelPayloadType },
): string | Buffer => {
  const buffer = Buffer.from(message.data, "base64");
  return message.dataType === "text" ? buffer.toString("utf8") : buffer;
};

const parseTunnelPayloadType = (value: unknown): TunnelPayloadType | undefined =>
  value === "text" || value === "binary" ? value : undefined;

export const normalizeWebSocketCloseCode = (code: number | undefined): number => {
  if (code === undefined) {
    return 1000;
  }

  if (code === 1000 || (code >= 3000 && code <= 4999)) {
    return code;
  }

  if (code >= 1001 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006) {
    return code;
  }

  return 1000;
};
