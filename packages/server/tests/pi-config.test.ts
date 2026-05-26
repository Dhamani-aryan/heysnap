import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SessionManager, type AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

import {
  ensurePiUserConfig,
  renderPiAnthropicGatewayBaseUrl,
  renderPiAuth,
  renderPiModels,
  renderPiSettings,
} from "../src/agent/harnesses/pi/config.js";
import { PiAgentHarness } from "../src/agent/harnesses/pi/pi-agent-harness.js";
import {
  branchPiSessionForEdit,
  formatHeySnapContext,
  PiLiveTurnMapper,
} from "../src/agent/harnesses/pi/pi-agent-harness.js";
import { PI_SYSTEM_PROMPT } from "../src/agent/harnesses/pi/system-prompt.js";
import type {
  AgentRuntimeEventBase,
  AgentRuntimeEventType,
  AgentRunEvent,
} from "../src/agent/types.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Pi user config", () => {
  it("renders managed Pi settings for cloud machine defaults", () => {
    expect(renderPiSettings()).toBe(`${JSON.stringify({
      defaultProvider: "anthropic",
      defaultModel: "claude-sonnet-4-6",
      defaultThinkingLevel: "medium",
      enabledModels: ["claude-sonnet-4-6", "claude-opus-4-7"],
      sessionDir: "sessions",
      enableInstallTelemetry: false,
      quietStartup: true,
      warnings: {
        anthropicExtraUsage: false,
      },
      compaction: {
        enabled: true,
        reserveTokens: 16384,
        keepRecentTokens: 20000,
      },
    }, null, 2)}\n`);
  });

  it("routes Anthropic through the gateway without adding v1 to the base URL", () => {
    expect(renderPiAnthropicGatewayBaseUrl("https://cloud.example.com/")).toBe(
      "https://cloud.example.com/llm/anthropic",
    );
    expect(JSON.parse(renderPiModels("https://cloud.example.com/"))).toEqual({
      providers: {
        anthropic: {
          baseUrl: "https://cloud.example.com/llm/anthropic",
          api: "anthropic-messages",
        },
      },
    });
  });

  it("writes Pi config, models, auth, and session directories for cloud machines", async () => {
    const home = await createTempRoot();
    await ensurePiUserConfig(cloudMachineEnv(home));

    expect(await readFile(join(home, ".pi", "agent", "settings.json"), "utf8"))
      .toBe(renderPiSettings());
    expect(await readFile(join(home, ".pi", "agent", "models.json"), "utf8"))
      .toBe(renderPiModels("https://cloud.example.com/llm/anthropic"));
    expect(await readFile(join(home, ".pi", "agent", "auth.json"), "utf8"))
      .toBe(renderPiAuth("!cat '/opt/ank1015/machine-token'"));
    expect(await readFile(join(home, ".pi", "agent", "SYSTEM.md"), "utf8"))
      .toBe(PI_SYSTEM_PROMPT);
    expect((await stat(join(home, ".pi"))).mode & 0o777).toBe(0o700);
    expect((await stat(join(home, ".pi", "agent"))).mode & 0o777).toBe(0o700);
    expect((await stat(join(home, ".pi", "agent", "sessions"))).mode & 0o777).toBe(0o700);
    expect((await stat(join(home, ".pi", "agent", "settings.json"))).mode & 0o777).toBe(0o600);
    expect((await stat(join(home, ".pi", "agent", "models.json"))).mode & 0o777).toBe(0o600);
    expect((await stat(join(home, ".pi", "agent", "auth.json"))).mode & 0o777).toBe(0o600);
    expect((await stat(join(home, ".pi", "agent", "SYSTEM.md"))).mode & 0o777).toBe(0o600);
  });

  it("does not write local Pi config when cloud machine env is absent", async () => {
    const home = await createTempRoot();
    await ensurePiUserConfig({ HOME: home });

    await expect(access(join(home, ".pi", "agent", "settings.json"))).rejects.toThrow();
  });

  it("lets Pi harness setup write explicit setup input", async () => {
    const home = await createTempRoot();
    const harness = new PiAgentHarness({ home, env: {} });

    await harness.setup({
      install: false,
      apiKey: "machine-token",
      baseUrl: "https://cloud.example.com",
      model: "claude-opus-4-7",
    });

    expect(await readFile(join(home, ".pi", "agent", "settings.json"), "utf8"))
      .toBe(renderPiSettings("claude-opus-4-7"));
    expect(await readFile(join(home, ".pi", "agent", "models.json"), "utf8"))
      .toBe(renderPiModels("https://cloud.example.com/llm/anthropic"));
    expect(await readFile(join(home, ".pi", "agent", "auth.json"), "utf8"))
      .toBe(renderPiAuth("machine-token"));
    expect(await readFile(join(home, ".pi", "agent", "SYSTEM.md"), "utf8"))
      .toBe(PI_SYSTEM_PROMPT);
  });

  it("uses the machine token file for Pi harness setup when apiKey is omitted", async () => {
    const home = await createTempRoot();
    const harness = new PiAgentHarness({
      home,
      env: {
        ANK1015_MACHINE_TOKEN_FILE: "/opt/ank1015/machine-token",
      },
    });

    await harness.setup({
      install: false,
      baseUrl: "https://cloud.example.com/llm/anthropic",
      model: "claude-sonnet-4-6",
    });

    expect(await readFile(join(home, ".pi", "agent", "auth.json"), "utf8"))
      .toBe(renderPiAuth("!cat '/opt/ank1015/machine-token'"));
  });

  it("lists Pi sessions as grouped agent thread summaries", async () => {
    const home = await createTempRoot();
    const root = join(home, "Desktop");
    const appPath = join(root, "app");
    const notesPath = join(root, "notes");
    await writePiSession(home, "--Desktop-app--", "session-a.jsonl", [
      {
        type: "session",
        version: 3,
        id: "pi-session-a",
        timestamp: "2026-05-26T10:00:00.000Z",
        cwd: appPath,
      },
      {
        type: "message",
        id: "u1",
        parentId: null,
        timestamp: "2026-05-26T10:00:01.000Z",
        message: { role: "user", content: "Build the thing", timestamp: Date.parse("2026-05-26T10:00:01.000Z") },
      },
      {
        type: "message",
        id: "a1",
        parentId: "u1",
        timestamp: "2026-05-26T10:00:02.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Done" }],
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          stopReason: "stop",
          timestamp: Date.parse("2026-05-26T10:00:02.000Z"),
        },
      },
      {
        type: "session_info",
        id: "n1",
        parentId: "a1",
        timestamp: "2026-05-26T10:00:03.000Z",
        name: "Project setup",
      },
    ]);
    await writePiSession(home, "--Desktop-notes--", "session-b.jsonl", [
      {
        type: "session",
        version: 3,
        id: "pi-session-b",
        timestamp: "2026-05-26T09:00:00.000Z",
        cwd: notesPath,
      },
      {
        type: "message",
        id: "u2",
        parentId: null,
        timestamp: "2026-05-26T09:00:01.000Z",
        message: { role: "user", content: "Summarize notes" },
      },
    ]);
    const harness = new PiAgentHarness({ filesystemRoot: root, home });

    await expect(harness.retrieveThreads({ rootPath: "app" })).resolves.toEqual({
      groups: [
        {
          path: "app",
          threads: [
            {
              id: "pi-session-a",
              title: "Project setup",
              startPath: "app",
              lastPath: "app",
              createdAt: Date.parse("2026-05-26T10:00:00.000Z"),
              updatedAt: Date.parse("2026-05-26T10:00:03.000Z"),
              messageCount: 1,
            },
          ],
        },
      ],
    });

    const allThreads = await harness.retrieveThreads();
    expect(allThreads.groups.map((group) => group.path)).toEqual(["app", "notes"]);
  });

  it("gets a Pi session mapped to an agent thread on the active branch", async () => {
    const home = await createTempRoot();
    const root = join(home, "Desktop");
    const appPath = join(root, "app");
    await writePiSession(home, "--Desktop-app--", "session-thread.jsonl", [
      {
        type: "session",
        version: 3,
        id: "pi-thread",
        timestamp: "2026-05-26T11:00:00.000Z",
        cwd: appPath,
      },
      {
        type: "message",
        id: "u1",
        parentId: null,
        timestamp: "2026-05-26T11:00:01.000Z",
        message: {
          role: "user",
          content: [
            { type: "text", text: "Run tests" },
            { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
          ],
        },
      },
      {
        type: "message",
        id: "a1",
        parentId: "u1",
        timestamp: "2026-05-26T11:00:02.000Z",
        message: {
          role: "assistant",
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          stopReason: "toolUse",
          timestamp: Date.parse("2026-05-26T11:00:02.000Z"),
          usage: {
            input: 10,
            output: 5,
            cacheRead: 2,
            cacheWrite: 3,
            totalTokens: 20,
            cost: { input: 0.1, output: 0.2, cacheRead: 0.01, cacheWrite: 0.02, total: 0.33 },
          },
          content: [
            { type: "thinking", thinking: "Need to inspect package scripts." },
            { type: "text", text: "I will run tests." },
            { type: "toolCall", id: "call_1", name: "bash", arguments: { command: "pnpm test" } },
          ],
        },
      },
      {
        type: "message",
        id: "t1",
        parentId: "a1",
        timestamp: "2026-05-26T11:00:03.000Z",
        message: {
          role: "toolResult",
          toolCallId: "call_1",
          toolName: "bash",
          content: [{ type: "text", text: "passed" }],
          isError: false,
          details: { exitCode: 0 },
        },
      },
      {
        type: "message",
        id: "u-old-branch",
        parentId: "a1",
        timestamp: "2026-05-26T11:00:04.000Z",
        message: { role: "user", content: "Abandoned branch" },
      },
      {
        type: "model_change",
        id: "m1",
        parentId: "t1",
        timestamp: "2026-05-26T11:00:05.000Z",
        provider: "anthropic",
        modelId: "claude-opus-4-7",
      },
      {
        type: "compaction",
        id: "c1",
        parentId: "m1",
        timestamp: "2026-05-26T11:00:06.000Z",
        summary: "Earlier testing context was compacted.",
        firstKeptEntryId: "t1",
        tokensBefore: 50000,
      },
    ]);
    const harness = new PiAgentHarness({ filesystemRoot: root, home });

    const thread = await harness.getThread({ threadId: "pi-thread" });

    expect(thread).toMatchObject({
      id: "pi-thread",
      title: "Run tests",
      startPath: "app",
      lastPath: "app",
      createdAt: Date.parse("2026-05-26T11:00:00.000Z"),
      updatedAt: Date.parse("2026-05-26T11:00:06.000Z"),
      messageCount: 1,
    });
    expect(thread.messages).toEqual([
      {
        role: "user",
        id: "u1",
        timestamp: Date.parse("2026-05-26T11:00:01.000Z"),
        path: "app",
        content: [
          { type: "text", content: "Run tests" },
          { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
        ],
      },
      {
        role: "assistant",
        id: "a1",
        timestamp: Date.parse("2026-05-26T11:00:02.000Z"),
        duration: 0,
        model: "claude-sonnet-4-6",
        provider: "anthropic",
        stopReason: "toolUse",
        content: [
          { type: "thinking", thinkingText: "Need to inspect package scripts." },
          { type: "response", response: [{ type: "text", content: "I will run tests." }] },
          { type: "toolCall", name: "bash", arguments: { command: "pnpm test" }, toolCallId: "call_1" },
        ],
        usage: {
          input: 10,
          output: 5,
          cacheRead: 2,
          cacheWrite: 3,
          totalTokens: 20,
          cost: { input: 0.1, output: 0.2, cacheRead: 0.01, cacheWrite: 0.02, total: 0.33 },
        },
      },
      {
        role: "toolResult",
        id: "t1",
        timestamp: Date.parse("2026-05-26T11:00:03.000Z"),
        toolName: "bash",
        toolCallId: "call_1",
        content: [{ type: "text", content: "passed" }],
        details: { exitCode: 0 },
        isError: false,
      },
    ]);
    expect(thread.activities).toEqual([
      {
        id: "m1",
        kind: "info",
        tone: "info",
        status: "completed",
        title: "Model changed",
        summary: "anthropic/claude-opus-4-7",
        createdAt: Date.parse("2026-05-26T11:00:05.000Z"),
        payload: {
          type: "model_change",
          id: "m1",
          parentId: "t1",
          timestamp: "2026-05-26T11:00:05.000Z",
          provider: "anthropic",
          modelId: "claude-opus-4-7",
        },
      },
      {
        id: "c1",
        kind: "info",
        tone: "info",
        status: "completed",
        title: "Context compacted",
        summary: "Earlier testing context was compacted.",
        createdAt: Date.parse("2026-05-26T11:00:06.000Z"),
        payload: {
          type: "compaction",
          id: "c1",
          parentId: "m1",
          timestamp: "2026-05-26T11:00:06.000Z",
          summary: "Earlier testing context was compacted.",
          firstKeptEntryId: "t1",
          tokensBefore: 50000,
        },
      },
    ]);
  });

  it("strips HeySnap UI context from displayed Pi user messages", async () => {
    const home = await createTempRoot();
    const root = join(home, "Desktop");
    const appPath = join(root, "app");
    const context = formatHeySnapContext({
      filesystemRoot: root,
      path: "app",
      uiContext: {
        openFiles: [
          { path: "app/src/index.ts", isFocused: true },
          { path: "chrome", isFocused: false },
        ],
      },
      userAttachedFilePaths: [join(appPath, ".codex", "user_uploads", "upload.txt")],
    });
    await writePiSession(home, "--Desktop-app--", "session-context.jsonl", [
      {
        type: "session",
        version: 3,
        id: "pi-context-thread",
        timestamp: "2026-05-26T12:00:00.000Z",
        cwd: appPath,
      },
      {
        type: "message",
        id: "u1",
        parentId: null,
        timestamp: "2026-05-26T12:00:01.000Z",
        message: {
          role: "user",
          content: [{ type: "text", text: `Hello\n\n${context}` }],
          timestamp: Date.parse("2026-05-26T12:00:01.000Z"),
        },
      },
    ]);
    const harness = new PiAgentHarness({ filesystemRoot: root, home });

    const thread = await harness.getThread({ threadId: "pi-context-thread" });
    const groups = await harness.retrieveThreads();

    expect(thread.title).toBe("Hello");
    expect(thread.messages).toEqual([
      {
        role: "user",
        id: "u1",
        timestamp: Date.parse("2026-05-26T12:00:01.000Z"),
        path: "app",
        content: [{ type: "text", content: "Hello" }],
      },
    ]);
    expect(groups.groups.flatMap((group) => group.threads).find((thread) => thread.id === "pi-context-thread")?.title)
      .toBe("Hello");
    expect(context).toContain("<heysnap_context>");
    expect(context).toContain(`${root}/app/src/index.ts`);
    expect(context).toContain("\"filepath\": \"chrome\"");
  });

  it("branches before the latest user message when editing a Pi turn", async () => {
    const home = await createTempRoot();
    const sessionManager = SessionManager.create(join(home, "app"), join(home, ".pi", "agent", "sessions"));
    const firstUserId = appendPiUserMessage(sessionManager, "First prompt");
    const firstAssistantId = appendPiAssistantMessage(sessionManager, "First response");
    const secondUserId = appendPiUserMessage(sessionManager, "Second prompt");
    appendPiAssistantMessage(sessionManager, "Second response");

    branchPiSessionForEdit(sessionManager, 1);

    expect(sessionManager.getLeafId()).toBe(firstAssistantId);

    const editedUserId = appendPiUserMessage(sessionManager, "Edited second prompt");

    expect(sessionManager.getBranch().map((entry) => entry.id)).toEqual([
      firstUserId,
      firstAssistantId,
      editedUserId,
    ]);
    expect(sessionManager.getEntry(secondUserId)).toBeDefined();
  });

  it("resets the Pi leaf when editing the root user message", async () => {
    const home = await createTempRoot();
    const sessionManager = SessionManager.create(join(home, "app"), join(home, ".pi", "agent", "sessions"));
    const firstUserId = appendPiUserMessage(sessionManager, "First prompt");
    appendPiAssistantMessage(sessionManager, "First response");

    branchPiSessionForEdit(sessionManager, 1);

    expect(sessionManager.getLeafId()).toBeNull();

    const editedUserId = appendPiUserMessage(sessionManager, "Edited first prompt");

    expect(sessionManager.getBranch().map((entry) => entry.id)).toEqual([editedUserId]);
    expect(sessionManager.getEntry(firstUserId)).toBeDefined();
  });

  it("can branch back multiple user turns for Pi edit rollbacks", async () => {
    const home = await createTempRoot();
    const sessionManager = SessionManager.create(join(home, "app"), join(home, ".pi", "agent", "sessions"));
    appendPiUserMessage(sessionManager, "First prompt");
    appendPiAssistantMessage(sessionManager, "First response");
    appendPiUserMessage(sessionManager, "Second prompt");
    appendPiAssistantMessage(sessionManager, "Second response");

    branchPiSessionForEdit(sessionManager, 2);

    expect(sessionManager.getLeafId()).toBeNull();
  });

  it("keeps retrying Pi stream errors alive as reconnect warnings", () => {
    let turnCompletedCount = 0;
    const mapper = createPiLiveTurnMapper(() => {
      turnCompletedCount += 1;
    });
    const retryError = createPiAssistantMessage({
      stopReason: "error",
      errorMessage: "stream ended before message_stop",
      timestamp: 1,
    });
    const success = createPiAssistantMessage({
      stopReason: "stop",
      text: "Recovered",
      timestamp: 2,
    });
    const events = [
      ...mapper.handle({ type: "message_start", message: retryError } as AgentSessionEvent),
      ...mapper.handle({ type: "message_end", message: retryError } as AgentSessionEvent),
      ...mapper.handle({ type: "turn_end", message: retryError, toolResults: [] } as AgentSessionEvent),
      ...mapper.handle({ type: "agent_end", messages: [retryError], willRetry: true } as AgentSessionEvent),
      ...mapper.handle({
        type: "auto_retry_start",
        attempt: 1,
        maxAttempts: 3,
        delayMs: 2000,
        errorMessage: "stream ended before message_stop",
      }),
      ...mapper.handle({ type: "message_start", message: success } as AgentSessionEvent),
      ...mapper.handle({
        type: "message_update",
        message: success,
        assistantMessageEvent: {
          type: "text_delta",
          contentIndex: 0,
          delta: "Recovered",
          partial: success,
        },
      } as AgentSessionEvent),
      ...mapper.handle({ type: "message_end", message: success } as AgentSessionEvent),
      ...mapper.handle({ type: "turn_end", message: success, toolResults: [] } as AgentSessionEvent),
    ];

    expect(events.map((event) => event.type)).toEqual([
      "runtime.warning",
      "message.started",
      "content.delta",
      "message.completed",
      "turn.completed",
    ]);
    expect(events[0]).toMatchObject({
      type: "runtime.warning",
      warning: {
        phase: "model",
        message: "Pi retry 1/3: stream ended before message_stop",
        canRetry: true,
        attempts: 1,
      },
    });
    expect(events.some((event) => event.type === "runtime.error")).toBe(false);
    expect(events.find((event) => event.type === "turn.completed")).toMatchObject({
      status: "completed",
    });
    expect(turnCompletedCount).toBe(1);
  });

  it("flushes Pi stream errors when no retry will happen", () => {
    let turnCompletedCount = 0;
    const mapper = createPiLiveTurnMapper(() => {
      turnCompletedCount += 1;
    });
    const finalError = createPiAssistantMessage({
      stopReason: "error",
      errorMessage: "429 rate limit",
      timestamp: 1,
    });
    const events = [
      ...mapper.handle({ type: "message_start", message: finalError } as AgentSessionEvent),
      ...mapper.handle({ type: "message_end", message: finalError } as AgentSessionEvent),
      ...mapper.handle({ type: "turn_end", message: finalError, toolResults: [] } as AgentSessionEvent),
      ...mapper.handle({ type: "agent_end", messages: [finalError], willRetry: false } as AgentSessionEvent),
    ];

    expect(events.map((event) => event.type)).toEqual([
      "message.started",
      "message.completed",
      "turn.completed",
    ]);
    expect(events[2]).toMatchObject({
      type: "turn.completed",
      status: "failed",
      error: {
        phase: "model",
        message: "429 rate limit",
        canRetry: true,
      },
    });
    expect(turnCompletedCount).toBe(1);
  });

  it("maps live Pi compaction events to context compaction items", () => {
    const mapper = createPiLiveTurnMapper(() => {});
    const events = [
      ...mapper.handle({
        type: "compaction_start",
        reason: "threshold",
      }),
      ...mapper.handle({
        type: "compaction_end",
        reason: "threshold",
        result: {
          summary: "Earlier work was summarized.",
          firstKeptEntryId: "kept-1",
          tokensBefore: 120000,
          details: { files: ["src/app.ts"] },
        },
        aborted: false,
        willRetry: false,
      }),
    ];

    expect(events).toEqual([
      expect.objectContaining({
        type: "item.started",
        item: expect.objectContaining({
          id: "pi-turn:compaction",
          itemType: "context_compaction",
          status: "running",
          title: "Context compacted",
          summary: "Compacting conversation and continuing",
        }),
      }),
      expect.objectContaining({
        type: "item.completed",
        item: expect.objectContaining({
          id: "pi-turn:compaction",
          itemType: "context_compaction",
          status: "completed",
          title: "Context compacted",
          summary: "Earlier work was summarized.",
          result: expect.objectContaining({
            summary: "Earlier work was summarized.",
            firstKeptEntryId: "kept-1",
            tokensBefore: 120000,
          }),
          isError: false,
          raw: expect.objectContaining({
            type: "compaction_end",
            reason: "threshold",
          }),
        }),
      }),
    ]);
  });

  it("maps failed Pi compaction events to failed context compaction items", () => {
    const mapper = createPiLiveTurnMapper(() => {});
    const events = mapper.handle({
      type: "compaction_end",
      reason: "overflow",
      result: undefined,
      aborted: false,
      willRetry: false,
      errorMessage: "Compaction model quota exceeded",
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "item.completed",
        item: expect.objectContaining({
          id: "pi-turn:compaction",
          itemType: "context_compaction",
          status: "failed",
          title: "Context compacted",
          summary: "Compaction model quota exceeded",
          isError: true,
        }),
      }),
    ]);
  });

  it("throws when a Pi thread is missing", async () => {
    const home = await createTempRoot();
    const harness = new PiAgentHarness({ home });

    await expect(harness.getThread({ threadId: "missing" })).rejects.toThrow("Pi thread not found.");
  });
});

const createTempRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "ank1015-pi-config-"));
  tempRoots.push(root);
  return root;
};

const cloudMachineEnv = (home: string): NodeJS.ProcessEnv => ({
  HOME: home,
  CLOUD_SERVER_PUBLIC_URL: "https://cloud.example.com",
  ANK1015_MACHINE_TOKEN_FILE: "/opt/ank1015/machine-token",
});

const writePiSession = async (
  home: string,
  encodedCwd: string,
  filename: string,
  entries: readonly Record<string, unknown>[],
): Promise<void> => {
  const dir = join(home, ".pi", "agent", "sessions", encodedCwd);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, filename), `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
};

const appendPiUserMessage = (sessionManager: SessionManager, content: string): string =>
  sessionManager.appendMessage({
    role: "user",
    content,
    timestamp: Date.now(),
  });

const appendPiAssistantMessage = (sessionManager: SessionManager, content: string): string =>
  sessionManager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: content }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    usage: emptyPiUsage(),
    stopReason: "stop",
    timestamp: Date.now(),
  });

const emptyPiUsage = () => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
});

const createPiLiveTurnMapper = (onTurnCompleted: () => void): PiLiveTurnMapper => {
  let sequence = 0;

  return new PiLiveTurnMapper({
    runId: "pi-run",
    threadId: "pi-thread",
    turnId: "pi-turn",
    path: "app",
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
      runId: "pi-run",
      threadId: "pi-thread",
      turnId: "pi-turn",
      sequence: ++sequence,
      createdAt: options.createdAt ?? 1,
      provider: "pi",
      providerRefs: {
        providerThreadId: "pi-thread",
        providerTurnId: "pi-turn",
        ...(options.providerItemId !== undefined ? { providerItemId: options.providerItemId } : {}),
        ...(options.providerRequestId !== undefined ? { providerRequestId: options.providerRequestId } : {}),
      },
    }),
    onTurnCompleted,
  });
};

const createPiAssistantMessage = (input: {
  readonly stopReason: "stop" | "error";
  readonly text?: string;
  readonly errorMessage?: string;
  readonly timestamp: number;
}): Record<string, unknown> => ({
  role: "assistant",
  content: input.text === undefined ? [] : [{ type: "text", text: input.text }],
  api: "anthropic-messages",
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  usage: emptyPiUsage(),
  stopReason: input.stopReason,
  ...(input.errorMessage !== undefined ? { errorMessage: input.errorMessage } : {}),
  timestamp: input.timestamp,
});
