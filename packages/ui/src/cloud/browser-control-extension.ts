"use client";

declare global {
  interface Window {
    chrome?: {
      runtime?: {
        lastError?: { readonly message?: string };
        connect?: (extensionId: string, connectInfo: { readonly name: string }) => BrowserControlExtensionPort;
        sendMessage?: (
          extensionId: string,
          message: ExtensionRequest,
          callback: (response?: ExtensionResponse) => void,
        ) => void;
      };
    };
  }
}

type ExtensionRequest = {
  readonly id?: string;
  readonly command: string;
  readonly payload?: unknown;
};

type ExtensionResponse =
  | { readonly ok: true; readonly id?: string; readonly result: unknown }
  | { readonly ok: false; readonly id?: string; readonly error: { readonly code: string; readonly message: string } };

export type BrowserControlExtensionPort = {
  readonly onDisconnect: {
    readonly addListener: (callback: () => void) => void;
  };
  readonly onMessage: {
    readonly addListener: (callback: (message: unknown) => void) => void;
  };
  readonly disconnect: () => void;
  readonly postMessage: (message: unknown) => void;
};

export class BrowserControlExtensionCommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BrowserControlExtensionCommandError";
  }
}

export const sendBrowserControlExtensionCommand = (
  extensionId: string,
  command: string,
  payload: unknown,
  signal: AbortSignal,
): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const sendMessage = window.chrome?.runtime?.sendMessage;

    if (typeof sendMessage !== "function") {
      reject(new BrowserControlExtensionCommandError("EXTENSION_MESSAGING_UNAVAILABLE", "Chrome extension messaging is unavailable."));
      return;
    }

    if (signal.aborted) {
      reject(new BrowserControlExtensionCommandError("BROWSER_EXECUTOR_CANCELLED", "Browser executor request was cancelled."));
      return;
    }

    const id = createBrowserControlClientId();
    const handleAbort = (): void => {
      reject(new BrowserControlExtensionCommandError("BROWSER_EXECUTOR_CANCELLED", "Browser executor request was cancelled."));
    };
    signal.addEventListener("abort", handleAbort, { once: true });

    sendMessage(
      extensionId,
      { id, command, payload },
      (message?: ExtensionResponse) => {
        signal.removeEventListener("abort", handleAbort);

        const lastError = window.chrome?.runtime?.lastError;
        if (lastError !== undefined) {
          reject(new BrowserControlExtensionCommandError("EXTENSION_MESSAGE_FAILED", lastError.message ?? "Chrome extension message failed."));
          return;
        }

        if (message === undefined) {
          reject(new BrowserControlExtensionCommandError("EXTENSION_EMPTY_RESPONSE", "Extension returned an empty response."));
          return;
        }

        if (!message.ok) {
          reject(new BrowserControlExtensionCommandError(message.error.code, message.error.message));
          return;
        }

        resolve(message.result);
      },
    );
  });

export const connectBrowserControlExtensionPort = (
  extensionId: string,
  name: string,
): BrowserControlExtensionPort => {
  const connect = window.chrome?.runtime?.connect;

  if (typeof connect !== "function") {
    throw new BrowserControlExtensionCommandError("EXTENSION_PORT_UNAVAILABLE", "Chrome extension port messaging is unavailable.");
  }

  return connect(extensionId, { name });
};

export const createBrowserControlClientId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `browser-control-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};
