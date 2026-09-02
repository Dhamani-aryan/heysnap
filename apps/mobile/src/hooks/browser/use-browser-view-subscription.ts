import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

const BROWSER_VIEW_PROTOCOL_VERSION = 1;
const BROWSER_VIEW_DEBUG = true;

export type BrowserViewSubscriptionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

export type BrowserViewActiveTab = {
  readonly windowId: number | null;
  readonly tabId: number | null;
  readonly title?: string;
  readonly url?: string;
  readonly timestamp?: string;
};

export type BrowserViewTab = {
  readonly active: boolean;
  readonly id: number;
  readonly index: number;
  readonly title?: string;
  readonly url?: string;
};

export type BrowserViewFrameMetadata = {
  readonly type: 'frame';
  readonly sequence?: number;
  readonly tabId?: number;
  readonly activeTabId?: number | null;
  readonly windowId?: number | null;
  readonly title?: string;
  readonly url?: string;
  readonly aspectRatio: number | null;
  readonly mimeType: string;
  readonly byteLength?: number;
  readonly receivedAt?: number;
  readonly sentAt?: number;
};

export type BrowserViewBrowserStatus = {
  readonly activeTabId: number | null;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly connected: boolean;
  readonly connectionStatus?: string;
  readonly extensionStatus?: string;
  readonly tabCount: number;
  readonly timestamp?: string;
  readonly windowId: number | null;
  readonly windowReady: boolean;
};

export type BrowserViewStreamStatus = {
  readonly reason?: string;
  readonly streaming: boolean;
  readonly timestamp?: string;
};

export type BrowserViewSubscriptionState = {
  readonly activeTab: BrowserViewActiveTab | null;
  readonly browserStatus: BrowserViewBrowserStatus | null;
  readonly error: string | null;
  readonly frameMetadata: BrowserViewFrameMetadata | null;
  readonly frameUri: string | null;
  readonly lastFrameAt: number | null;
  readonly publisherConnected: boolean;
  readonly status: BrowserViewSubscriptionStatus;
  readonly streamStatus: BrowserViewStreamStatus | null;
  readonly tabs: readonly BrowserViewTab[];
};

type BrowserViewSubscriptionOptions = {
  readonly enabled: boolean;
  readonly receiveFrames?: boolean;
  readonly url: string | null;
};

type BrowserViewInputPoint = {
  readonly x: number;
  readonly y: number;
};

type BrowserViewKeyboardInput = {
  readonly altKey: boolean;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly key: string;
  readonly keyCode: number;
  readonly location: number;
  readonly metaKey: boolean;
  readonly repeat: boolean;
  readonly shiftKey: boolean;
  readonly text?: string;
  readonly type: 'keyDown' | 'keyUp';
};

type BrowserViewCommand =
  | { readonly command: 'back' | 'forward' | 'newTab' | 'reload' }
  | { readonly command: 'activateTab'; readonly tabId: number }
  | { readonly command: 'closeTab'; readonly tabId: number }
  | { readonly command: 'navigate'; readonly url: string }
  | { readonly command: 'viewport.insertText'; readonly text: string }
  | { readonly command: 'viewport.key'; readonly key: BrowserViewKeyboardInput }
  | {
      readonly command: 'viewport.click';
      readonly fallbackPoint: BrowserViewInputPoint;
      readonly ratio: BrowserViewInputPoint;
    }
  | {
      readonly command: 'viewport.wheel';
      readonly deltaX: number;
      readonly deltaY: number;
      readonly fallbackPoint: BrowserViewInputPoint;
      readonly ratio: BrowserViewInputPoint;
    };

export type BrowserViewSubscriptionResult = BrowserViewSubscriptionState & {
  readonly sendCommand: (command: BrowserViewCommand) => boolean;
};

const initialState: BrowserViewSubscriptionState = {
  activeTab: null,
  browserStatus: null,
  error: null,
  frameMetadata: null,
  frameUri: null,
  lastFrameAt: null,
  publisherConnected: false,
  status: 'idle',
  streamStatus: null,
  tabs: [],
};

export function useBrowserViewSubscription({
  enabled,
  receiveFrames = true,
  url,
}: BrowserViewSubscriptionOptions): BrowserViewSubscriptionResult {
  const [state, setState] = useState<BrowserViewSubscriptionState>(initialState);
  const pendingFrameMetadataRef = useRef<BrowserViewFrameMetadata | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!enabled || url === null) {
      pendingFrameMetadataRef.current = null;
      setState((current) => ({
        ...current,
        browserStatus: null,
        error: null,
        publisherConnected: false,
        status: 'idle',
        streamStatus: null,
        tabs: [],
      }));
      return;
    }

    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (error) {
      setState((current) => ({
        ...current,
        error: getErrorMessage(error),
        status: 'error',
      }));
      return;
    }

    let isDisposed = false;
    socketRef.current = socket;
    socket.binaryType = 'arraybuffer';
    setState((current) => ({
      ...current,
      error: null,
      status: 'connecting',
    }));

    socket.onopen = () => {
      if (isDisposed || socketRef.current !== socket) return;
      setState((current) => ({
        ...current,
        error: null,
        status: 'connected',
      }));
      socket.send(JSON.stringify({
        type: 'hello',
        role: 'subscriber',
        protocolVersion: BROWSER_VIEW_PROTOCOL_VERSION,
      }));
    };

    socket.onmessage = (event) => {
      if (!receiveFrames && typeof event.data !== 'string') return;

      void handleSocketMessage(event.data, {
        getPendingFrameMetadata: () => pendingFrameMetadataRef.current,
        isActive: () => !isDisposed && socketRef.current === socket,
        receiveFrames,
        setPendingFrameMetadata: (metadata) => {
          pendingFrameMetadataRef.current = metadata;
        },
        setState,
      });
    };

    socket.onerror = () => {
      if (isDisposed || socketRef.current !== socket) return;
      setState((current) => ({
        ...current,
        error: 'Browser view connection failed.',
        status: 'error',
      }));
    };

    socket.onclose = () => {
      if (isDisposed || socketRef.current !== socket) return;
      socketRef.current = null;
      pendingFrameMetadataRef.current = null;
      setState((current) => ({
        ...current,
        browserStatus: null,
        publisherConnected: false,
        status: 'disconnected',
        streamStatus: null,
        tabs: [],
      }));
    };

    return () => {
      isDisposed = true;
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
      pendingFrameMetadataRef.current = null;
      socket.close(1000, 'Browser view subscriber stopped');
    };
  }, [enabled, receiveFrames, url]);

  const sendCommand = useCallback((command: BrowserViewCommand): boolean => {
    const socket = socketRef.current;
    if (socket === null || socket.readyState !== WebSocket.OPEN) {
      logBrowserViewDebug('send-command.skipped', {
        readyState: socket?.readyState ?? null,
        ...summarizeBrowserCommand(command),
      });
      return false;
    }

    const requestId = createRequestId();
    const payload = {
      type: 'browser.command',
      requestId,
      ...command,
    };
    logBrowserViewDebug('send-command', {
      requestId,
      ...summarizeBrowserCommand(command),
    });
    socket.send(JSON.stringify(payload));
    return true;
  }, []);

  return {
    ...state,
    sendCommand,
  };
}

async function handleSocketMessage(
  data: unknown,
  handlers: {
    readonly getPendingFrameMetadata: () => BrowserViewFrameMetadata | null;
    readonly isActive: () => boolean;
    readonly receiveFrames: boolean;
    readonly setPendingFrameMetadata: (metadata: BrowserViewFrameMetadata | null) => void;
    readonly setState: Dispatch<SetStateAction<BrowserViewSubscriptionState>>;
  },
): Promise<void> {
  if (typeof data === 'string') {
    const message = parseJsonRecord(data);
    if (message === null) return;
    handleJsonMessage(message, handlers);
    return;
  }

  if (!handlers.receiveFrames) return;

  const frameBase64 = await messageDataToBase64(data);
  if (frameBase64 === null || !handlers.isActive()) return;

  const metadata = handlers.getPendingFrameMetadata();
  const mimeType = metadata?.mimeType ?? 'image/jpeg';
  const frameUri = `data:${mimeType};base64,${frameBase64}`;
  handlers.setPendingFrameMetadata(null);
  handlers.setState((current) =>
    current.streamStatus?.streaming === false
      ? current
      : {
          ...current,
          frameMetadata: metadata,
          frameUri,
          lastFrameAt: Date.now(),
        },
  );
}

function handleJsonMessage(
  message: Record<string, unknown>,
  handlers: {
    readonly setPendingFrameMetadata: (metadata: BrowserViewFrameMetadata | null) => void;
    readonly receiveFrames: boolean;
    readonly setState: Dispatch<SetStateAction<BrowserViewSubscriptionState>>;
  },
): void {
  if (message.type === 'browser.command.result') {
    logBrowserViewDebug('command-result', {
      requestId: readString(message.requestId),
      ok: message.ok === true,
      error: readString(message.error),
    });
    return;
  }

  if (message.type === 'publisher.status') {
    const connected = message.connected === true;
    handlers.setState((current) => ({
      ...current,
      browserStatus: connected ? current.browserStatus : null,
      frameMetadata: connected ? current.frameMetadata : null,
      frameUri: connected ? current.frameUri : null,
      lastFrameAt: connected ? current.lastFrameAt : null,
      publisherConnected: connected,
      streamStatus: connected ? current.streamStatus : null,
      tabs: connected ? current.tabs : [],
    }));
    return;
  }

  if (message.type === 'browser.status') {
    const connected = message.connected === true;
    handlers.setState((current) => ({
      ...current,
      browserStatus: {
        activeTabId: readNullableNumber(message.activeTabId),
        canGoBack: message.canGoBack === true,
        canGoForward: message.canGoForward === true,
        connected,
        connectionStatus: readString(message.connectionStatus),
        extensionStatus: readString(message.extensionStatus),
        tabCount: readNumber(message.tabCount) ?? 0,
        timestamp: readString(message.timestamp),
        windowId: readNullableNumber(message.windowId),
        windowReady: message.windowReady === true,
      },
      frameMetadata: connected ? current.frameMetadata : null,
      frameUri: connected ? current.frameUri : null,
      lastFrameAt: connected ? current.lastFrameAt : null,
      tabs: connected ? current.tabs : [],
    }));
    return;
  }

  if (message.type === 'stream.status') {
    const streaming = message.streaming === true;
    handlers.setState((current) => ({
      ...current,
      frameMetadata: streaming ? current.frameMetadata : null,
      frameUri: streaming ? current.frameUri : null,
      lastFrameAt: streaming ? current.lastFrameAt : null,
      streamStatus: {
        reason: readString(message.reason),
        streaming,
        timestamp: readString(message.timestamp),
      },
    }));
    return;
  }

  if (message.type === 'activeTab') {
    const nextTabId = readNullableNumber(message.tabId);
    handlers.setState((current) => ({
      ...current,
      activeTab: {
        windowId: readNullableNumber(message.windowId),
        tabId: nextTabId,
        title: readString(message.title),
        url: readString(message.url),
        timestamp: readString(message.timestamp),
      },
      ...(shouldClearFrameForActiveTab(current.frameMetadata, nextTabId)
        ? {
            frameMetadata: null,
            frameUri: null,
            lastFrameAt: null,
          }
        : {}),
    }));
    return;
  }

  if (message.type === 'tabs') {
    handlers.setState((current) => ({
      ...current,
      tabs: readBrowserTabs(message.tabs),
    }));
    return;
  }

  if (message.type === 'frame') {
    if (!handlers.receiveFrames) return;

    handlers.setPendingFrameMetadata({
      type: 'frame',
      sequence: readNumber(message.sequence),
      tabId: readNumber(message.tabId),
      activeTabId: readNullableNumber(message.activeTabId),
      windowId: readNullableNumber(message.windowId),
      title: readString(message.title),
      url: readString(message.url),
      aspectRatio: readNullableNumber(message.aspectRatio),
      mimeType: readString(message.mimeType) ?? 'image/jpeg',
      byteLength: readNumber(message.byteLength),
      receivedAt: readNumber(message.receivedAt),
      sentAt: readNumber(message.sentAt),
    });
  }
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function messageDataToBase64(data: unknown): Promise<string | null> {
  if (data instanceof ArrayBuffer) {
    return arrayBufferToBase64(data);
  }

  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    const bytes = new Uint8Array(view.byteLength);
    bytes.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    return arrayBufferToBase64(bytes.buffer);
  }

  if (isBlobWithArrayBuffer(data)) {
    return arrayBufferToBase64(await data.arrayBuffer());
  }

  return null;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    for (let index = 0; index < chunk.length; index += 1) {
      binary += String.fromCharCode(chunk[index] ?? 0);
    }
  }

  return globalThis.btoa(binary);
}

function isBlobWithArrayBuffer(value: unknown): value is { arrayBuffer(): Promise<ArrayBuffer> } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { arrayBuffer?: unknown }).arrayBuffer === 'function'
  );
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readNullableNumber(value: unknown): number | null {
  return value === null ? null : readNumber(value) ?? null;
}

function readBrowserTabs(value: unknown): BrowserViewTab[] {
  if (!Array.isArray(value)) return [];

  const tabs: BrowserViewTab[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      continue;
    }

    const record = item as Record<string, unknown>;
    const id = readNumber(record.id);
    const index = readNumber(record.index);
    if (id === undefined || index === undefined) continue;

    tabs.push({
      active: record.active === true,
      id,
      index,
      title: readString(record.title),
      url: readString(record.url),
    });
  }

  return tabs.sort((left, right) => left.index - right.index);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Browser view connection failed.';
}

function shouldClearFrameForActiveTab(
  metadata: BrowserViewFrameMetadata | null,
  activeTabId: number | null,
): boolean {
  if (metadata === null) return false;
  const frameActiveTabId = metadata.activeTabId ?? metadata.tabId ?? null;
  return frameActiveTabId !== activeTabId;
}

function createRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function logBrowserViewDebug(event: string, details: Record<string, unknown>): void {
  if (!BROWSER_VIEW_DEBUG) return;
  // eslint-disable-next-line no-console
  console.info('[browser-view][mobile]', event, details);
}

function summarizeBrowserCommand(command: BrowserViewCommand): Record<string, unknown> {
  if (command.command === 'viewport.insertText') {
    return {
      command: command.command,
      textLength: command.text.length,
    };
  }

  if (command.command === 'viewport.key') {
    return {
      command: command.command,
      keyName: command.key.key.length > 1 ? command.key.key : undefined,
      keyType: command.key.type,
      printable: command.key.key.length === 1,
    };
  }

  return { command: command.command };
}
