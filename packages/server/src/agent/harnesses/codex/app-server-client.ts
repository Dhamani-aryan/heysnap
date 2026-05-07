import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";

import { AgentError } from "../../errors.js";

export interface CodexAppServerClient {
  request<TResponse = unknown>(method: string, params?: unknown): Promise<TResponse>;
  subscribe(listener: CodexAppServerNotificationListener): () => void;
  close(): void;
}

export interface CodexAppServerNotification {
  readonly method: string;
  readonly params?: unknown;
}

export type CodexAppServerNotificationListener = (notification: CodexAppServerNotification) => void;

export interface CodexStdioAppServerClientOptions {
  readonly codexBin?: string;
}

type JsonRpcId = number;

interface JsonRpcSuccessMessage {
  readonly id: JsonRpcId;
  readonly result: unknown;
}

interface JsonRpcErrorMessage {
  readonly id?: JsonRpcId;
  readonly error: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
}

interface JsonRpcServerRequestMessage {
  readonly id: JsonRpcId;
  readonly method: string;
  readonly params?: unknown;
}

interface PendingRequest {
  readonly method: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
}

const DEFAULT_CODEX_BIN = "codex";
const CODEX_GATEWAY_TOKEN_ENV = "ANK1015_CODEX_GATEWAY_TOKEN";
const MACHINE_TOKEN_FILE_ENV = "ANK1015_MACHINE_TOKEN_FILE";
const CLIENT_INFO = {
  name: "ank1015_app",
  title: "ank1015 app",
  version: "0.1.0",
};

export class CodexStdioAppServerClient implements CodexAppServerClient {
  private readonly codexBin: string;
  private child: ChildProcessWithoutNullStreams | null = null;
  private readline: ReadlineInterface | null = null;
  private initialized: Promise<void> | null = null;
  private nextRequestId = 1;
  private readonly pendingRequests = new Map<JsonRpcId, PendingRequest>();
  private readonly notificationListeners = new Set<CodexAppServerNotificationListener>();
  private readonly stderrChunks: string[] = [];

  constructor(options: CodexStdioAppServerClientOptions = {}) {
    this.codexBin = options.codexBin?.trim() || DEFAULT_CODEX_BIN;
  }

  async request<TResponse = unknown>(method: string, params: unknown = {}): Promise<TResponse> {
    await this.ensureInitialized();
    return this.sendRequest<TResponse>(method, params);
  }

  subscribe(listener: CodexAppServerNotificationListener): () => void {
    this.notificationListeners.add(listener);
    return () => {
      this.notificationListeners.delete(listener);
    };
  }

  close(): void {
    this.readline?.close();
    this.readline = null;

    const child = this.child;
    this.child = null;
    this.initialized = null;

    if (child !== null && child.exitCode === null && child.signalCode === null) {
      child.kill();
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized !== null) {
      return this.initialized;
    }

    this.startProcess();
    this.initialized = this.initialize();

    try {
      await this.initialized;
    } catch (error) {
      this.initialized = null;
      this.close();
      throw error;
    }
  }

  private async initialize(): Promise<void> {
    await this.sendRequest("initialize", {
      clientInfo: CLIENT_INFO,
    });
    this.sendNotification("initialized", {});
  }

  private startProcess(): void {
    if (this.child !== null) {
      return;
    }

    const child = spawn(this.codexBin, ["app-server"], {
      env: resolveCodexAppServerEnv(process.env),
      stdio: ["pipe", "pipe", "pipe"],
    });

    child.once("error", (error) => {
      this.rejectPending(new AgentError("CODEX_APP_SERVER_ERROR", error.message));
    });
    child.once("exit", (code, signal) => {
      const detail = signal === null ? `code ${String(code ?? 1)}` : `signal ${signal}`;
      this.rejectPending(new AgentError(
        "CODEX_APP_SERVER_EXITED",
        `Codex app-server exited with ${detail}${this.renderStderrSuffix()}`,
      ));
      this.child = null;
      this.initialized = null;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderrChunks.push(chunk.toString("utf8"));
      if (this.stderrChunks.length > 20) {
        this.stderrChunks.shift();
      }
    });

    this.readline = createInterface({ input: child.stdout });
    this.readline.on("line", (line) => this.handleLine(line));
    this.child = child;
  }

  private sendRequest<TResponse>(method: string, params: unknown): Promise<TResponse> {
    const id = this.nextRequestId;
    this.nextRequestId += 1;

    return new Promise<TResponse>((resolve, reject) => {
      this.pendingRequests.set(id, {
        method,
        resolve: (value) => resolve(value as TResponse),
        reject,
      });
      this.writeMessage({ id, method, params });
    });
  }

  private sendNotification(method: string, params: unknown): void {
    this.writeMessage({ method, params });
  }

  private writeMessage(message: unknown): void {
    const stdin = this.child?.stdin;

    if (stdin === undefined || stdin.destroyed) {
      throw new AgentError("CODEX_APP_SERVER_UNAVAILABLE", "Codex app-server is not available");
    }

    stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    let message: unknown;

    try {
      message = JSON.parse(line) as unknown;
    } catch {
      this.rejectPending(new AgentError("CODEX_APP_SERVER_INVALID_MESSAGE", "Codex app-server sent invalid JSON"));
      return;
    }

    if (isJsonRpcSuccessMessage(message)) {
      const pending = this.pendingRequests.get(message.id);

      if (pending === undefined) {
        return;
      }

      this.pendingRequests.delete(message.id);
      pending.resolve(message.result);
      return;
    }

    if (isJsonRpcErrorMessage(message)) {
      if (message.id !== undefined) {
        const pending = this.pendingRequests.get(message.id);

        if (pending !== undefined) {
          this.pendingRequests.delete(message.id);
          pending.reject(new AgentError("CODEX_APP_SERVER_REQUEST_FAILED", message.error.message));
          return;
        }
      }

      this.rejectPending(new AgentError("CODEX_APP_SERVER_ERROR", message.error.message));
      return;
    }

    if (isJsonRpcServerRequestMessage(message)) {
      this.handleServerRequest(message);
      return;
    }

    if (isJsonRpcNotificationMessage(message)) {
      this.notifyListeners(message);
    }
  }

  private handleServerRequest(message: JsonRpcServerRequestMessage): void {
    if (
      message.method === "item/commandExecution/requestApproval" ||
      message.method === "item/fileChange/requestApproval"
    ) {
      const requestId = String(message.id);
      this.notifyListeners({
        method: message.method,
        params: {
          ...(isRecord(message.params) ? message.params : {}),
          requestId,
        },
      });
      this.writeMessage({
        id: message.id,
        result: {
          decision: "accept",
        },
      });
      this.notifyListeners({
        method: `${message.method}/resolved`,
        params: {
          ...(isRecord(message.params) ? message.params : {}),
          requestId,
          decision: "accept",
        },
      });
      return;
    }

    this.writeMessage({
      id: message.id,
      error: {
        code: -32601,
        message: `Unsupported Codex app-server request: ${message.method}`,
      },
    });
  }

  private notifyListeners(notification: CodexAppServerNotification): void {
    for (const listener of this.notificationListeners) {
      listener(notification);
    }
  }

  private rejectPending(error: AgentError): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }

    this.pendingRequests.clear();
  }

  private renderStderrSuffix(): string {
    const stderr = this.stderrChunks.join("").trim();

    if (stderr.length === 0) {
      return "";
    }

    return `: ${stderr.slice(-1000)}`;
  }
}

export const resolveCodexAppServerEnv = (
  sourceEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv => {
  const tokenFile = sourceEnv[MACHINE_TOKEN_FILE_ENV]?.trim();

  if (tokenFile === undefined || tokenFile.length === 0) {
    return sourceEnv;
  }

  let token: string;

  try {
    token = readFileSync(tokenFile, "utf8").trim();
  } catch {
    throw new AgentError(
      "CODEX_MACHINE_TOKEN_NOT_READY",
      `Machine registration is not ready; ${MACHINE_TOKEN_FILE_ENV} does not point to a readable token file.`,
    );
  }

  if (token.length === 0) {
    throw new AgentError(
      "CODEX_MACHINE_TOKEN_NOT_READY",
      "Machine registration is not ready; machine token file is empty.",
    );
  }

  return {
    ...sourceEnv,
    [CODEX_GATEWAY_TOKEN_ENV]: token,
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isJsonRpcSuccessMessage = (value: unknown): value is JsonRpcSuccessMessage =>
  isRecord(value) && typeof value["id"] === "number" && "result" in value;

const isJsonRpcErrorMessage = (value: unknown): value is JsonRpcErrorMessage =>
  isRecord(value) &&
  (value["id"] === undefined || typeof value["id"] === "number") &&
  isRecord(value["error"]) &&
  typeof value["error"]["code"] === "number" &&
  typeof value["error"]["message"] === "string";

const isJsonRpcServerRequestMessage = (value: unknown): value is JsonRpcServerRequestMessage =>
  isRecord(value) && typeof value["id"] === "number" && typeof value["method"] === "string";

const isJsonRpcNotificationMessage = (value: unknown): value is CodexAppServerNotification =>
  isRecord(value) && value["id"] === undefined && typeof value["method"] === "string";
