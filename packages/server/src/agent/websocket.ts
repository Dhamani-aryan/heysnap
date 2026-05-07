import { createServer, type Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";

import { AgentError, toAgentError } from "./errors.js";
import { parseAgentClientMessage } from "./validation.js";
import { attachWebSocketUpgradeRoute } from "../websocket/upgrade-router.js";
import type {
  AgentClientMessage,
  AgentRunEvent,
  AgentServerMessage,
  IAgentHarness,
} from "./types.js";

export interface AgentWebSocketOptions {
  readonly harness: IAgentHarness;
}

export const attachAgentWebSocketServer = (
  server: Server,
  options: AgentWebSocketOptions,
): WebSocketServer => {
  const socketServer = new WebSocketServer({ noServer: true });
  attachWebSocketUpgradeRoute(server, "/agent", socketServer);

  socketServer.on("connection", (webSocket) => {
    new AgentSocketSession(webSocket, options).start();
  });

  return socketServer;
};

export const createAgentServer = (
  options: AgentWebSocketOptions,
): { readonly server: Server; readonly socketServer: WebSocketServer } => {
  const server = createServer();
  const socketServer = attachAgentWebSocketServer(server, options);

  return { server, socketServer };
};

class AgentSocketSession {
  private closed = false;

  constructor(
    private readonly webSocket: WebSocket,
    private readonly options: AgentWebSocketOptions,
  ) {}

  start(): void {
    this.send({ type: "hello", serverTime: new Date().toISOString() });

    this.webSocket.on("message", (data) => {
      void this.handleRawMessage(data);
    });
    this.webSocket.on("close", () => {
      this.closed = true;
    });
    this.webSocket.on("error", () => {
      this.closed = true;
    });
  }

  private async handleRawMessage(data: WebSocket.RawData): Promise<void> {
    let message: AgentClientMessage;

    try {
      message = parseAgentClientMessage(data);
    } catch (error) {
      const agentError = toAgentError(error);
      this.sendError(undefined, agentError.code, agentError.message);
      return;
    }

    try {
      switch (message.type) {
        case "retrieveThreads": {
          const result = await this.options.harness.retrieveThreads({
            rootPath: message.rootPath,
            limit: message.limit,
          });
          this.send({ type: "threads", requestId: message.requestId, groups: result.groups });
          break;
        }
        case "getThread": {
          const thread = await this.options.harness.getThread({ threadId: message.threadId });
          this.send({ type: "thread", requestId: message.requestId, thread });
          break;
        }
        case "sendMessage":
          await this.sendUserMessage(message);
          break;
        case "cancelRun":
          await this.options.harness.cancelRun?.({ threadId: message.threadId, runId: message.runId });
          break;
        case "ping":
          this.send({ type: "pong", requestId: message.requestId, serverTime: new Date().toISOString() });
          break;
      }
    } catch (error) {
      const agentError = toAgentError(error);
      this.sendError(message.requestId, agentError.code, agentError.message);
    }
  }

  private async sendUserMessage(
    message: Extract<AgentClientMessage, { readonly type: "sendMessage" }>,
  ): Promise<void> {
    const iterator = this.options.harness.sendMessage({
      threadId: message.threadId,
      path: message.path,
      content: message.content,
    })[Symbol.asyncIterator]();

    const firstResult = await iterator.next();

    if (firstResult.done === true) {
      throw new AgentError("AGENT_RUN_EMPTY", "Agent run produced no events");
    }

    const firstEvent = firstResult.value;

    this.send({
      type: "run_start",
      requestId: message.requestId,
      runId: firstEvent.runId,
      threadId: firstEvent.threadId,
    });
    this.sendRunEvent(message.requestId, firstEvent);

    for (;;) {
      const result = await iterator.next();

      if (result.done === true) {
        break;
      }

      this.sendRunEvent(message.requestId, result.value);
    }

    this.send({
      type: "run_end",
      requestId: message.requestId,
      runId: firstEvent.runId,
      threadId: firstEvent.threadId,
    });
  }

  private sendRunEvent(requestId: string, event: AgentRunEvent): void {
    this.send({
      type: "event",
      requestId,
      runId: event.runId,
      threadId: event.threadId,
      event,
    });
  }

  private send(message: AgentServerMessage): void {
    if (!this.closed && this.webSocket.readyState === WebSocket.OPEN) {
      this.webSocket.send(JSON.stringify(message));
    }
  }

  private sendError(requestId: string | undefined, code: string, message: string): void {
    this.send({ type: "error", requestId, code, message });
  }
}
