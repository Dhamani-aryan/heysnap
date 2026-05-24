export interface BrowserControlExecutorInput {
  readonly command: string;
  readonly params: unknown;
  readonly signal: AbortSignal;
  readonly timeoutMs?: number;
  readonly attachments?: readonly BrowserControlAttachmentMetadata[];
  readonly outputs?: readonly BrowserControlOutputMetadata[];
  readonly readAttachment?: BrowserControlAttachmentReader;
  readonly writeOutput?: BrowserControlOutputWriter;
}

export type BrowserControlExecutor = (
  input: BrowserControlExecutorInput,
) => Promise<unknown> | unknown;

export interface BrowserControlBridgeProps {
  readonly websocketUrl: string | undefined;
  readonly extensionId?: string;
  readonly executor?: BrowserControlExecutor;
  readonly onEnsureBrowserWindow?: () => Promise<number | null> | number | null;
  readonly onStatusChange?: (status: BrowserControlStatus) => void;
}

export interface BrowserControlStatus {
  readonly state: BrowserControlStatusState;
  readonly label: string;
  readonly detail?: string;
}

export type BrowserControlStatusState =
  | "unavailable"
  | "checking_extension"
  | "extension_unavailable"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export type BrowserControlServerMessage =
  | {
      readonly type: "request";
      readonly requestId: string;
      readonly command: BrowserControlCommandName;
      readonly params?: unknown;
      readonly timeoutMs?: number;
      readonly attachments?: readonly BrowserControlAttachmentMetadata[];
      readonly outputs?: readonly BrowserControlOutputMetadata[];
    }
  | {
      readonly type: "cancel";
      readonly requestId: string;
      readonly reason?: string;
    }
  | {
      readonly type: "attachment.chunk";
      readonly requestId: string;
      readonly chunkRequestId: string;
      readonly attachmentId: string;
      readonly offset: number;
      readonly dataBase64: string;
      readonly done: boolean;
    }
  | {
      readonly type: "attachment.error";
      readonly requestId: string;
      readonly chunkRequestId: string;
      readonly attachmentId: string;
      readonly error: {
        readonly code: string;
        readonly message: string;
      };
    }
  | {
      readonly type: "output.ack";
      readonly requestId: string;
      readonly writeRequestId: string;
      readonly outputId: string;
      readonly offset: number;
      readonly bytesWritten: number;
      readonly done: boolean;
    }
  | {
      readonly type: "output.error";
      readonly requestId: string;
      readonly writeRequestId: string;
      readonly outputId: string;
      readonly error: {
        readonly code: string;
        readonly message: string;
      };
    };

export interface BrowserControlAttachmentMetadata {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
}

export interface BrowserControlAttachmentChunk {
  readonly attachmentId: string;
  readonly dataBase64: string;
  readonly done: boolean;
  readonly offset: number;
}

export type BrowserControlAttachmentReader = (
  input: {
    readonly attachmentId: string;
    readonly length: number;
    readonly offset: number;
    readonly signal: AbortSignal;
  },
) => Promise<BrowserControlAttachmentChunk>;

export interface BrowserControlOutputMetadata {
  readonly id: string;
  readonly mimeType: string;
  readonly maxBytes: number;
}

export interface BrowserControlOutputAck {
  readonly bytesWritten: number;
  readonly done: boolean;
  readonly offset: number;
  readonly outputId: string;
}

export type BrowserControlOutputWriter = (
  input: {
    readonly dataBase64: string;
    readonly done: boolean;
    readonly offset: number;
    readonly outputId: string;
    readonly signal: AbortSignal;
  },
) => Promise<BrowserControlOutputAck>;

export type BrowserControlCommandName =
  | "getTabs"
  | "createNewTab"
  | "closeTab"
  | "tab.focus"
  | "tab.back"
  | "tab.forward"
  | "tab.goTo"
  | "tab.refresh"
  | "tab.evaluate"
  | "tab.screenshot"
  | "tab.cdp";
