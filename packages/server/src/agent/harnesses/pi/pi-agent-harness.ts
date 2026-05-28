import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
  type AgentSessionEvent,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";

import { resolveClientPath } from "../../../filesystem/paths.js";
import { AgentError } from "../../errors.js";
import { compareThreadsByUpdatedAtDesc } from "../../thread-groups.js";
import type {
  AgentContent,
  AgentMessage,
  AgentMessageType,
  AgentRuntimeEventBase,
  AgentRuntimeEventType,
  AgentRuntimeItem,
  AgentRunEvent,
  AgentThreadSummary,
  AgentUiContext,
  AssistantContent,
  AssistantMessage,
  AgentThread,
  CancelRunInput,
  EditThreadUserMessageInput,
  GetThreadInput,
  IAgentHarness,
  RetrieveThreadsInput,
  RetrieveThreadsResult,
  SendMessageInput,
  SetupInput,
  SteerRunInput,
  SteerRunResult,
} from "../../types.js";
import {
  PI_DEFAULT_MODEL,
  PI_DEFAULT_PROVIDER,
  normalizePiAnthropicBaseUrl,
  writePiUserConfig,
} from "./config.js";
import {
  findPiSessionById,
  groupPiThreads,
  hydratePiThreadAttachmentPreviews,
  isPiThreadInRoot,
  loadPiSessionFiles,
  toPiThread,
  toPiThreadSummary,
} from "./thread-mapper.js";

const USER_UPLOADS_DIRECTORY = ".codex/user_uploads";
const PI_PROMPT_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png"]);

export type PiPromptImage = {
  readonly type: "image";
  readonly data: string;
  readonly mimeType: string;
};

export type PiPromptContent = {
  readonly text: string;
  readonly images: readonly PiPromptImage[];
};

type PiModel = ReturnType<ModelRegistry["getAll"]>[number];
type PiSession = Awaited<ReturnType<typeof createAgentSession>>["session"];

interface ActivePiRun {
  readonly threadId: string;
  readonly session: PiSession;
}

export interface PiAgentHarnessOptions {
  readonly filesystemRoot?: string;
  readonly home?: string;
  readonly env?: NodeJS.ProcessEnv;
}

interface NormalizedSetupInput {
  readonly install?: boolean;
  readonly apiKey?: string;
  readonly baseUrl: string;
  readonly model: string;
}

interface PiTurnInput {
  readonly threadId?: string;
  readonly path: string;
  readonly content: AgentContent;
  readonly uiContext?: AgentUiContext;
  readonly provider?: string;
  readonly model?: string;
  readonly emitThreadCreated: boolean;
  readonly useSessionModelFallback?: boolean;
  readonly prepareSessionManager?: (sessionManager: SessionManager) => void;
}

interface ProviderModelInput {
  readonly provider?: string;
  readonly model?: string;
}

export class PiAgentHarness implements IAgentHarness {
  private readonly filesystemRoot: string;
  private readonly home?: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly activeRuns = new Map<string, ActivePiRun>();
  private readonly pendingThreads = new Map<string, AgentThread>();

  constructor(options: PiAgentHarnessOptions = {}) {
    this.filesystemRoot = options.filesystemRoot ?? process.cwd();
    this.home = options.home;
    this.env = options.env ?? process.env;
  }

  async setup(input: SetupInput): Promise<void> {
    const setupInput = normalizeSetupInput(input);

    if (setupInput.install !== false) {
      await ensurePiSdkAvailable();
    }

    await writePiUserConfig({
      home: this.resolveHome(),
      anthropicBaseUrl: normalizePiAnthropicBaseUrl(setupInput.baseUrl),
      anthropicApiKey: this.resolveAnthropicApiKey(setupInput),
      model: setupInput.model,
    });
  }

  async retrieveThreads(_input: RetrieveThreadsInput = {}): Promise<RetrieveThreadsResult> {
    const sessions = await loadPiSessionFiles(this.sessionsDir());
    const summariesById = new Map<string, AgentThreadSummary>();

    for (const thread of this.pendingThreads.values()) {
      if (isPiThreadInRoot(thread, _input.rootPath)) {
        summariesById.set(thread.id, thread);
      }
    }

    for (const thread of sessions
      .map((session) => toPiThreadSummary(session, this.filesystemRoot))
      .filter((thread) => isPiThreadInRoot(thread, _input.rootPath))) {
      summariesById.set(thread.id, thread);
    }

    const summaries = Array.from(summariesById.values())
      .sort(compareThreadsByUpdatedAtDesc)
      .slice(0, _input.limit);

    return { groups: groupPiThreads(summaries) };
  }

  async getThread(input: GetThreadInput): Promise<AgentThread> {
    const session = await findPiSessionById(this.sessionsDir(), input.threadId);

    if (session !== null) {
      return hydratePiThreadAttachmentPreviews(toPiThread(session, this.filesystemRoot), this.filesystemRoot);
    }

    const pendingThread = this.pendingThreads.get(input.threadId);

    if (pendingThread !== undefined) {
      return pendingThread;
    }

    throw new AgentError("PI_THREAD_NOT_FOUND", "Pi thread not found.");
  }

  async *sendMessage(input: SendMessageInput): AsyncIterable<AgentRunEvent> {
    yield* this.startTurn({
      threadId: input.threadId,
      path: input.path,
      content: input.content,
      uiContext: input.uiContext,
      provider: input.provider,
      model: input.model,
      emitThreadCreated: input.threadId === undefined,
    });
  }

  async *editThreadUserMessage(input: EditThreadUserMessageInput): AsyncIterable<AgentRunEvent> {
    yield* this.startTurn({
      threadId: input.threadId,
      path: input.path,
      content: input.content,
      uiContext: input.uiContext,
      emitThreadCreated: false,
      useSessionModelFallback: true,
      prepareSessionManager: (sessionManager) => {
        branchPiSessionForEdit(sessionManager, input.numTurns);
      },
    });
  }

  async cancelRun(input: CancelRunInput): Promise<void> {
    const activeRun = this.requireActiveRun(input.threadId, input.runId);
    await activeRun.session.abort();
  }

  async steerRun(input: SteerRunInput): Promise<SteerRunResult> {
    const activeRun = this.requireActiveRun(input.threadId, input.runId);
    const userAttachedFilePaths = await saveUserAttachments(input.content, {
      filesystemRoot: this.filesystemRoot,
      path: input.path,
    });
    const prompt = agentContentToPiPrompt(input.content, {
      filesystemRoot: this.filesystemRoot,
      path: input.path,
      uiContext: input.uiContext,
      userAttachedFilePaths,
    });

    await activeRun.session.steer(
      prompt.text,
      prompt.images.length > 0 ? [...prompt.images] : undefined,
    );

    return { turnId: input.runId };
  }

  private async *startTurn(input: PiTurnInput): AsyncIterable<AgentRunEvent> {
    const baseSelection = normalizeProviderModelSelection(input);
    const cwd = resolveClientPath(this.filesystemRoot, input.path);
    const isNewThread = input.threadId === undefined;
    const sessionFile = isNewThread
      ? null
      : await findPiSessionById(this.sessionsDir(), input.threadId);

    if (!isNewThread && sessionFile === null) {
      throw new AgentError("PI_THREAD_NOT_FOUND", "Pi thread not found.");
    }

    await mkdir(this.sessionsDir(), { recursive: true });

    const sessionManager = sessionFile === null
      ? SessionManager.create(cwd, this.sessionsDir())
      : SessionManager.open(sessionFile.path, this.sessionsDir(), cwd);
    const sessionModelSelection = input.useSessionModelFallback === true
      ? modelSelectionFromSessionModel(sessionManager.buildSessionContext().model)
      : undefined;
    const selection = baseSelection ?? sessionModelSelection ?? {
      provider: PI_DEFAULT_PROVIDER,
      model: PI_DEFAULT_MODEL,
    };
    input.prepareSessionManager?.(sessionManager);

    const model = this.findModel(selection.provider, selection.model);
    const currentSessionModel = sessionManager.buildSessionContext().model;
    const shouldPersistModelSelection = model !== undefined &&
      (currentSessionModel === null ||
        currentSessionModel.provider !== model.provider ||
        currentSessionModel.modelId !== model.id);
    const { session } = await createAgentSession({
      cwd,
      agentDir: this.agentDir(),
      model,
      sessionManager,
    });

    if (model !== undefined && !isSamePiModel(session.model, model)) {
      await session.setModel(model);
    } else if (model !== undefined && shouldPersistModelSelection) {
      session.sessionManager.appendModelChange(model.provider, model.id);
    }

    const runId = randomUUID();
    const threadId = session.sessionId;
    const turnId = runId;
    const userAttachedFilePaths = await saveUserAttachments(input.content, {
      filesystemRoot: this.filesystemRoot,
      path: input.path,
    });
    const prompt = agentContentToPiPrompt(input.content, {
      filesystemRoot: this.filesystemRoot,
      path: input.path,
      uiContext: input.uiContext,
      userAttachedFilePaths,
    });
    const pendingThread = createPendingThread(threadId, input.path, input.content);
    let sequence = 0;
    let turnCompleted = false;
    const queue = new AsyncQueue<AgentRunEvent>();
    const mapper = new PiLiveTurnMapper({
      runId,
      threadId,
      turnId,
      path: input.path,
      nextBase: <TType extends AgentRuntimeEventType>(
        type: TType,
        options: {
          readonly createdAt?: number;
          readonly providerItemId?: string;
          readonly providerRequestId?: string;
        } = {},
      ): AgentRuntimeEventBase & { readonly type: TType } => ({
        version: 2,
        type,
        runId,
        threadId,
        turnId,
        sequence: ++sequence,
        createdAt: options.createdAt ?? Date.now(),
        provider: "pi",
        providerRefs: compactRecord({
          providerThreadId: threadId,
          providerTurnId: turnId,
          providerItemId: options.providerItemId,
          providerRequestId: options.providerRequestId,
        }),
      }),
      onTurnCompleted: () => {
        turnCompleted = true;
      },
    });
    const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
      for (const runEvent of mapper.handle(event)) {
        queue.push(runEvent);
      }
    });
    this.activeRuns.set(runId, { threadId, session });
    this.pendingThreads.set(threadId, pendingThread);

    const promptTask = (async () => {
      try {
        await session.prompt(prompt.text, {
          ...(prompt.images.length > 0 ? { images: [...prompt.images] } : {}),
        });

        if (!turnCompleted) {
          queue.push({
            ...mapper.nextBase("turn.completed"),
            status: "completed",
          });
        }

        const updatedSession = await findPiSessionById(this.sessionsDir(), threadId);

        if (updatedSession !== null) {
          this.pendingThreads.delete(threadId);
          queue.push({
            ...mapper.nextBase("thread.updated", { createdAt: updatedSession.modifiedAt }),
            thread: toPiThreadSummary(updatedSession, this.filesystemRoot),
          });
        }
      } catch (error) {
        queue.push({
          ...mapper.nextBase("runtime.error"),
          error: {
            phase: "server",
            message: error instanceof Error ? error.message : String(error),
            canRetry: true,
          },
        });

        if (!turnCompleted) {
          queue.push({
            ...mapper.nextBase("turn.completed"),
            status: "failed",
            error: {
              phase: "server",
              message: error instanceof Error ? error.message : String(error),
              canRetry: true,
            },
          });
        }
      } finally {
        this.activeRuns.delete(runId);
        this.pendingThreads.delete(threadId);
        unsubscribe();
        session.dispose();
        queue.close();
      }
    })();

    try {
      if (input.emitThreadCreated) {
        yield {
          ...mapper.nextBase("thread.created", { createdAt: Date.now() }),
          thread: createPendingThreadSummary(threadId, input.path, input.content),
        };
      }

      yield {
        ...mapper.nextBase("turn.started"),
        input: input.content,
        path: input.path,
      };

      for (;;) {
        const event = await queue.shift();

        if (event === undefined) {
          break;
        }

        yield event;
      }

      await promptTask;
    } finally {
      this.activeRuns.delete(runId);
      this.pendingThreads.delete(threadId);
      unsubscribe();
      session.dispose();
      queue.close();
    }
  }

  private resolveAnthropicApiKey(input: NormalizedSetupInput): string {
    const apiKey = input.apiKey?.trim();

    if (apiKey !== undefined && apiKey.length > 0) {
      return apiKey;
    }

    const machineTokenFile = this.env.ANK1015_MACHINE_TOKEN_FILE?.trim();

    if (machineTokenFile !== undefined && machineTokenFile.length > 0) {
      return `!cat ${shellQuote(machineTokenFile)}`;
    }

    throw new AgentError(
      "PI_SETUP_MISSING_API_KEY",
      "Pi setup needs an apiKey or ANK1015_MACHINE_TOKEN_FILE in the server environment.",
    );
  }

  private sessionsDir(): string {
    return join(this.agentDir(), "sessions");
  }

  private agentDir(): string {
    return join(this.resolveHome(), ".pi", "agent");
  }

  private resolveHome(): string {
    return this.home ?? this.env.HOME?.trim() ?? process.cwd();
  }

  private findModel(provider: string, modelId: string): PiModel {
    const authStorage = AuthStorage.create(join(this.agentDir(), "auth.json"));
    const modelRegistry = ModelRegistry.create(authStorage, join(this.agentDir(), "models.json"));
    const model = modelRegistry.find(provider, modelId);

    if (model === undefined) {
      throw new AgentError(
        "PI_MODEL_NOT_FOUND",
        `Pi model ${provider}/${modelId} is not configured.`,
      );
    }

    return model;
  }

  private requireActiveRun(threadId: string, runId: string): ActivePiRun {
    const activeRun = this.activeRuns.get(runId);

    if (activeRun === undefined) {
      throw new AgentError("RUN_NOT_FOUND", "Run not found");
    }

    if (activeRun.threadId !== threadId) {
      throw new AgentError("RUN_THREAD_MISMATCH", "Run does not belong to the requested thread");
    }

    return activeRun;
  }
}

const ensurePiSdkAvailable = async (): Promise<void> => {
  try {
    await import("@earendil-works/pi-coding-agent");
  } catch (error) {
    throw new AgentError(
      "PI_SDK_NOT_FOUND",
      error instanceof Error ? error.message : "Pi SDK is not available.",
    );
  }
};

const normalizeSetupInput = (input: SetupInput): NormalizedSetupInput => {
  if (!isRecord(input)) {
    throw new AgentError("PI_SETUP_INVALID_INPUT", "Pi setup input must be an object.");
  }

  return {
    install: optionalBoolean(input["install"], "install"),
    apiKey: optionalStringField(input["apiKey"], "apiKey"),
    baseUrl: requiredNonEmptyString(input["baseUrl"], "baseUrl"),
    model: requiredNonEmptyString(input["model"], "model"),
  };
};

const requiredNonEmptyString = (value: unknown, fieldName: string): string => {
  const result = optionalNonEmptyString(value, fieldName);

  if (result === undefined) {
    throw new AgentError("PI_SETUP_INVALID_INPUT", `Pi setup field ${fieldName} is required.`);
  }

  return result;
};

const optionalNonEmptyString = (value: unknown, fieldName: string): string | undefined => {
  const result = optionalStringField(value, fieldName)?.trim();

  if (result !== undefined && result.length === 0) {
    throw new AgentError("PI_SETUP_INVALID_INPUT", `Pi setup field ${fieldName} must not be empty.`);
  }

  return result;
};

const optionalStringField = (value: unknown, fieldName: string): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new AgentError("PI_SETUP_INVALID_INPUT", `Pi setup field ${fieldName} must be a string.`);
  }

  return value;
};

const optionalBoolean = (value: unknown, fieldName: string): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new AgentError("PI_SETUP_INVALID_INPUT", `Pi setup field ${fieldName} must be a boolean.`);
  }

  return value;
};

const normalizeProviderModelSelection = (
  input: ProviderModelInput,
): { readonly provider: string; readonly model: string } | undefined => {
  if (input.provider === undefined && input.model === undefined) {
    return undefined;
  }

  const provider = input.provider?.trim();
  const model = input.model?.trim();

  if (provider === undefined || provider.length === 0 || model === undefined || model.length === 0) {
    throw new AgentError(
      "PI_MODEL_SELECTION_INVALID",
      "Pi sendMessage requires provider and model to be provided together.",
    );
  }

  return { provider, model };
};

const modelSelectionFromSessionModel = (
  model: { readonly provider: string; readonly modelId: string } | null,
): { readonly provider: string; readonly model: string } | undefined =>
  model === null ? undefined : { provider: model.provider, model: model.modelId };

export const branchPiSessionForEdit = (sessionManager: SessionManager, numTurns: number): void => {
  if (!Number.isInteger(numTurns) || numTurns < 1) {
    throw new AgentError("PI_EDIT_INVALID_TURN_COUNT", "Pi edit requires numTurns to be a positive integer.");
  }

  const target = findUserMessageFromEnd(sessionManager.getBranch(), numTurns);

  if (target === undefined) {
    throw new AgentError("PI_EDIT_MESSAGE_NOT_FOUND", "Pi could not find a user message to edit.");
  }

  if (target.parentId === null) {
    sessionManager.resetLeaf();
    return;
  }

  sessionManager.branch(target.parentId);
};

const findUserMessageFromEnd = (
  entries: readonly SessionEntry[],
  numTurns: number,
): SessionEntry | undefined => {
  let remaining = numTurns;

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];

    if (entry !== undefined && isUserMessageEntry(entry)) {
      remaining -= 1;

      if (remaining === 0) {
        return entry;
      }
    }
  }

  return undefined;
};

const isUserMessageEntry = (entry: SessionEntry): boolean => {
  if (entry.type !== "message") {
    return false;
  }

  return asRecord(entry.message)?.["role"] === "user";
};

const shellQuote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  isRecord(value) ? value : undefined;

const isSamePiModel = (left: PiModel | undefined, right: PiModel): boolean =>
  left?.provider === right.provider && left.id === right.id;

const stablePiMessageKey = (message: Record<string, unknown>): string | undefined => {
  const role = stringField(message, "role");
  const timestamp = numberField(message, "timestamp");

  if (role === undefined || timestamp === undefined) {
    return undefined;
  }

  return `${role}:${timestamp}`;
};

const createPendingThreadSummary = (
  threadId: string,
  path: string,
  content: AgentContent,
): AgentThreadSummary => {
  const now = Date.now();
  const title = agentContentText(content).replace(/\s+/gu, " ").trim();

  return {
    id: threadId,
    title: title.length > 0 ? (title.length > 80 ? `${title.slice(0, 77)}...` : title) : "Untitled thread",
    startPath: path,
    lastPath: path,
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
    isStreaming: true,
  };
};

const createPendingThread = (
  threadId: string,
  path: string,
  content: AgentContent,
): AgentThread => {
  const createdAt = Date.now();
  const summary = createPendingThreadSummary(threadId, path, content);

  return {
    ...summary,
    createdAt,
    updatedAt: createdAt,
    messages: [{
      role: "user",
      id: `pending-user:${threadId}`,
      timestamp: createdAt,
      content,
      path,
    }],
    activities: [],
  };
};

export const agentContentToPiPrompt = (
  content: AgentContent,
  heysnapContext?: HeySnapContextInput,
): PiPromptContent => {
  const textParts: string[] = [];
  const images: PiPromptImage[] = [];

  for (const block of content) {
    if (block.type === "text") {
      textParts.push(block.content);
      continue;
    }

    if (block.type === "image") {
      if (isPiPromptImageMimeType(block.mimeType)) {
        images.push({ type: "image", data: block.data, mimeType: normalizeMimeType(block.mimeType) });
      }
      continue;
    }

    if (block.type === "file") {
      if (block.data !== undefined && isPiPromptImageMimeType(block.mimeType)) {
        images.push({ type: "image", data: block.data, mimeType: normalizeMimeType(block.mimeType) });
      }
    }
  }

  if (heysnapContext !== undefined) {
    textParts.push(formatHeySnapContext(heysnapContext));
  }

  return {
    text: textParts.join("\n\n"),
    images,
  };
};

export interface HeySnapContextInput {
  readonly filesystemRoot: string;
  readonly path: string;
  readonly uiContext?: AgentUiContext;
  readonly userAttachedFilePaths?: readonly string[];
}

export const formatHeySnapContext = (input: HeySnapContextInput): string => {
  const absolutePath = resolveClientPath(input.filesystemRoot, input.path);
  const openFiles = (input.uiContext?.openFiles ?? []).map((file) => ({
    filepath: file.path === "chrome" ? "chrome" : resolveClientPath(input.filesystemRoot, file.path),
    isFocused: file.isFocused,
  }));
  const openFilesJson = JSON.stringify(openFiles, null, 2);
  const attachedFilesJson = JSON.stringify(input.userAttachedFilePaths ?? [], null, 2);

  return [
    "<heysnap_context>",
    `  <current_ui_navigated_directory>${escapeXmlText(absolutePath)}</current_ui_navigated_directory>`,
    "  <current_ui_open_files>",
    escapeXmlText(openFilesJson),
    "  </current_ui_open_files>",
    "  <user_attached_files_with_message>",
    escapeXmlText(attachedFilesJson),
    "  </user_attached_files_with_message>",
    "</heysnap_context>",
  ].join("\n");
};

const saveUserAttachments = async (
  content: AgentContent,
  input: {
    readonly filesystemRoot: string;
    readonly path: string;
  },
): Promise<string[]> => {
  const attachments = content.flatMap((block) =>
    (block.type === "image" || block.type === "file") && typeof block.data === "string"
      ? [{ ...block, data: block.data }]
      : []
  );

  if (attachments.length === 0) {
    return [];
  }

  const uploadDirectory = join(resolveClientPath(input.filesystemRoot, input.path), USER_UPLOADS_DIRECTORY);
  await mkdir(uploadDirectory, { recursive: true });

  return Promise.all(attachments.map(async (block, index) => {
    const filename = sanitizeUploadFilename(block.type === "file"
      ? block.filename
      : typeof block.metadata?.["filename"] === "string"
        ? block.metadata["filename"]
        : `image-${String(index + 1)}`);
    const uploadPath = join(uploadDirectory, `${Date.now().toString(36)}-${randomUUID()}-${filename}`);

    await writeFile(uploadPath, Buffer.from(block.data, "base64"), { flag: "wx" });
    return uploadPath;
  }));
};

const sanitizeUploadFilename = (rawFilename: string): string => {
  const name = basename(rawFilename).replaceAll(/[^a-zA-Z0-9._-]+/gu, "_").replace(/^_+|_+$/gu, "");
  return name.length > 0 ? name.slice(0, 160) : "upload";
};

const escapeXmlText = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const normalizeMimeType = (mimeType: string): string => mimeType.trim().toLowerCase();

const isPiPromptImageMimeType = (mimeType: string): boolean =>
  PI_PROMPT_IMAGE_MIME_TYPES.has(normalizeMimeType(mimeType));

const agentContentText = (content: AgentContent): string =>
  content.flatMap((block) => block.type === "text" ? [block.content] : []).join(" ");

export class PiLiveTurnMapper {
  private readonly runId: string;
  private readonly threadId: string;
  private readonly turnId: string;
  private readonly path: string;
  readonly nextBase: <TType extends AgentRuntimeEventType>(
    type: TType,
    options?: {
      readonly createdAt?: number;
      readonly providerItemId?: string;
      readonly providerRequestId?: string;
    },
  ) => AgentRuntimeEventBase & { readonly type: TType };
  private readonly onTurnCompleted: () => void;
  private readonly messageIds = new WeakMap<object, string>();
  private readonly messageIdsByStableKey = new Map<string, string>();
  private readonly activeMessageIdsByRole = new Map<string, string>();
  private pendingAssistantStartEvent: Extract<AgentRunEvent, { readonly type: "message.started" }> | undefined;
  private pendingRetryableFailureEvents: AgentRunEvent[] = [];
  private pendingRetryableFailureCompletesTurn = false;
  private messageIndex = 0;

  constructor(options: {
    readonly runId: string;
    readonly threadId: string;
    readonly turnId: string;
    readonly path: string;
    readonly nextBase: PiLiveTurnMapper["nextBase"];
    readonly onTurnCompleted: () => void;
  }) {
    this.runId = options.runId;
    this.threadId = options.threadId;
    this.turnId = options.turnId;
    this.path = options.path;
    this.nextBase = options.nextBase;
    this.onTurnCompleted = options.onTurnCompleted;
  }

  handle(event: AgentSessionEvent): AgentRunEvent[] {
    switch (event.type) {
      case "message_start":
        return this.handleMessageStart(event.message);
      case "message_end":
        return this.handleMessageEnd(event.message);
      case "message_update":
        return this.handleMessageUpdate(event);
      case "tool_execution_start":
        return [{
          ...this.nextBase("item.started", { providerItemId: event.toolCallId }),
          item: toRuntimeItem(event.toolCallId, event.toolName, event.args, undefined, false, "running"),
        }];
      case "tool_execution_update":
        return [{
          ...this.nextBase("item.updated", { providerItemId: event.toolCallId }),
          item: toRuntimeItem(
            event.toolCallId,
            event.toolName,
            event.args,
            event.partialResult,
            false,
            "running",
          ),
        }];
      case "tool_execution_end":
        return [{
          ...this.nextBase("item.completed", { providerItemId: event.toolCallId }),
          item: toRuntimeItem(
            event.toolCallId,
            event.toolName,
            undefined,
            event.result,
            event.isError,
            event.isError ? "failed" : "completed",
          ),
        }];
      case "turn_end":
        return this.handleTurnEnd(event.message);
      case "agent_end":
        return this.handleAgentEnd(event);
      case "compaction_start":
        return [{
          ...this.nextBase("item.started"),
          item: toCompactionRuntimeItem(this.turnId, event, "running"),
        }];
      case "compaction_end":
        return [{
          ...this.nextBase("item.completed"),
          item: toCompactionRuntimeItem(
            this.turnId,
            event,
            event.aborted || event.errorMessage !== undefined ? "failed" : "completed",
          ),
        }];
      case "auto_retry_start":
        return [{
          ...this.nextBase("runtime.warning"),
          warning: {
            phase: "model",
            message: `Pi retry ${event.attempt}/${event.maxAttempts}: ${event.errorMessage}`,
            canRetry: true,
            attempts: event.attempt,
          },
        }];
      case "auto_retry_end":
        if (event.success) {
          return [];
        }

        return [{
          ...this.nextBase("runtime.error"),
          error: {
            phase: "model",
            message: event.finalError ?? "Pi retry failed.",
            canRetry: true,
            attempts: event.attempt,
          },
        }];
      default:
        return [];
    }
  }

  private handleMessageEvent(
    type: Extract<AgentRunEvent["type"], "message.started" | "message.completed">,
    piMessage: unknown,
    options: MessageIdOptions = {},
  ): AgentRunEvent[] {
    const message = toAgentMessage(piMessage, this.getMessageId(piMessage, options), this.path);

    if (message === undefined) {
      return [];
    }

    return [{
      ...this.nextBase(type),
      messageType: message.role as AgentMessageType,
      messageId: message.id,
      message,
    }];
  }

  private handleMessageStart(piMessage: unknown): AgentRunEvent[] {
    const events = this.handleMessageEvent("message.started", piMessage, { markActive: true });
    const event = events[0];

    if (event?.type === "message.started" && event.message.role === "assistant") {
      this.pendingAssistantStartEvent = event;
      return [];
    }

    return events;
  }

  private handleMessageEnd(piMessage: unknown): AgentRunEvent[] {
    const events = this.handleMessageEvent("message.completed", piMessage, {
      preferActive: true,
      clearActive: true,
    });
    const event = events[0];

    if (event?.type !== "message.completed" || event.message.role !== "assistant") {
      return events;
    }

    const pendingStart = this.takePendingAssistantStartEvents();

    if (isAssistantError(piMessage)) {
      this.pendingRetryableFailureEvents.push(...pendingStart, ...events);
      return [];
    }

    return [...pendingStart, ...events];
  }

  private handleTurnEnd(piMessage: unknown): AgentRunEvent[] {
    const isError = isAssistantError(piMessage);
    const event: AgentRunEvent = {
      ...this.nextBase("turn.completed"),
      status: isError ? "failed" : "completed",
      ...(isError
        ? {
          error: {
            phase: "model" as const,
            message: stringField(asRecord(piMessage), "errorMessage") ?? "Pi model request failed.",
            canRetry: true,
          },
        }
        : {}),
    };

    if (isError) {
      this.pendingRetryableFailureEvents.push(event);
      this.pendingRetryableFailureCompletesTurn = true;
      return [];
    }

    this.onTurnCompleted();
    return [event];
  }

  private handleAgentEnd(event: Extract<AgentSessionEvent, { readonly type: "agent_end" }>): AgentRunEvent[] {
    if (this.pendingRetryableFailureEvents.length === 0) {
      return [];
    }

    if (event.willRetry) {
      this.clearPendingRetryableFailure();
      return [];
    }

    const events = this.pendingRetryableFailureEvents;
    const completesTurn = this.pendingRetryableFailureCompletesTurn;
    this.clearPendingRetryableFailure();

    if (completesTurn) {
      this.onTurnCompleted();
    }

    return events;
  }

  private takePendingAssistantStartEvents(): Extract<AgentRunEvent, { readonly type: "message.started" }>[] {
    const event = this.pendingAssistantStartEvent;
    this.pendingAssistantStartEvent = undefined;
    return event === undefined ? [] : [event];
  }

  private clearPendingRetryableFailure(): void {
    this.pendingRetryableFailureEvents = [];
    this.pendingRetryableFailureCompletesTurn = false;
  }

  private handleMessageUpdate(
    event: Extract<AgentSessionEvent, { readonly type: "message_update" }>,
  ): AgentRunEvent[] {
    const update = asRecord(event.assistantMessageEvent);
    const delta = stringField(update, "delta");

    if (delta === undefined) {
      return [];
    }

    return [
      ...this.takePendingAssistantStartEvents(),
      {
      ...this.nextBase("content.delta"),
      messageId: this.getMessageId(event.message, { preferActive: true }),
      contentIndex: numberField(update, "contentIndex") ?? 0,
      streamKind: toStreamKind(stringField(update, "type")),
      delta,
      },
    ];
  }

  private getMessageId(piMessage: unknown, options: MessageIdOptions = {}): string {
    if (!isRecord(piMessage)) {
      this.messageIndex += 1;
      return `${this.turnId}:message:${this.messageIndex}`;
    }

    const role = typeof piMessage["role"] === "string" ? piMessage["role"] : "message";
    const existing = this.messageIds.get(piMessage);

    if (existing !== undefined) {
      this.updateActiveMessageId(role, existing, options);
      return existing;
    }

    const stableKey = stablePiMessageKey(piMessage);
    const stableMessageId = stableKey === undefined ? undefined : this.messageIdsByStableKey.get(stableKey);

    if (stableMessageId !== undefined) {
      this.messageIds.set(piMessage, stableMessageId);
      this.updateActiveMessageId(role, stableMessageId, options);
      return stableMessageId;
    }

    const activeMessageId = options.preferActive === true ? this.activeMessageIdsByRole.get(role) : undefined;

    if (activeMessageId !== undefined) {
      this.messageIds.set(piMessage, activeMessageId);
      if (stableKey !== undefined) {
        this.messageIdsByStableKey.set(stableKey, activeMessageId);
      }
      this.updateActiveMessageId(role, activeMessageId, options);
      return activeMessageId;
    }

    this.messageIndex += 1;
    const id = `${this.turnId}:${role}:${this.messageIndex}`;
    this.messageIds.set(piMessage, id);
    if (stableKey !== undefined) {
      this.messageIdsByStableKey.set(stableKey, id);
    }
    this.updateActiveMessageId(role, id, options);
    return id;
  }

  private updateActiveMessageId(role: string, messageId: string, options: MessageIdOptions): void {
    if (options.markActive === true) {
      this.activeMessageIdsByRole.set(role, messageId);
    }

    if (options.clearActive === true) {
      this.activeMessageIdsByRole.delete(role);
    }
  }
}

interface MessageIdOptions {
  readonly preferActive?: boolean;
  readonly markActive?: boolean;
  readonly clearActive?: boolean;
}

const toAgentMessage = (
  value: unknown,
  id: string,
  path: string,
): AgentMessage | undefined => {
  const message = asRecord(value);
  const role = stringField(message, "role");
  const timestamp = numberField(message, "timestamp") ?? Date.now();

  if (role === "user") {
    return {
      role: "user",
      id,
      timestamp,
      path,
      content: stripHeySnapContextContent(toAgentContent(message?.["content"])),
    };
  }

  if (role === "assistant") {
    return {
      role: "assistant",
      id,
      timestamp,
      duration: 0,
      model: stringField(message, "model"),
      provider: stringField(message, "provider"),
      stopReason: toStopReason(stringField(message, "stopReason")),
      content: toAssistantContent(message?.["content"]),
      usage: toUsage(asRecord(message?.["usage"])),
      ...(typeof message?.["errorMessage"] === "string"
        ? { error: { message: message["errorMessage"], canRetry: false } }
        : {}),
    };
  }

  if (role === "toolResult") {
    return {
      role: "toolResult",
      id,
      timestamp,
      toolName: stringField(message, "toolName") ?? "tool",
      toolCallId: stringField(message, "toolCallId") ?? id,
      content: toAgentContent(message?.["content"]),
      details: message?.["details"],
      isError: booleanField(message, "isError") ?? false,
    };
  }

  if (role !== undefined) {
    return {
      role: "custom",
      id,
      timestamp,
      tag: `pi:${role}`,
      content: message ?? { role },
    };
  }

  return undefined;
};

const toAgentContent = (value: unknown): AgentContent => {
  if (typeof value === "string") {
    return value.length > 0 ? [{ type: "text", content: value }] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((block): AgentContent[number][] => {
    const record = asRecord(block);

    if (record?.["type"] === "text") {
      const text = stringField(record, "text") ?? stringField(record, "content") ?? "";
      return text.length > 0 ? [{ type: "text" as const, content: text }] : [];
    }

    if (record?.["type"] === "image") {
      const data = stringField(record, "data");
      const mimeType = stringField(record, "mimeType");
      return data !== undefined && mimeType !== undefined
        ? [{ type: "image" as const, data, mimeType }]
        : [];
    }

    return [];
  });
};

const stripHeySnapContextContent = (content: AgentContent): AgentContent =>
  content.flatMap((block): AgentContent[number][] => {
    if (block.type !== "text") {
      return [block];
    }

    const contentWithoutContext = stripHeySnapContextText(block.content);
    return contentWithoutContext.length > 0
      ? [{ ...block, content: contentWithoutContext }]
      : [];
  });

const stripHeySnapContextText = (text: string): string =>
  text.replace(/(?:\n\s*)*<heysnap_context>[\s\S]*?<\/heysnap_context>\s*$/u, "").trimEnd();

const toAssistantContent = (value: unknown): AssistantContent => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((block): AssistantContent[number][] => {
    const record = asRecord(block);

    if (record?.["type"] === "text") {
      const text = stringField(record, "text") ?? "";
      return text.length > 0
        ? [{ type: "response" as const, response: [{ type: "text" as const, content: text }] }]
        : [];
    }

    if (record?.["type"] === "thinking") {
      const thinkingText = stringField(record, "thinking") ?? "";
      return thinkingText.length > 0 ? [{ type: "thinking" as const, thinkingText }] : [];
    }

    if (record?.["type"] === "toolCall") {
      return [{
        type: "toolCall" as const,
        name: stringField(record, "name") ?? "tool",
        arguments: asRecord(record["arguments"]) ?? {},
        toolCallId: stringField(record, "id") ?? "",
      }];
    }

    return [];
  });
};

const toUsage = (usage: Record<string, unknown> | undefined): AssistantMessage["usage"] | undefined => {
  if (usage === undefined) {
    return undefined;
  }

  const cost = asRecord(usage["cost"]);

  return {
    input: numberField(usage, "input") ?? 0,
    output: numberField(usage, "output") ?? 0,
    cacheRead: numberField(usage, "cacheRead") ?? 0,
    cacheWrite: numberField(usage, "cacheWrite") ?? 0,
    totalTokens: numberField(usage, "totalTokens") ?? 0,
    ...(cost !== undefined
      ? {
        cost: {
          input: numberField(cost, "input") ?? 0,
          output: numberField(cost, "output") ?? 0,
          cacheRead: numberField(cost, "cacheRead") ?? 0,
          cacheWrite: numberField(cost, "cacheWrite") ?? 0,
          total: numberField(cost, "total") ?? 0,
        },
      }
      : {}),
  };
};

const toStopReason = (value: string | undefined): AssistantMessage["stopReason"] => {
  switch (value) {
    case "stop":
    case "length":
    case "toolUse":
    case "error":
    case "aborted":
      return value;
    default:
      return "stop";
  }
};

const toStreamKind = (eventType: string | undefined): Extract<AgentRunEvent, { readonly type: "content.delta" }>["streamKind"] => {
  switch (eventType) {
    case "text_delta":
      return "assistant_text";
    case "thinking_delta":
      return "reasoning_text";
    case "toolcall_delta":
      return "unknown";
    default:
      return "unknown";
  }
};

const isAssistantError = (message: unknown): boolean =>
  asRecord(message)?.["role"] === "assistant" &&
  (asRecord(message)?.["stopReason"] === "error" || asRecord(message)?.["stopReason"] === "aborted");

const toRuntimeItem = (
  id: string,
  toolName: string,
  args: unknown,
  result: unknown,
  isError: boolean,
  status: AgentRuntimeItem["status"],
): AgentRuntimeItem => ({
  id,
  itemType: toRuntimeItemType(toolName),
  status,
  title: toolName,
  summary: formatToolSummary(toolName, args),
  args,
  result,
  isError,
  raw: { toolName, args, result },
});

const toCompactionRuntimeItem = (
  turnId: string,
  event: Extract<AgentSessionEvent, { readonly type: "compaction_start" | "compaction_end" }>,
  status: AgentRuntimeItem["status"],
): AgentRuntimeItem => {
  const endEvent = event.type === "compaction_end" ? event : undefined;
  const isError = endEvent?.aborted === true || endEvent?.errorMessage !== undefined;

  return {
    id: `${turnId}:compaction`,
    itemType: "context_compaction",
    status,
    title: "Context compacted",
    summary: compactionSummary(event),
    result: endEvent?.result,
    isError,
    raw: event,
  };
};

const compactionSummary = (
  event: Extract<AgentSessionEvent, { readonly type: "compaction_start" | "compaction_end" }>,
): string | undefined => {
  if (event.type === "compaction_start") {
    return compactionReasonSummary(event.reason);
  }

  if (event.errorMessage !== undefined) {
    return event.errorMessage;
  }

  if (event.aborted) {
    return "Compaction aborted";
  }

  return event.result?.summary ?? compactionReasonSummary(event.reason);
};

const compactionReasonSummary = (reason: "manual" | "threshold" | "overflow"): string => {
  switch (reason) {
    case "manual":
      return "Manual compaction";
    case "threshold":
      return "Compacting conversation and continuing";
    case "overflow":
      return "Recovering from context overflow";
  }
};

const toRuntimeItemType = (toolName: string): AgentRuntimeItem["itemType"] => {
  switch (toolName) {
    case "bash":
      return "command_execution";
    case "edit":
    case "write":
      return "file_change";
    default:
      return "custom";
  }
};

const formatToolSummary = (toolName: string, args: unknown): string | undefined => {
  const record = asRecord(args);
  const command = stringField(record, "command");

  if (command !== undefined && command.length > 0) {
    return command;
  }

  const path = stringField(record, "path") ?? stringField(record, "filePath");

  if (path !== undefined && path.length > 0) {
    return path;
  }

  return toolName;
};

const stringField = (record: Record<string, unknown> | undefined, key: string): string | undefined => {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
};

const numberField = (record: Record<string, unknown> | undefined, key: string): number | undefined => {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const booleanField = (record: Record<string, unknown> | undefined, key: string): boolean | undefined => {
  const value = record?.[key];
  return typeof value === "boolean" ? value : undefined;
};

const compactRecord = <T extends Record<string, unknown>>(record: T): Partial<T> => {
  const entries = Object.entries(record).filter(([, value]) => value !== undefined);
  return Object.fromEntries(entries) as Partial<T>;
};

class AsyncQueue<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(value: T | undefined) => void> = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) {
      return;
    }

    const waiter = this.waiters.shift();

    if (waiter !== undefined) {
      waiter(value);
      return;
    }

    this.values.push(value);
  }

  shift(): Promise<T | undefined> {
    const value = this.values.shift();

    if (value !== undefined) {
      return Promise.resolve(value);
    }

    if (this.closed) {
      return Promise.resolve(undefined);
    }

    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  close(): void {
    this.closed = true;

    for (const waiter of this.waiters.splice(0)) {
      waiter(undefined);
    }
  }
}
