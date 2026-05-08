import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";

import { WebSocket, WebSocketServer } from "ws";

import { attachWebSocketUpgradeRoute } from "../websocket/upgrade-router.js";
import { toCapabilityError } from "./errors.js";
import { parseCapabilityClientMessage } from "./validation.js";
import type { AgentCapabilitiesService } from "./service.js";
import type {
  CapabilityClientMessage,
  CapabilityOperation,
  CapabilityServerMessage,
} from "./types.js";

export interface CapabilitiesWebSocketOptions {
  readonly service: AgentCapabilitiesService;
}

export const attachCapabilitiesWebSocketServer = (
  server: Server,
  options: CapabilitiesWebSocketOptions,
): WebSocketServer => {
  const socketServer = new WebSocketServer({ noServer: true });
  attachWebSocketUpgradeRoute(server, "/capabilities", socketServer);

  socketServer.on("connection", (webSocket) => {
    new CapabilitiesSocketSession(webSocket, options).start();
  });

  return socketServer;
};

export const createCapabilitiesServer = (
  options: CapabilitiesWebSocketOptions,
): { readonly server: Server; readonly socketServer: WebSocketServer } => {
  const server = createServer();
  const socketServer = attachCapabilitiesWebSocketServer(server, options);

  return { server, socketServer };
};

class CapabilitiesSocketSession {
  private closed = false;
  private readonly interactiveOperations = new Map<string, { writeInput(input: string): void; cancel(): void }>();

  constructor(
    private readonly webSocket: WebSocket,
    private readonly options: CapabilitiesWebSocketOptions,
  ) {}

  start(): void {
    this.send({ type: "hello", serverTime: new Date().toISOString() });

    this.webSocket.on("message", (data) => {
      void this.handleRawMessage(data);
    });
    this.webSocket.on("close", () => {
      this.closed = true;
      this.cancelInteractiveOperations();
    });
    this.webSocket.on("error", () => {
      this.closed = true;
      this.cancelInteractiveOperations();
    });
  }

  private async handleRawMessage(data: WebSocket.RawData): Promise<void> {
    let message: CapabilityClientMessage;

    try {
      message = parseCapabilityClientMessage(data);
    } catch (error) {
      const capabilityError = toCapabilityError(error);
      this.sendError(undefined, capabilityError.code, capabilityError.message);
      return;
    }

    try {
      switch (message.type) {
        case "listCapabilities":
          this.send({
            type: "capabilities",
            requestId: message.requestId,
            capabilities: await this.options.service.getCapabilities(),
          });
          break;
        case "installTool":
          await this.runOperation(message, "installTool", message.toolId, (progress) =>
            this.options.service.installTool(message.toolId, progress)
          );
          break;
        case "updateTool":
          await this.runOperation(message, "updateTool", message.toolId, (progress) =>
            this.options.service.updateTool(message.toolId, progress)
          );
          break;
        case "connectTool":
          if (this.options.service.toolConnectionRequiresInput(message.toolId)) {
            await this.startInteractiveOperation(message, "connectTool", message.toolId);
            break;
          }

          await this.runOperation(message, "connectTool", message.toolId, (progress) =>
            this.options.service.connectTool(message.toolId, progress)
          );
          break;
        case "sendToolInput": {
          const operation = this.interactiveOperations.get(message.operationId);
          if (operation === undefined) {
            this.sendError(message.requestId, "OPERATION_NOT_FOUND", "No active connector operation was found.");
            break;
          }

          operation.writeInput(message.input);
          break;
        }
        case "disconnectTool":
          await this.runOperation(message, "disconnectTool", message.toolId, (progress) =>
            this.options.service.disconnectTool(message.toolId, progress)
          );
          break;
        case "refreshToolStatus": {
          const tool = await this.options.service.refreshToolStatus(message.toolId);
          this.send({ type: "toolStatus", requestId: message.requestId, tool });
          break;
        }
        case "installSkill":
          await this.runOperation(message, "installSkill", message.skillId, (progress) =>
            this.options.service.installSkill(message.skillId, progress)
          );
          break;
        case "setSkillActive":
          await this.runOperation(message, "setSkillActive", message.skillId, (progress) =>
            this.options.service.setSkillActive(message.skillId, message.active, progress)
          );
          break;
        case "ping":
          this.send({ type: "pong", requestId: message.requestId, serverTime: new Date().toISOString() });
          break;
      }
    } catch (error) {
      const capabilityError = toCapabilityError(error);
      this.sendError(message.requestId, capabilityError.code, capabilityError.message);
    }
  }

  private async runOperation(
    message: CapabilityClientMessage & { readonly requestId: string },
    operation: CapabilityOperation,
    targetId: string,
    action: (onProgress: (progress: { readonly message: string }) => void) => Promise<unknown>,
  ): Promise<void> {
    const operationId = randomUUID();
    this.send({
      type: "operationStarted",
      requestId: message.requestId,
      operationId,
      operation,
      targetId,
    });

    try {
      await action((progress) => {
        if (progress.message.length > 0) {
          this.send({ type: "operationProgress", requestId: message.requestId, operationId, message: progress.message });
        }
      });
      this.send({
        type: "operationCompleted",
        requestId: message.requestId,
        operationId,
        capabilities: await this.options.service.getCapabilities(),
      });
    } catch (error) {
      const capabilityError = toCapabilityError(error);
      this.send({
        type: "operationFailed",
        requestId: message.requestId,
        operationId,
        code: capabilityError.code,
        message: capabilityError.message,
      });
    }
  }

  private async startInteractiveOperation(
    message: CapabilityClientMessage & { readonly requestId: string },
    operation: CapabilityOperation,
    targetId: string,
  ): Promise<void> {
    const operationId = randomUUID();
    let operationStartedSent = false;
    let shouldSendProgress = false;
    const pendingProgress: string[] = [];
    const sendOperationStarted = (): void => {
      if (operationStartedSent) {
        return;
      }

      this.send({
        type: "operationStarted",
        requestId: message.requestId,
        operationId,
        operation,
        targetId,
      });
      operationStartedSent = true;
      shouldSendProgress = true;
      for (const progressMessage of pendingProgress.splice(0)) {
        this.send({ type: "operationProgress", requestId: message.requestId, operationId, message: progressMessage });
      }
    };

    try {
      const sendProgress = createProgressSender((progressMessage) => {
        if (shouldSendProgress) {
          this.send({ type: "operationProgress", requestId: message.requestId, operationId, message: progressMessage });
          return;
        }

        pendingProgress.push(progressMessage);
      });
      const command = await this.options.service.startInteractiveConnectTool(targetId, (progress) => {
        sendProgress.write(progress.message);
      });
      this.interactiveOperations.set(operationId, command);
      sendOperationStarted();
      sendProgress.flush();
      void command.completed.then(async () => {
        sendProgress.flush();
        this.interactiveOperations.delete(operationId);
        this.send({
          type: "operationCompleted",
          requestId: message.requestId,
          operationId,
          capabilities: await this.options.service.getCapabilities(),
        });
      }).catch((error: unknown) => {
        sendProgress.flush();
        this.interactiveOperations.delete(operationId);
        const capabilityError = toCapabilityError(error);
        this.send({
          type: "operationFailed",
          requestId: message.requestId,
          operationId,
          code: capabilityError.code,
          message: capabilityError.message,
        });
      });
    } catch (error) {
      const capabilityError = toCapabilityError(error);
      sendOperationStarted();
      this.send({
        type: "operationFailed",
        requestId: message.requestId,
        operationId,
        code: capabilityError.code,
        message: capabilityError.message,
      });
    }
  }

  private send(message: CapabilityServerMessage): void {
    if (!this.closed && this.webSocket.readyState === WebSocket.OPEN) {
      this.webSocket.send(JSON.stringify(message));
    }
  }

  private sendError(requestId: string | undefined, code: string, message: string): void {
    this.send({ type: "error", requestId, code, message });
  }

  private cancelInteractiveOperations(): void {
    for (const operation of this.interactiveOperations.values()) {
      operation.cancel();
    }
    this.interactiveOperations.clear();
  }
}

const createProgressSender = (
  send: (message: string) => void,
): { write(message: string): void; flush(): void } => {
  let buffer = "";
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }

    const message = buffer.trim();
    buffer = "";
    if (message.length > 0) {
      send(message);
    }
  };

  return {
    write(message: string): void {
      if (message.length === 0) {
        return;
      }

      buffer += message;
      if (timer === null) {
        timer = setTimeout(flush, 40);
      }
    },
    flush,
  };
};
