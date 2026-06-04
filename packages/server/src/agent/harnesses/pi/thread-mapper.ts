import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { toClientPath } from "../../../filesystem/paths.js";
import { groupThreadSummariesByStartPath } from "../../thread-groups.js";
import type {
  AgentContent,
  AgentMessage,
  AgentThread,
  AgentThreadActivity,
  AgentThreadGroup,
  AgentThreadSummary,
  AssistantContent,
  StopReason,
  Usage,
} from "../../types.js";

const HEYSNAP_CONTEXT_PATTERN = /\s*<heysnap_context>[\s\S]*?<\/heysnap_context>\s*/gu;
const HEYSNAP_CONTEXT_CAPTURE_PATTERN = /<heysnap_context>([\s\S]*?)<\/heysnap_context>/u;
const USER_ATTACHED_FILES_CAPTURE_PATTERN =
  /<user_attached_files_with_message>([\s\S]*?)<\/user_attached_files_with_message>/u;
const PI_ATTACHED_TEXT_FILE_BLOCK_PATTERN = /(?:\n\s*)*Attached file: [^\n]+\n```[\s\S]*?\n```\s*/gu;
const PI_ATTACHED_FILE_LINE_PATTERN = /(?:\n\s*)*Attached file: [^\n]+\s*/gu;
const USER_UPLOADS_DIRECTORY = ".codex/user_uploads";
const MAX_IMAGE_PREVIEW_BYTES = 5 * 1024 * 1024;

export interface PiSessionFile {
  readonly path: string;
  readonly header: PiSessionHeader;
  readonly entries: readonly PiSessionEntry[];
  readonly modifiedAt: number;
}

interface PiSessionHeader {
  readonly type: "session";
  readonly id: string;
  readonly timestamp?: string;
  readonly cwd?: string;
  readonly [key: string]: unknown;
}

type PiSessionEntry =
  | PiSessionMessageEntry
  | PiSessionInfoEntry
  | PiCompactionEntry
  | PiBranchSummaryEntry
  | PiModelChangeEntry
  | PiThinkingLevelChangeEntry
  | PiCustomEntry
  | PiUnknownEntry;

interface PiSessionEntryBase {
  readonly type: string;
  readonly id: string;
  readonly parentId: string | null;
  readonly timestamp?: string;
  readonly [key: string]: unknown;
}

interface PiSessionMessageEntry extends PiSessionEntryBase {
  readonly type: "message";
  readonly message: Record<string, unknown>;
}

interface PiSessionInfoEntry extends PiSessionEntryBase {
  readonly type: "session_info";
  readonly name?: string;
}

interface PiCompactionEntry extends PiSessionEntryBase {
  readonly type: "compaction";
  readonly summary?: string;
  readonly tokensBefore?: number;
}

interface PiBranchSummaryEntry extends PiSessionEntryBase {
  readonly type: "branch_summary";
  readonly summary?: string;
  readonly fromId?: string;
}

interface PiModelChangeEntry extends PiSessionEntryBase {
  readonly type: "model_change";
  readonly provider?: string;
  readonly modelId?: string;
}

interface PiThinkingLevelChangeEntry extends PiSessionEntryBase {
  readonly type: "thinking_level_change";
  readonly thinkingLevel?: string;
}

interface PiCustomEntry extends PiSessionEntryBase {
  readonly type: "custom" | "custom_message" | "label";
  readonly customType?: string;
}

interface PiUnknownEntry extends PiSessionEntryBase {
  readonly type: string;
}

export const loadPiSessionFiles = async (sessionsDir: string): Promise<PiSessionFile[]> => {
  const paths = await findJsonlFiles(sessionsDir);
  const sessions = await Promise.all(paths.map((path) => loadPiSessionFile(path)));

  return sessions
    .filter((session): session is PiSessionFile => session !== null)
    .sort((left, right) => right.modifiedAt - left.modifiedAt);
};

export const findPiSessionById = async (
  sessionsDir: string,
  threadId: string,
): Promise<PiSessionFile | null> => {
  const sessions = await loadPiSessionFiles(sessionsDir);

  return sessions.find((session) => session.header.id === threadId) ?? null;
};

export const toPiThreadSummary = (
  session: PiSessionFile,
  filesystemRoot: string,
): AgentThreadSummary => {
  const branch = getActiveBranch(session);
  const path = toHarnessPath(session.header.cwd ?? "", filesystemRoot);

  return {
    id: session.header.id,
    title: readSessionName(session.entries) ?? firstUserMessageTitle(branch) ?? "Untitled thread",
    startPath: path,
    lastPath: path,
    createdAt: parseTimestamp(session.header.timestamp) ?? session.modifiedAt,
    updatedAt: latestTimestamp(session.entries) ?? session.modifiedAt,
    messageCount: countUserMessages(branch),
  };
};

export const toPiThread = (
  session: PiSessionFile,
  filesystemRoot: string,
): AgentThread => {
  const branch = getActiveBranch(session);
  const summary = toPiThreadSummary(session, filesystemRoot);

  return {
    ...summary,
    messages: branch.flatMap((entry) => mapPiEntryToAgentMessages(entry, summary.lastPath)),
    activities: branch.flatMap(mapPiEntryToActivities),
  };
};

export const hydratePiThreadAttachmentPreviews = async (
  thread: AgentThread,
  filesystemRoot: string,
): Promise<AgentThread> => ({
  ...thread,
  messages: await hydrateMessagesAttachmentPreviews(thread.messages, filesystemRoot),
});

export const groupPiThreads = (threads: readonly AgentThreadSummary[]): AgentThreadGroup[] => {
  return groupThreadSummariesByStartPath(threads);
};

export const isPiThreadInRoot = (thread: AgentThreadSummary, rootPath: string | undefined): boolean => {
  if (rootPath === undefined || rootPath === "") {
    return true;
  }

  return thread.startPath === rootPath || thread.startPath.startsWith(`${rootPath}/`);
};

const findJsonlFiles = async (root: string): Promise<string[]> => {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name);

    if (entry.isDirectory()) {
      return findJsonlFiles(path);
    }

    return entry.isFile() && entry.name.endsWith(".jsonl") ? [path] : [];
  }));

  return files.flat();
};

const loadPiSessionFile = async (path: string): Promise<PiSessionFile | null> => {
  try {
    const [content, fileStat] = await Promise.all([readFile(path, "utf8"), stat(path)]);
    const parsed = parsePiSessionContent(content);

    if (parsed === null) {
      return null;
    }

    return {
      path,
      ...parsed,
      modifiedAt: fileStat.mtimeMs,
    };
  } catch {
    return null;
  }
};

const parsePiSessionContent = (
  content: string,
): Pick<PiSessionFile, "header" | "entries"> | null => {
  const values = content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(parseJsonLine)
    .filter((value): value is Record<string, unknown> => value !== null);
  const header = values.find((value): value is PiSessionHeader =>
    value["type"] === "session" && typeof value["id"] === "string");

  if (header === undefined) {
    return null;
  }

  return {
    header,
    entries: values.filter(isPiSessionEntry),
  };
};

const parseJsonLine = (line: string): Record<string, unknown> | null => {
  try {
    const value = JSON.parse(line) as unknown;
    return asRecord(value) ?? null;
  } catch {
    return null;
  }
};

const isPiSessionEntry = (value: Record<string, unknown>): value is PiSessionEntry =>
  typeof value["type"] === "string" &&
  typeof value["id"] === "string" &&
  (typeof value["parentId"] === "string" || value["parentId"] === null);

const getActiveBranch = (session: PiSessionFile): readonly PiSessionEntry[] => {
  const byId = new Map(session.entries.map((entry) => [entry.id, entry]));
  const leaf = findLeafEntry(session.entries);
  const branch: PiSessionEntry[] = [];
  const seen = new Set<string>();
  let cursor: PiSessionEntry | undefined = leaf;

  while (cursor !== undefined && !seen.has(cursor.id)) {
    branch.push(cursor);
    seen.add(cursor.id);
    cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId);
  }

  return branch.reverse();
};

const findLeafEntry = (entries: readonly PiSessionEntry[]): PiSessionEntry | undefined => {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];

    if (entry?.type !== "label") {
      return entry;
    }
  }

  return entries.at(-1);
};

const mapPiEntryToAgentMessages = (entry: PiSessionEntry, path: string): AgentMessage[] => {
  if (entry.type === "message" && asRecord(entry["message"]) !== undefined) {
    return mapPiMessageEntry(entry as PiSessionMessageEntry, path);
  }

  if (entry.type === "custom_message") {
    return [{
      role: "custom",
      id: entry.id,
      timestamp: entryTimestamp(entry),
      tag: `pi:${typeof entry.customType === "string" ? entry.customType : "custom_message"}`,
      content: {
        entry,
      },
    }];
  }

  return [];
};

const mapPiMessageEntry = (entry: PiSessionMessageEntry, path: string): AgentMessage[] => {
  const message = entry.message;
  const role = message["role"];
  const timestamp = numberField(message, "timestamp") ?? entryTimestamp(entry);

  if (role === "user") {
    return [{
      role: "user",
      id: entry.id,
      timestamp,
      path,
      content: stripHeySnapContextContent(toAgentContent(message["content"])),
    }];
  }

  if (role === "assistant") {
    return [{
      role: "assistant",
      id: entry.id,
      timestamp,
      duration: 0,
      model: stringField(message, "model"),
      provider: stringField(message, "provider"),
      stopReason: toStopReason(stringField(message, "stopReason")),
      content: toAssistantContent(message["content"]),
      usage: toUsage(asRecord(message["usage"])),
      ...(typeof message["errorMessage"] === "string"
        ? { error: { message: message["errorMessage"], canRetry: false } }
        : {}),
    }];
  }

  if (role === "toolResult") {
    return [{
      role: "toolResult",
      id: entry.id,
      timestamp,
      toolName: stringField(message, "toolName") ?? "tool",
      toolCallId: stringField(message, "toolCallId") ?? entry.id,
      content: stripInlineDataFromToolResultContent(toAgentContent(message["content"])),
      details: message["details"],
      isError: booleanField(message, "isError") ?? false,
    }];
  }

  if (role === "custom") {
    return [{
      role: "custom",
      id: entry.id,
      timestamp,
      tag: `pi:${stringField(message, "customType") ?? "custom"}`,
      content: message,
    }];
  }

  return [];
};

const mapPiEntryToActivities = (entry: PiSessionEntry): AgentThreadActivity[] => {
  const createdAt = entryTimestamp(entry);

  if (entry.type === "message" && asRecord(entry["message"])?.["role"] === "bashExecution") {
    const message = asRecord(entry["message"]);
    const command = stringField(message, "command") ?? "Shell command";
    const output = stringField(message, "output");
    const exitCode = numberField(message, "exitCode");
    const failed = exitCode !== undefined && exitCode !== 0;

    return [{
      id: entry.id,
      kind: "tool.completed",
      tone: failed ? "error" : "tool",
      status: failed ? "failed" : "completed",
      title: command,
      summary: output,
      createdAt,
      payload: message,
    }];
  }

  if (entry.type === "compaction") {
    return [{
      id: entry.id,
      kind: "info",
      tone: "info",
      status: "completed",
      title: "Context compacted",
      summary: stringField(entry, "summary"),
      createdAt,
      payload: entry,
    }];
  }

  if (entry.type === "branch_summary") {
    return [{
      id: entry.id,
      kind: "info",
      tone: "info",
      status: "completed",
      title: "Branch summarized",
      summary: stringField(entry, "summary"),
      createdAt,
      payload: entry,
    }];
  }

  if (entry.type === "model_change") {
    return [{
      id: entry.id,
      kind: "info",
      tone: "info",
      status: "completed",
      title: "Model changed",
      summary: [stringField(entry, "provider"), stringField(entry, "modelId")].filter(Boolean).join("/"),
      createdAt,
      payload: entry,
    }];
  }

  if (entry.type === "thinking_level_change") {
    return [{
      id: entry.id,
      kind: "info",
      tone: "info",
      status: "completed",
      title: "Thinking changed",
      summary: stringField(entry, "thinkingLevel"),
      createdAt,
      payload: entry,
    }];
  }

  return [];
};

const toAgentContent = (value: unknown): AgentContent => {
  if (typeof value === "string") {
    const heysnapContext = extractHeySnapContext(value);
    const content = stripPiAttachmentPromptText(stripHeySnapContextText(value), heysnapContext);

    if (content.length > 0) {
      return [{
        type: "text",
        content,
        ...(heysnapContext === undefined ? {} : { metadata: { heysnapContext } }),
      }];
    }

    return heysnapContext === undefined ? [] : [{ type: "text", content: "", metadata: { heysnapContext } }];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((block): AgentContent[number][] => {
    const record = asRecord(block);

    if (record?.["type"] === "text") {
      const text = stringField(record, "text") ?? stringField(record, "content") ?? "";
      const heysnapContext = extractHeySnapContext(text);
      const content = stripPiAttachmentPromptText(stripHeySnapContextText(text), heysnapContext);

      return content.length > 0
        ? [{
          type: "text" as const,
          content,
          ...(heysnapContext === undefined ? {} : { metadata: { heysnapContext } }),
        }]
        : [];
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

    const heysnapContext = asRecord(block.metadata?.["heysnapContext"]) ?? extractHeySnapContext(block.content);
    const contentWithoutContext = stripPiAttachmentPromptText(stripHeySnapContextText(block.content), heysnapContext);
    if (contentWithoutContext.length > 0) {
      return [{ ...block, content: contentWithoutContext }];
    }

    return heysnapContext === undefined ? [] : [{ ...block, content: "" }];
  });

const stripInlineDataFromToolResultContent = (content: AgentContent): AgentContent =>
  content.map((block, index): AgentContent[number] => {
    if (block.type === "image") {
      return {
        type: "file",
        filename: toolResultImageFilename(block.mimeType, index),
        mimeType: block.mimeType,
        metadata: {
          ...(block.metadata ?? {}),
          inlineDataOmitted: true,
          inlineDataBytes: block.data.length,
        },
      };
    }

    if (block.type === "file" && block.data !== undefined) {
      return {
        ...block,
        data: undefined,
        metadata: {
          ...(block.metadata ?? {}),
          inlineDataOmitted: true,
          inlineDataBytes: block.data.length,
        },
      };
    }

    return block;
  });

const toolResultImageFilename = (mimeType: string, index: number): string => {
  const extension = mimeType.split("/")[1]?.split(";")[0]?.trim().toLowerCase();
  const safeExtension = extension !== undefined && /^[a-z0-9.+-]+$/u.test(extension)
    ? extension
    : "image";

  return `tool-result-image-${String(index + 1)}.${safeExtension}`;
};

const stripHeySnapContextText = (text: string): string =>
  text.replace(HEYSNAP_CONTEXT_PATTERN, "").trim();

const stripPiAttachmentPromptText = (
  text: string,
  heysnapContext: Record<string, unknown> | undefined,
): string => {
  if (!Array.isArray(heysnapContext?.["userAttachedFilePaths"])) {
    return text.trim();
  }

  return text
    .replace(PI_ATTACHED_TEXT_FILE_BLOCK_PATTERN, "\n")
    .replace(PI_ATTACHED_FILE_LINE_PATTERN, "\n")
    .trim();
};

const extractHeySnapContext = (text: string): Record<string, unknown> | undefined => {
  const contextText = HEYSNAP_CONTEXT_CAPTURE_PATTERN.exec(text)?.[1];

  if (contextText === undefined) {
    return undefined;
  }

  const attachedFilesText = USER_ATTACHED_FILES_CAPTURE_PATTERN.exec(contextText)?.[1];

  if (attachedFilesText === undefined) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(unescapeXmlText(attachedFilesText.trim())) as unknown;
    if (!Array.isArray(parsed)) {
      return undefined;
    }

    const userAttachedFilePaths = parsed.filter((path): path is string => typeof path === "string" && path.length > 0);
    return userAttachedFilePaths.length > 0 ? { userAttachedFilePaths } : undefined;
  } catch {
    return undefined;
  }
};

const unescapeXmlText = (text: string): string =>
  text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

const hydrateMessagesAttachmentPreviews = async (
  messages: readonly AgentMessage[],
  filesystemRoot: string,
): Promise<AgentMessage[]> => Promise.all(messages.map(async (message) => {
  if (message.role !== "user") {
    return message;
  }

  const attachedFilePaths = userAttachedFilePathsFromContent(message.content);
  const contentWithoutContext = stripHeySnapContextMetadata(message.content);

  if (attachedFilePaths.length === 0) {
    return contentWithoutContext === message.content ? message : { ...message, content: contentWithoutContext };
  }

  const attachmentPreviews = (
    await Promise.all(attachedFilePaths.map((filePath) => hydrateAttachmentPreview(filePath, filesystemRoot)))
  ).filter((block): block is AgentContent[number] => block !== undefined);

  if (attachmentPreviews.length === 0) {
    return contentWithoutContext === message.content ? message : { ...message, content: contentWithoutContext };
  }

  return {
    ...message,
    content: [...contentWithoutContext, ...attachmentPreviews],
  };
}));

const userAttachedFilePathsFromContent = (content: AgentContent): string[] => {
  const paths: string[] = [];

  for (const block of content) {
    if (block.type !== "text") {
      continue;
    }

    const context = asRecord(block.metadata?.["heysnapContext"]);
    const userAttachedFilePaths = context?.["userAttachedFilePaths"];

    if (!Array.isArray(userAttachedFilePaths)) {
      continue;
    }

    for (const path of userAttachedFilePaths) {
      if (typeof path === "string" && path.length > 0) {
        paths.push(path);
      }
    }
  }

  return paths;
};

const stripHeySnapContextMetadata = (content: AgentContent): AgentContent => {
  let changed = false;

  const nextContent = content.flatMap((block): AgentContent[number][] => {
    if (block.type !== "text" || block.metadata?.["heysnapContext"] === undefined) {
      return [block];
    }

    const { heysnapContext: _heysnapContext, ...metadata } = block.metadata;
    changed = true;
    if (block.content.length === 0 && Object.keys(metadata).length === 0) {
      return [];
    }

    return [{
      ...block,
      ...(Object.keys(metadata).length > 0 ? { metadata } : { metadata: undefined }),
    }];
  });

  return changed ? nextContent : content;
};

const hydrateAttachmentPreview = async (
  uploadPath: string,
  filesystemRoot: string,
): Promise<AgentContent[number] | undefined> => {
  const safePath = safeUserUploadPath(uploadPath, filesystemRoot);

  if (safePath === undefined) {
    return undefined;
  }

  try {
    const fileStat = await stat(safePath);

    if (!fileStat.isFile()) {
      return undefined;
    }

    const filename = basename(safePath);
    const mimeType = mimeTypeForPath(safePath);
    const metadata = { filename, savedPath: safePath, size: fileStat.size };

    if (mimeType.startsWith("image/") && fileStat.size <= MAX_IMAGE_PREVIEW_BYTES) {
      const data = await readFile(safePath, "base64");
      return {
        type: "image",
        data,
        mimeType,
        metadata,
      };
    }

    return {
      type: "file",
      filename,
      mimeType,
      metadata,
    };
  } catch {
    return undefined;
  }
};

const safeUserUploadPath = (uploadPath: string, filesystemRoot: string): string | undefined => {
  if (!isAbsolute(uploadPath)) {
    return undefined;
  }

  const root = resolve(filesystemRoot);
  const candidate = resolve(uploadPath);
  const relativePath = relative(root, candidate);

  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    return undefined;
  }

  if (!candidate.includes(`${sep}${USER_UPLOADS_DIRECTORY.split("/").join(sep)}${sep}`)) {
    return undefined;
  }

  return candidate;
};

const mimeTypeForPath = (filePath: string): string => {
  switch (extname(filePath).toLowerCase()) {
    case ".heic":
      return "image/heic";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".pdf":
      return "application/pdf";
    case ".csv":
      return "text/csv";
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case ".xls":
      return "application/vnd.ms-excel";
    case ".txt":
      return "text/plain";
    case ".json":
      return "application/json";
    default:
      return "application/octet-stream";
  }
};

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

const toUsage = (usage: Record<string, unknown> | undefined): Usage | undefined => {
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

const readSessionName = (entries: readonly PiSessionEntry[]): string | undefined => {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];

    if (entry?.type === "session_info" && typeof entry.name === "string" && entry.name.trim().length > 0) {
      return entry.name.trim();
    }
  }

  return undefined;
};

const firstUserMessageTitle = (entries: readonly PiSessionEntry[]): string | undefined => {
  for (const entry of entries) {
    const message = asRecord(entry["message"]);

    if (entry.type !== "message" || message?.["role"] !== "user") {
      continue;
    }

    const text = agentContentText(stripHeySnapContextContent(toAgentContent(message["content"])));
    const title = text.replace(/\s+/gu, " ").trim();

    if (title.length > 0) {
      return title.length > 80 ? `${title.slice(0, 77)}...` : title;
    }
  }

  return undefined;
};

const countUserMessages = (entries: readonly PiSessionEntry[]): number =>
  entries.filter((entry) => entry.type === "message" && asRecord(entry["message"])?.["role"] === "user").length;

const latestTimestamp = (entries: readonly PiSessionEntry[]): number | undefined => {
  const timestamps = entries
    .map((entry) => parseTimestamp(entry.timestamp))
    .filter((value): value is number => value !== undefined);

  return timestamps.length > 0 ? Math.max(...timestamps) : undefined;
};

const entryTimestamp = (entry: PiSessionEntry): number => parseTimestamp(entry.timestamp) ?? Date.now();

const parseTimestamp = (value: unknown): number | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const time = Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
};

const toHarnessPath = (cwd: string, filesystemRoot: string): string => {
  try {
    return toClientPath(filesystemRoot, cwd);
  } catch {
    return cwd;
  }
};

const agentContentText = (content: AgentContent): string =>
  content.flatMap((block) => block.type === "text" ? [block.content] : []).join(" ");

const toStopReason = (value: string | undefined): StopReason => {
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

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

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
