import type { IncomingMessage, ServerResponse } from "node:http";

import { CapabilityError, toCapabilityError } from "./errors.js";
import { CapabilitiesOperationManager } from "./operation-manager.js";
import type { AgentCapabilitiesService } from "./service.js";
import type { AgentToolDefinition, CapabilityOperationSnapshot } from "./types.js";

const jsonHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "Content-Type",
  "content-type": "application/json",
} as const;

export interface CapabilitiesHttpService {
  readonly operationManager: CapabilitiesOperationManager;
  readonly handleRequest: (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;
}

export const createCapabilitiesHttpService = (
  options: { readonly service: AgentCapabilitiesService },
): CapabilitiesHttpService => {
  const operationManager = new CapabilitiesOperationManager({ service: options.service });

  return {
    operationManager,
    handleRequest: async (request, response) =>
      handleCapabilitiesHttpRequest(request, response, options.service, operationManager),
  };
};

const handleCapabilitiesHttpRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  service: AgentCapabilitiesService,
  operationManager: CapabilitiesOperationManager,
): Promise<boolean> => {
  const requestUrl = new URL(request.url ?? "/", "http://localhost");

  if (!requestUrl.pathname.startsWith("/capabilities")) {
    return false;
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204, jsonHeaders);
    response.end();
    return true;
  }

  try {
    if (request.method === "GET" && requestUrl.pathname === "/capabilities") {
      sendJson(response, 200, { capabilities: await service.refreshToolStatuses() });
      return true;
    }

    const toolActionMatch = /^\/capabilities\/tools\/([^/]+)\/([^/]+)$/.exec(requestUrl.pathname);

    if (request.method === "POST" && toolActionMatch !== null) {
      const toolId = decodeURIComponent(toolActionMatch[1] ?? "");
      const action = toolActionMatch[2] ?? "";
      const tool = requireTool(service, toolId);

      if (action === "refresh-status") {
        await service.refreshToolStatus(tool.id);
        sendJson(response, 200, { capabilities: await service.getCapabilities() });
        return true;
      }

      if (action === "disconnect") {
        await service.disconnectTool(tool.id);
        sendJson(response, 200, { capabilities: await service.getCapabilities() });
        return true;
      }

      if (action === "install") {
        sendJson(response, 202, { operation: operationManager.startInstallTool(tool.id) });
        return true;
      }

      if (action === "update") {
        sendJson(response, 202, { operation: operationManager.startUpdateTool(tool.id) });
        return true;
      }

      if (action === "connect") {
        if (tool.connect === undefined) {
          throw new CapabilityError("TOOL_CONNECT_UNSUPPORTED", `${tool.label} does not define a connect flow.`);
        }

        if (tool.connect.interactive === "tty") {
          sendJson(response, 202, { operation: await operationManager.startInteractiveConnectTool(tool.id) });
          return true;
        }

        await service.connectTool(tool.id);
        sendJson(response, 200, { capabilities: await service.getCapabilities() });
        return true;
      }

      throw new CapabilityError("NOT_FOUND", "Capability action not found.");
    }

    const operationInputMatch = /^\/capabilities\/operations\/([^/]+)\/input$/.exec(requestUrl.pathname);

    if (request.method === "POST" && operationInputMatch !== null) {
      const operationId = decodeURIComponent(operationInputMatch[1] ?? "");
      await handleOperationInput(request, response, operationManager, operationId);
      return true;
    }

    const operationMatch = /^\/capabilities\/operations\/([^/]+)$/.exec(requestUrl.pathname);

    if (operationMatch !== null) {
      const operationId = decodeURIComponent(operationMatch[1] ?? "");

      if (request.method === "GET") {
        sendOperation(response, operationManager.getOperation(operationId));
        return true;
      }

      if (request.method === "POST") {
        await handleOperationInput(request, response, operationManager, operationId);
        return true;
      }

      if (request.method === "DELETE") {
        sendOperation(response, operationManager.cancelOperation(operationId));
        return true;
      }
    }

    sendCapabilityError(response, 404, new CapabilityError("NOT_FOUND", "Capability endpoint not found."));
    return true;
  } catch (error) {
    const capabilityError = toCapabilityError(error);
    sendCapabilityError(response, statusForCapabilityError(capabilityError), capabilityError);
    return true;
  }
};

const requireTool = (service: AgentCapabilitiesService, toolId: string): AgentToolDefinition => {
  const tool = service.catalog.tools.find((candidate) => candidate.id === toolId);

  if (tool === undefined) {
    throw new CapabilityError("TOOL_NOT_FOUND", `Unknown agent tool: ${toolId}`);
  }

  return tool;
};

const sendOperation = (
  response: ServerResponse,
  operation: CapabilityOperationSnapshot | null,
): void => {
  if (operation === null) {
    sendCapabilityError(response, 404, new CapabilityError("OPERATION_NOT_FOUND", "Capability operation not found."));
    return;
  }

  sendJson(response, 200, { operation });
};

const handleOperationInput = async (
  request: IncomingMessage,
  response: ServerResponse,
  operationManager: CapabilitiesOperationManager,
  operationId: string,
): Promise<void> => {
  const body = await readJsonBody(request);
  const input = parseOperationInput(body);
  const current = operationManager.getOperation(operationId);

  if (current === null) {
    sendCapabilityError(response, 404, new CapabilityError("OPERATION_NOT_FOUND", "Capability operation not found."));
    return;
  }

  if (current.status !== "waiting_for_input") {
    sendCapabilityError(response, 409, new CapabilityError("OPERATION_NOT_WAITING_FOR_INPUT", "Capability operation is not waiting for input."));
    return;
  }

  sendOperation(response, operationManager.writeInput(operationId, input));
};

const parseOperationInput = (body: unknown): string => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new CapabilityError("INVALID_REQUEST", "Operation input request must be a JSON object.");
  }

  const input = (body as Record<string, unknown>)["input"];

  if (typeof input !== "string" || input.length === 0) {
    throw new CapabilityError("INVALID_REQUEST", "Operation input must be a non-empty string.");
  }

  return input;
};

const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const bodyText = Buffer.concat(chunks).toString("utf8");

  if (bodyText.length === 0) {
    return {};
  }

  try {
    return JSON.parse(bodyText) as unknown;
  } catch {
    throw new CapabilityError("INVALID_REQUEST", "Request body must be valid JSON.");
  }
};

const sendJson = (response: ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, jsonHeaders);
  response.end(JSON.stringify(body));
};

const sendCapabilityError = (response: ServerResponse, status: number, error: CapabilityError): void => {
  sendJson(response, status, {
    error: {
      code: error.code,
      message: error.message,
    },
  });
};

const statusForCapabilityError = (error: CapabilityError): number => {
  switch (error.code) {
    case "INVALID_REQUEST":
      return 400;
    case "TOOL_NOT_FOUND":
    case "OPERATION_NOT_FOUND":
    case "NOT_FOUND":
      return 404;
    case "TOOL_CONNECT_UNSUPPORTED":
    case "TOOL_CONNECT_NOT_INTERACTIVE":
    case "TOOL_DISCONNECT_UNSUPPORTED":
    case "OPERATION_NOT_WAITING_FOR_INPUT":
      return 409;
    default:
      return 500;
  }
};
