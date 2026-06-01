import { Buffer } from "node:buffer";

export const TUNNEL_PROTOCOL_VERSION = 1;
export const TUNNEL_BINARY_HEADER_BYTES = 20;
export const TUNNEL_BINARY_TEXT_FLAG = 1;

export const TUNNEL_BINARY_FRAME_TYPES = {
  wsData: 1,
  httpRequestBody: 2,
  httpResponseBody: 3,
} as const;

const BINARY_FRAME_TYPE_BY_CODE = new Map<number, TunnelBinaryFrameType>([
  [TUNNEL_BINARY_FRAME_TYPES.wsData, "wsData"],
  [TUNNEL_BINARY_FRAME_TYPES.httpRequestBody, "httpRequestBody"],
  [TUNNEL_BINARY_FRAME_TYPES.httpResponseBody, "httpResponseBody"],
]);

const BINARY_FRAME_CODE_BY_TYPE = new Map<TunnelBinaryFrameType, number>([
  ["wsData", TUNNEL_BINARY_FRAME_TYPES.wsData],
  ["httpRequestBody", TUNNEL_BINARY_FRAME_TYPES.httpRequestBody],
  ["httpResponseBody", TUNNEL_BINARY_FRAME_TYPES.httpResponseBody],
]);

export type TunnelBinaryFrameType = keyof typeof TUNNEL_BINARY_FRAME_TYPES;
export type TunnelRoute = "filesystem" | "browser-control" | "preview";
export type TunnelTrafficClass =
  | "browser-control:ws"
  | "filesystem:ws"
  | "preview:http"
  | "preview:ws"
  | "agent:http"
  | "capabilities:http"
  | "filesystem:download"
  | "filesystem:upload"
  | "generic:http";

export interface TunnelRouteMetadata {
  readonly userId?: string;
  readonly accessSessionId?: string;
  readonly computerId?: string;
}

export type TunnelControlMessage =
  | {
      readonly type: "open";
      readonly connectionId: string;
      readonly route: TunnelRoute;
      readonly path: string;
      readonly metadata?: TunnelRouteMetadata;
      readonly trafficClass?: TunnelTrafficClass;
    }
  | { readonly type: "openResult"; readonly connectionId: string; readonly ok: true }
  | { readonly type: "openResult"; readonly connectionId: string; readonly ok: false; readonly error?: string }
  | {
      readonly type: "httpRequestStart";
      readonly connectionId: string;
      readonly path: string;
      readonly method?: string;
      readonly headers?: Record<string, string>;
      readonly stream?: boolean;
      readonly trafficClass?: TunnelTrafficClass;
    }
  | { readonly type: "httpRequestEnd"; readonly connectionId: string }
  | {
      readonly type: "httpResponseStart";
      readonly connectionId: string;
      readonly statusCode: number;
      readonly headers: Record<string, string>;
    }
  | { readonly type: "httpResponseEnd"; readonly connectionId: string }
  | { readonly type: "close"; readonly connectionId: string; readonly code?: number; readonly reason?: string };

export interface TunnelBinaryFrame {
  readonly type: TunnelBinaryFrameType;
  readonly connectionId: string;
  readonly payload: Buffer;
  readonly isText: boolean;
}

export interface TunnelQueueProfile {
  readonly trafficClass: TunnelTrafficClass;
  readonly priority: number;
  readonly weight: number;
  readonly maxQueuedBytes: number;
  readonly bulk: boolean;
}

export const TUNNEL_OVERLOAD_CLOSE_CODE = 1013;
export const TUNNEL_OVERLOAD_CLOSE_REASON = "Tunnel overloaded: route queue exceeded";

export const DEFAULT_TUNNEL_QUEUE_LIMITS = {
  highWaterBytes: 8 * 1024 * 1024,
  lowWaterBytes: 2 * 1024 * 1024,
  totalQueuedBytes: 64 * 1024 * 1024,
  drainIntervalMs: 10,
} as const;

const MIB = 1024 * 1024;

export const TUNNEL_QUEUE_PROFILES: Record<TunnelTrafficClass, TunnelQueueProfile> = {
  "browser-control:ws": {
    trafficClass: "browser-control:ws",
    priority: 100,
    weight: 8,
    maxQueuedBytes: 8 * MIB,
    bulk: false,
  },
  "filesystem:ws": {
    trafficClass: "filesystem:ws",
    priority: 80,
    weight: 4,
    maxQueuedBytes: 8 * MIB,
    bulk: false,
  },
  "preview:http": {
    trafficClass: "preview:http",
    priority: 50,
    weight: 2,
    maxQueuedBytes: 16 * MIB,
    bulk: false,
  },
  "preview:ws": {
    trafficClass: "preview:ws",
    priority: 50,
    weight: 2,
    maxQueuedBytes: 16 * MIB,
    bulk: false,
  },
  "agent:http": {
    trafficClass: "agent:http",
    priority: 50,
    weight: 2,
    maxQueuedBytes: 16 * MIB,
    bulk: false,
  },
  "capabilities:http": {
    trafficClass: "capabilities:http",
    priority: 50,
    weight: 2,
    maxQueuedBytes: 16 * MIB,
    bulk: false,
  },
  "filesystem:download": {
    trafficClass: "filesystem:download",
    priority: 10,
    weight: 1,
    maxQueuedBytes: 32 * MIB,
    bulk: true,
  },
  "filesystem:upload": {
    trafficClass: "filesystem:upload",
    priority: 10,
    weight: 1,
    maxQueuedBytes: 32 * MIB,
    bulk: true,
  },
  "generic:http": {
    trafficClass: "generic:http",
    priority: 50,
    weight: 2,
    maxQueuedBytes: 16 * MIB,
    bulk: false,
  },
};

export interface TunnelSendSocket {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: string | Buffer, callback?: (error?: Error) => void): void;
}

export interface TunnelQueuedFrame {
  readonly connectionId: string;
  readonly data: string | Buffer;
  readonly profile: TunnelQueueProfile;
}

export interface TunnelSendSchedulerOptions {
  readonly socket: TunnelSendSocket;
  readonly isOpen: () => boolean;
  readonly highWaterBytes?: number;
  readonly lowWaterBytes?: number;
  readonly totalQueuedBytes?: number;
  readonly drainIntervalMs?: number;
  readonly onConnectionOverflow?: (connectionId: string, profile: TunnelQueueProfile, reason: string) => void;
  readonly onSendError?: (error: Error) => void;
}

interface QueuedFrame extends TunnelQueuedFrame {
  readonly byteLength: number;
  resolve(): void;
  reject(error: Error): void;
}

interface ConnectionQueue {
  readonly connectionId: string;
  profile: TunnelQueueProfile;
  readonly frames: QueuedFrame[];
  queuedBytes: number;
  sentInRound: number;
}

export class TunnelSendScheduler {
  private readonly queues = new Map<string, ConnectionQueue>();
  private readonly highWaterBytes: number;
  private readonly lowWaterBytes: number;
  private readonly totalQueuedLimitBytes: number;
  private readonly drainIntervalMs: number;
  private totalQueuedBytes = 0;
  private drainTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: TunnelSendSchedulerOptions) {
    this.highWaterBytes = options.highWaterBytes ?? DEFAULT_TUNNEL_QUEUE_LIMITS.highWaterBytes;
    this.lowWaterBytes = options.lowWaterBytes ?? DEFAULT_TUNNEL_QUEUE_LIMITS.lowWaterBytes;
    this.totalQueuedLimitBytes = options.totalQueuedBytes ?? DEFAULT_TUNNEL_QUEUE_LIMITS.totalQueuedBytes;
    this.drainIntervalMs = options.drainIntervalMs ?? DEFAULT_TUNNEL_QUEUE_LIMITS.drainIntervalMs;
  }

  get queuedBytes(): number {
    return this.totalQueuedBytes;
  }

  getConnectionQueuedBytes(connectionId: string): number {
    return this.queues.get(connectionId)?.queuedBytes ?? 0;
  }

  enqueue(frame: TunnelQueuedFrame): Promise<void> {
    const byteLength = tunnelFrameByteLength(frame.data);

    if (byteLength > frame.profile.maxQueuedBytes) {
      this.options.onConnectionOverflow?.(frame.connectionId, frame.profile, TUNNEL_OVERLOAD_CLOSE_REASON);
      return Promise.reject(new Error(TUNNEL_OVERLOAD_CLOSE_REASON));
    }

    if (this.totalQueuedBytes === 0 && this.canSendImmediately()) {
      return this.sendNow(frame.data);
    }

    return new Promise((resolve, reject) => {
      const queuedFrame: QueuedFrame = {
        ...frame,
        byteLength,
        resolve,
        reject,
      };
      this.queueFrame(queuedFrame);
      this.enforceLimits();
      this.scheduleDrain();
    });
  }

  drainNow(): void {
    this.clearDrainTimer();

    while (this.totalQueuedBytes > 0 && this.canSendFromQueue()) {
      const queue = this.pickQueue();

      if (queue === undefined) {
        break;
      }

      const frame = queue.frames.shift();
      if (frame === undefined) {
        this.queues.delete(queue.connectionId);
        continue;
      }

      queue.queuedBytes -= frame.byteLength;
      queue.sentInRound += 1;
      this.totalQueuedBytes -= frame.byteLength;

      if (queue.frames.length === 0) {
        this.queues.delete(queue.connectionId);
      }

      this.sendNow(frame.data).then(frame.resolve, frame.reject);
    }

    for (const queue of this.queues.values()) {
      queue.sentInRound = 0;
    }

    if (this.totalQueuedBytes > 0) {
      this.scheduleDrain();
    }
  }

  removeConnection(connectionId: string, error: Error = new Error("Tunnel connection closed")): void {
    const queue = this.queues.get(connectionId);
    if (queue === undefined) {
      return;
    }

    this.dropQueue(queue, error, false);
  }

  close(error: Error = new Error("Tunnel scheduler closed")): void {
    this.clearDrainTimer();
    for (const queue of Array.from(this.queues.values())) {
      this.dropQueue(queue, error, false);
    }
  }

  private queueFrame(frame: QueuedFrame): void {
    const queue = this.queues.get(frame.connectionId) ?? {
      connectionId: frame.connectionId,
      profile: frame.profile,
      frames: [],
      queuedBytes: 0,
      sentInRound: 0,
    };

    queue.profile = frame.profile;
    queue.frames.push(frame);
    queue.queuedBytes += frame.byteLength;
    this.totalQueuedBytes += frame.byteLength;
    this.queues.set(frame.connectionId, queue);
  }

  private enforceLimits(): void {
    for (const queue of Array.from(this.queues.values())) {
      if (queue.queuedBytes > queue.profile.maxQueuedBytes) {
        this.options.onConnectionOverflow?.(queue.connectionId, queue.profile, TUNNEL_OVERLOAD_CLOSE_REASON);
        this.dropQueue(queue, new Error(TUNNEL_OVERLOAD_CLOSE_REASON), true);
      }
    }

    while (this.totalQueuedBytes > this.totalQueuedLimitBytes && this.queues.size > 0) {
      const queue = this.pickLargestQueue(true) ?? this.pickLargestQueue(false);
      if (queue === undefined) {
        break;
      }

      this.options.onConnectionOverflow?.(queue.connectionId, queue.profile, TUNNEL_OVERLOAD_CLOSE_REASON);
      this.dropQueue(queue, new Error(TUNNEL_OVERLOAD_CLOSE_REASON), true);
    }
  }

  private pickQueue(): ConnectionQueue | undefined {
    const queues = Array.from(this.queues.values())
      .filter((queue) => queue.frames.length > 0)
      .sort((left, right) => {
        if (right.profile.priority !== left.profile.priority) {
          return right.profile.priority - left.profile.priority;
        }

        return left.sentInRound - right.sentInRound;
      });

    return queues.find((queue) => queue.sentInRound < queue.profile.weight) ?? queues[0];
  }

  private pickLargestQueue(bulkOnly: boolean): ConnectionQueue | undefined {
    return Array.from(this.queues.values())
      .filter((queue) => !bulkOnly || queue.profile.bulk)
      .sort((left, right) => right.queuedBytes - left.queuedBytes)[0];
  }

  private dropQueue(queue: ConnectionQueue, error: Error, alreadySubtracted: boolean): void {
    this.queues.delete(queue.connectionId);
    if (!alreadySubtracted) {
      this.totalQueuedBytes -= queue.queuedBytes;
    } else {
      this.totalQueuedBytes = Math.max(0, this.totalQueuedBytes - queue.queuedBytes);
    }
    queue.queuedBytes = 0;
    for (const frame of queue.frames.splice(0)) {
      frame.reject(error);
    }
  }

  private canSendImmediately(): boolean {
    return this.options.isOpen() && this.options.socket.bufferedAmount < this.highWaterBytes;
  }

  private canSendFromQueue(): boolean {
    return this.options.isOpen() && this.options.socket.bufferedAmount <= this.lowWaterBytes;
  }

  private sendNow(data: string | Buffer): Promise<void> {
    if (!this.options.isOpen()) {
      return Promise.reject(new Error("Tunnel websocket is not open"));
    }

    return new Promise((resolve, reject) => {
      try {
        this.options.socket.send(data, (error?: Error | null) => {
          if (error != null) {
            this.options.onSendError?.(error);
            reject(error);
            return;
          }

          resolve();
        });
      } catch (error) {
        const sendError = error instanceof Error ? error : new Error(String(error));
        this.options.onSendError?.(sendError);
        reject(sendError);
      }
    });
  }

  private scheduleDrain(): void {
    if (this.drainTimer !== null) {
      return;
    }

    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      this.drainNow();
    }, this.drainIntervalMs);
  }

  private clearDrainTimer(): void {
    if (this.drainTimer !== null) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
  }
}

export const profileForWebSocketRoute = (route: TunnelRoute): TunnelQueueProfile => {
  switch (route) {
    case "browser-control":
      return TUNNEL_QUEUE_PROFILES["browser-control:ws"];
    case "filesystem":
      return TUNNEL_QUEUE_PROFILES["filesystem:ws"];
    case "preview":
      return TUNNEL_QUEUE_PROFILES["preview:ws"];
  }
};

export const profileForTrafficClass = (trafficClass: TunnelTrafficClass | undefined): TunnelQueueProfile =>
  TUNNEL_QUEUE_PROFILES[trafficClass ?? "generic:http"];

export const stringifyTunnelControlMessage = (message: TunnelControlMessage): string =>
  JSON.stringify(message);

export const parseTunnelControlMessage = (data: unknown): TunnelControlMessage | null => {
  const parsed = typeof data === "string" ? parseJson(data) : data;

  if (!isRecord(parsed) || typeof parsed["type"] !== "string" || typeof parsed["connectionId"] !== "string") {
    return null;
  }

  switch (parsed["type"]) {
    case "open":
      return typeof parsed["path"] === "string" && isTunnelRoute(parsed["route"])
        ? {
            type: "open",
            connectionId: parsed["connectionId"],
            route: parsed["route"],
            path: parsed["path"],
            metadata: parseTunnelRouteMetadata(parsed["metadata"]),
            trafficClass: parseTunnelTrafficClass(parsed["trafficClass"]),
          }
        : null;
    case "openResult":
      return parsed["ok"] === true
        ? { type: "openResult", connectionId: parsed["connectionId"], ok: true }
        : {
            type: "openResult",
            connectionId: parsed["connectionId"],
            ok: false,
            error: typeof parsed["error"] === "string" ? parsed["error"] : undefined,
          };
    case "httpRequestStart":
      if (typeof parsed["path"] !== "string") {
        return null;
      }
      return {
        type: "httpRequestStart",
        connectionId: parsed["connectionId"],
        path: parsed["path"],
        method: typeof parsed["method"] === "string" ? parsed["method"] : undefined,
        headers: isStringRecord(parsed["headers"]) ? parsed["headers"] : undefined,
        ...(parsed["stream"] === true ? { stream: true } : {}),
        trafficClass: parseTunnelTrafficClass(parsed["trafficClass"]),
      };
    case "httpRequestEnd":
      return { type: "httpRequestEnd", connectionId: parsed["connectionId"] };
    case "httpResponseStart":
      return isHttpStatus(parsed["statusCode"]) && isStringRecord(parsed["headers"])
        ? {
            type: "httpResponseStart",
            connectionId: parsed["connectionId"],
            statusCode: parsed["statusCode"],
            headers: parsed["headers"],
          }
        : null;
    case "httpResponseEnd":
      return { type: "httpResponseEnd", connectionId: parsed["connectionId"] };
    case "close":
      return {
        type: "close",
        connectionId: parsed["connectionId"],
        code: typeof parsed["code"] === "number" ? parsed["code"] : undefined,
        reason: typeof parsed["reason"] === "string" ? parsed["reason"] : undefined,
      };
    default:
      return null;
  }
};

export const encodeTunnelBinaryFrame = (frame: TunnelBinaryFrame): Buffer => {
  const typeCode = BINARY_FRAME_CODE_BY_TYPE.get(frame.type);
  if (typeCode === undefined) {
    throw new Error(`Unsupported tunnel binary frame type: ${String(frame.type)}`);
  }

  const idBytes = uuidToBytes(frame.connectionId);
  const payload = Buffer.from(frame.payload);
  const output = Buffer.allocUnsafe(TUNNEL_BINARY_HEADER_BYTES + payload.byteLength);
  output[0] = TUNNEL_PROTOCOL_VERSION;
  output[1] = typeCode;
  output[2] = frame.isText ? TUNNEL_BINARY_TEXT_FLAG : 0;
  output[3] = 0;
  idBytes.copy(output, 4);
  payload.copy(output, TUNNEL_BINARY_HEADER_BYTES);
  return output;
};

export const decodeTunnelBinaryFrame = (data: Buffer | ArrayBuffer | readonly Buffer[]): TunnelBinaryFrame | null => {
  const buffer = rawBinaryToBuffer(data);

  if (buffer.byteLength < TUNNEL_BINARY_HEADER_BYTES) {
    return null;
  }

  if (buffer[0] !== TUNNEL_PROTOCOL_VERSION || buffer[3] !== 0) {
    return null;
  }

  const type = BINARY_FRAME_TYPE_BY_CODE.get(buffer[1] ?? -1);
  if (type === undefined) {
    return null;
  }

  const flags = buffer[2] ?? 0;
  if ((flags & ~TUNNEL_BINARY_TEXT_FLAG) !== 0) {
    return null;
  }

  return {
    type,
    connectionId: bytesToUuid(buffer.subarray(4, 20)),
    payload: buffer.subarray(TUNNEL_BINARY_HEADER_BYTES),
    isText: (flags & TUNNEL_BINARY_TEXT_FLAG) !== 0,
  };
};

export const tunnelFrameByteLength = (data: string | Buffer): number =>
  typeof data === "string" ? Buffer.byteLength(data, "utf8") : data.byteLength;

export const rawBinaryToBuffer = (data: Buffer | ArrayBuffer | readonly Buffer[]): Buffer => {
  if (Buffer.isBuffer(data)) {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }

  return Buffer.concat(data);
};

export const rawTextToString = (data: string | Buffer | ArrayBuffer | readonly Buffer[]): string => {
  if (typeof data === "string") {
    return data;
  }

  return rawBinaryToBuffer(data).toString("utf8");
};

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

const uuidToBytes = (uuid: string): Buffer => {
  const normalized = uuid.replace(/-/gu, "").toLowerCase();
  if (!/^[\da-f]{32}$/u.test(normalized)) {
    throw new Error("Tunnel connection id must be a UUID.");
  }

  return Buffer.from(normalized, "hex");
};

const bytesToUuid = (bytes: Buffer): string => {
  if (bytes.byteLength !== 16) {
    throw new Error("Tunnel binary frame connection id must be 16 bytes.");
  }

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};

const parseTunnelRouteMetadata = (value: unknown): TunnelRouteMetadata | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    userId: typeof value["userId"] === "string" ? value["userId"] : undefined,
    accessSessionId: typeof value["accessSessionId"] === "string" ? value["accessSessionId"] : undefined,
    computerId: typeof value["computerId"] === "string" ? value["computerId"] : undefined,
  };
};

const isTunnelRoute = (value: unknown): value is TunnelRoute =>
  value === "filesystem" || value === "browser-control" || value === "preview";

const parseTunnelTrafficClass = (value: unknown): TunnelTrafficClass | undefined =>
  typeof value === "string" && value in TUNNEL_QUEUE_PROFILES ? value as TunnelTrafficClass : undefined;

const isHttpStatus = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringRecord = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
