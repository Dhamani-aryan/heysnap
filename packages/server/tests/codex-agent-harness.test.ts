import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CodexAgentHarness } from "../src/agent/harnesses/codex/codex-agent-harness.js";
import {
  CodexStdioAppServerClient,
  resolveCodexAppServerEnv,
  type CodexAppServerClient,
  type CodexAppServerNotification,
} from "../src/agent/harnesses/codex/app-server-client.js";
import type { AgentContent } from "../src/agent/types.js";

describe("codex agent harness", () => {
  it("sets up Codex with opinionated Azure OpenAI provider config", async () => {
    const previous = process.env.AZURE_OPENAI_API_KEY;
    delete process.env.AZURE_OPENAI_API_KEY;
    const client = new FakeCodexClient({});
    const harness = new CodexAgentHarness({
      filesystemRoot: "/workspace/Desktop",
      client,
    });

    try {
      await harness.setup({
        apiKey: "azure-key",
        baseUrl: "https://example.openai.azure.com/openai",
        model: "gpt-5.3-codex",
        install: false,
      });

      expect(process.env.AZURE_OPENAI_API_KEY).toBe("azure-key");
      expect(client.closedCount).toBe(1);
      expect(client.requests).toEqual([
        {
          method: "config/batchWrite",
          params: {
            edits: [
              {
                keyPath: "model_provider",
                value: "azure",
                mergeStrategy: "replace",
              },
              {
                keyPath: "model",
                value: "gpt-5.3-codex",
                mergeStrategy: "replace",
              },
              {
                keyPath: "model_providers.azure",
                value: {
                  name: "Azure",
                  base_url: "https://example.openai.azure.com/openai",
                  wire_api: "responses",
                  query_params: {
                    "api-version": "2025-04-01-preview",
                  },
                  env_key: "AZURE_OPENAI_API_KEY",
                  env_key_instructions: "Set AZURE_OPENAI_API_KEY in the server environment",
                  supports_websockets: false,
                },
                mergeStrategy: "upsert",
              },
            ],
            reloadUserConfig: true,
          },
        },
      ]);
    } finally {
      if (previous === undefined) {
        delete process.env.AZURE_OPENAI_API_KEY;
      } else {
        process.env.AZURE_OPENAI_API_KEY = previous;
      }
    }
  });

  it("retrieves Codex history threads and maps them into grouped harness summaries", async () => {
    const projectListThread = createCodexThread({
      id: "thread-project",
      name: "Named project thread",
      preview: "Ignored preview",
      cwd: "/workspace/Desktop/Projects/app",
      createdAt: 10,
      updatedAt: 20,
      status: { type: "active", activeFlags: ["turn"] },
    });
    const externalListThread = createCodexThread({
      id: "thread-external",
      name: null,
      preview: "External preview",
      cwd: "/tmp/outside",
      createdAt: 12,
      updatedAt: 30,
    });
    const client = new FakeCodexClient((method, params) => {
      if (method === "thread/list") {
        return {
          data: [projectListThread, externalListThread],
        };
      }

      if (method === "thread/read") {
        const threadId = (params as { readonly threadId: string }).threadId;
        return {
          thread: createCodexThread({
            ...(threadId === "thread-project" ? projectListThread : externalListThread),
            turns: threadId === "thread-project"
              ? [createUserTurn("project-turn-1"), createUserTurn("project-turn-2")]
              : [createUserTurn("external-turn-1")],
          }),
        };
      }

      throw new Error(`Unexpected method ${method}`);
    });
    const harness = new CodexAgentHarness({
      filesystemRoot: "/workspace/Desktop",
      client,
    });

    const result = await harness.retrieveThreads({ limit: 10 });

    expect(client.requests).toEqual([
      {
        method: "thread/list",
        params: {
          limit: 10,
          sortKey: "updated_at",
          sortDirection: "desc",
          sourceKinds: ["appServer", "vscode"],
        },
      },
      {
        method: "thread/read",
        params: {
          threadId: "thread-external",
          includeTurns: true,
        },
      },
      {
        method: "thread/read",
        params: {
          threadId: "thread-project",
          includeTurns: true,
        },
      },
    ]);
    expect(result.groups).toEqual([
      {
        path: "/tmp/outside",
        threads: [
          {
            id: "thread-external",
            title: "External preview",
            startPath: "/tmp/outside",
            lastPath: "/tmp/outside",
            createdAt: 12000,
            updatedAt: 30000,
            messageCount: 1,
          },
        ],
      },
      {
        path: "Projects/app",
        threads: [
          {
            id: "thread-project",
            title: "Named project thread",
            startPath: "Projects/app",
            lastPath: "Projects/app",
            createdAt: 10000,
            updatedAt: 20000,
            messageCount: 2,
            isStreaming: true,
          },
        ],
      },
    ]);
  });

  it("does not mark non-active Codex thread statuses as streaming", async () => {
    const client = new FakeCodexClient((method) => {
      if (method === "thread/list") {
        return {
          data: [
            createCodexThread({
              id: "thread-idle",
              preview: "Idle thread",
              cwd: "/workspace/Desktop/Projects/app",
              updatedAt: 30,
              status: { type: "idle" },
            }),
            createCodexThread({
              id: "thread-not-loaded",
              preview: "Not loaded thread",
              cwd: "/workspace/Desktop/Projects/app",
              updatedAt: 20,
              status: { type: "notLoaded" },
            }),
            createCodexThread({
              id: "thread-system-error",
              preview: "System error thread",
              cwd: "/workspace/Desktop/Projects/app",
              updatedAt: 10,
              status: { type: "systemError" },
            }),
          ],
        };
      }

      if (method === "thread/read") {
        return { thread: createCodexThread({ id: "thread-read", preview: "Thread", cwd: "/workspace/Desktop/Projects/app", updatedAt: 1 }) };
      }

      throw new Error(`Unexpected method ${method}`);
    });
    const harness = new CodexAgentHarness({
      filesystemRoot: "/workspace/Desktop",
      client,
    });

    const result = await harness.retrieveThreads({ limit: 10 });
    const threads = result.groups.flatMap((group) => group.threads);

    expect(threads).toHaveLength(3);
    expect(threads.every((thread) => thread.isStreaming !== true)).toBe(true);
  });

  it("uses user message counts already present on populated Codex thread summaries", async () => {
    const client = new FakeCodexClient({
      data: [
        createCodexThread({
          id: "thread-project",
          name: "Named project thread",
          preview: "Ignored preview",
          cwd: "/workspace/Desktop/Projects/app",
          createdAt: 10,
          updatedAt: 20,
          turns: [createUserTurn("project-turn-1"), createUserTurn("project-turn-2")],
        }),
      ],
    });
    const harness = new CodexAgentHarness({
      filesystemRoot: "/workspace/Desktop",
      client,
    });

    const result = await harness.retrieveThreads({ limit: 10 });

    expect(client.requests).toEqual([
      {
        method: "thread/list",
        params: {
          limit: 10,
          sortKey: "updated_at",
          sortDirection: "desc",
          sourceKinds: ["appServer", "vscode"],
        },
      },
    ]);
    expect(result.groups).toEqual([
      {
        path: "Projects/app",
        threads: [
          {
            id: "thread-project",
            title: "Named project thread",
            startPath: "Projects/app",
            lastPath: "Projects/app",
            createdAt: 10000,
            updatedAt: 20000,
            messageCount: 2,
          },
        ],
      },
    ]);
  });

  it("keeps only ank1015 app originator threads from the Codex app-server history candidates", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "ank1015-codex-history-"));

    try {
      const ownThreadPath = join(tempDir, "own.jsonl");
      const vscodeThreadPath = join(tempDir, "vscode.jsonl");
      await writeFile(ownThreadPath, `${JSON.stringify({
        type: "session_meta",
        payload: { originator: "ank1015_app" },
      })}\n`);
      await writeFile(vscodeThreadPath, `${JSON.stringify({
        type: "session_meta",
        payload: { originator: "codex_vscode" },
      })}\n`);
      const client = new FakeCodexClient({
        data: [
          createCodexThread({
            id: "own-vscode-thread",
            preview: "Own app thread",
            cwd: "/workspace/Desktop/Projects/app",
            path: ownThreadPath,
            source: "vscode",
            updatedAt: 20,
            turns: [createUserTurn("own-turn")],
          }),
          createCodexThread({
            id: "codex-vscode-thread",
            preview: "VS Code thread",
            cwd: "/workspace/Desktop/Projects/app",
            path: vscodeThreadPath,
            source: "vscode",
            updatedAt: 30,
            turns: [createUserTurn("vscode-turn")],
          }),
        ],
      });
      const harness = new CodexAgentHarness({
        filesystemRoot: "/workspace/Desktop",
        client,
      });

      const result = await harness.retrieveThreads({ limit: 10 });

      expect(result.groups).toEqual([
        {
          path: "Projects/app",
          threads: [
            expect.objectContaining({
              id: "own-vscode-thread",
              title: "Own app thread",
            }),
          ],
        },
      ]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("filters grouped threads by root path and applies the requested limit", async () => {
    const listThreads = [
      createCodexThread({
        id: "new-project-thread",
        preview: "New project thread",
        cwd: "/workspace/Desktop/Projects/new",
        updatedAt: 30,
      }),
      createCodexThread({
        id: "old-project-thread",
        preview: "Old project thread",
        cwd: "/workspace/Desktop/Projects/old",
        updatedAt: 10,
      }),
      createCodexThread({
        id: "notes-thread",
        preview: "Notes thread",
        cwd: "/workspace/Desktop/Notes",
        updatedAt: 40,
      }),
    ];
    const client = new FakeCodexClient((method, params) => {
      if (method === "thread/list") {
        return { data: listThreads };
      }

      if (method === "thread/read") {
        const threadId = (params as { readonly threadId: string }).threadId;
        const thread = listThreads.find((candidate) => candidate.id === threadId);
        return {
          thread: createCodexThread({
            ...thread,
            turns: [createUserTurn("new-turn-1"), createUserTurn("new-turn-2"), createUserTurn("new-turn-3")],
          }),
        };
      }

      throw new Error(`Unexpected method ${method}`);
    });
    const harness = new CodexAgentHarness({
      filesystemRoot: "/workspace/Desktop",
      client,
    });

    const result = await harness.retrieveThreads({ rootPath: "Projects", limit: 1 });

    expect(result.groups).toEqual([
      {
        path: "Projects/new",
        threads: [
          expect.objectContaining({
            id: "new-project-thread",
            title: "New project thread",
            updatedAt: 30000,
            messageCount: 3,
          }),
        ],
      },
    ]);
    expect(client.requests).toEqual([
      {
        method: "thread/list",
        params: {
          limit: 1,
          sortKey: "updated_at",
          sortDirection: "desc",
          sourceKinds: ["appServer", "vscode"],
        },
      },
      {
        method: "thread/read",
        params: {
          threadId: "new-project-thread",
          includeTurns: true,
        },
      },
    ]);
  });

  it("reads a Codex thread and maps turn items into harness messages", async () => {
    const codexThread = createCodexThread({
      id: "thread-1",
      name: "Mapped thread",
      preview: "Ignored preview",
      cwd: "/workspace/Desktop/Projects/app",
      modelProvider: "openai",
      createdAt: 10,
      updatedAt: 20,
      turns: [
        {
          id: "turn-1",
          status: "completed",
          startedAt: 11,
          completedAt: 19,
          durationMs: 8000,
          items: [
            {
              type: "userMessage",
              id: "user-1",
              content: [
                { type: "text", text: "Run tests", textElements: [{ kind: "plain" }] },
                { type: "localImage", path: "/tmp/screenshot.png" },
              ],
            },
            {
              type: "agentMessage",
              id: "assistant-status",
              text: "I will run the focused test.",
              phase: "commentary",
              memoryCitation: {
                entries: [{ path: "MEMORY.md", lineStart: 1, lineEnd: 2, note: "test" }],
                threadIds: ["memory-thread"],
              },
            },
            {
              type: "reasoning",
              id: "reasoning-1",
              summary: ["Checked the test surface."],
              content: ["Need one focused assertion."],
            },
            {
              type: "commandExecution",
              id: "cmd-1",
              command: "pnpm test",
              cwd: "/workspace/Desktop/Projects/app",
              status: "completed",
              commandActions: [],
              aggregatedOutput: "PASS tests",
              exitCode: 0,
              durationMs: 100,
            },
            {
              type: "fileChange",
              id: "patch-1",
              status: "completed",
              changes: [
                {
                  path: "/workspace/Desktop/Projects/app/src/index.ts",
                  kind: "update",
                  diff: "@@ -1 +1 @@\n-old\n+new",
                },
              ],
            },
            {
              type: "mcpToolCall",
              id: "mcp-1",
              server: "github",
              tool: "pull_request/read",
              status: "failed",
              arguments: { number: 1 },
              result: null,
              error: { message: "Not found", name: "NotFoundError" },
            },
            {
              type: "dynamicToolCall",
              id: "dynamic-1",
              namespace: "browser",
              tool: "snapshot",
              status: "completed",
              arguments: { tab: "main" },
              contentItems: [{ type: "text", text: "Loaded" }],
              success: true,
              durationMs: 50,
            },
            {
              type: "agentMessage",
              id: "assistant-final",
              text: "The focused test passed.",
              phase: "final_answer",
            },
            {
              type: "webSearch",
              id: "search-1",
              query: "Codex app server",
              action: { type: "search", query: "Codex app server" },
            },
          ],
        },
        {
          id: "turn-2",
          status: "failed",
          startedAt: 21,
          items: [],
          error: { message: "Context window exceeded", codexErrorInfo: { type: "ContextWindowExceeded" } },
        },
      ],
    });
    const client = new FakeCodexClient({ thread: codexThread });
    const harness = new CodexAgentHarness({
      filesystemRoot: "/workspace/Desktop",
      client,
    });

    const thread = await harness.getThread({ threadId: "thread-1" });

    expect(client.requests).toEqual([
      {
        method: "thread/read",
        params: {
          threadId: "thread-1",
          includeTurns: true,
        },
      },
    ]);
    expect(thread).toMatchObject({
      id: "thread-1",
      title: "Mapped thread",
      startPath: "Projects/app",
      lastPath: "Projects/app",
      createdAt: 10000,
      updatedAt: 20000,
      messageCount: 1,
    });
    expect(thread.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "assistant",
    ]);
    expect(thread.activities.length).toBeGreaterThanOrEqual(6);
    expect(thread.messages[0]).toMatchObject({
      role: "user",
      id: "user-1",
      timestamp: 11000,
      path: "Projects/app",
      content: [
        {
          type: "text",
          content: "Run tests",
          metadata: { textElements: [{ kind: "plain" }] },
        },
        {
          type: "text",
          content: "[Local image: /tmp/screenshot.png]",
          metadata: { codexInput: { type: "localImage", path: "/tmp/screenshot.png" } },
        },
      ],
    });
    expect(thread.messages[1]).toMatchObject({
      role: "assistant",
      id: "assistant-status",
      provider: "openai",
      duration: 0,
      stopReason: "stop",
      content: [
        {
          type: "response",
          response: [
            {
              type: "text",
              content: "I will run the focused test.",
              metadata: {
                codexType: "agentMessage",
                phase: "commentary",
                memoryCitation: {
                  entries: [{ path: "MEMORY.md", lineStart: 1, lineEnd: 2, note: "test" }],
                  threadIds: ["memory-thread"],
                },
              },
            },
          ],
        },
      ],
    });
    expect(thread.messages[2]).toMatchObject({
      role: "assistant",
      id: "assistant-final",
      duration: 8000,
      content: [
        {
          type: "response",
          response: [
            {
              type: "text",
              content: "The focused test passed.",
              metadata: {
                codexType: "agentMessage",
                phase: "final_answer",
              },
            },
          ],
        },
      ],
    });
    expect(thread.activities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "activity:reasoning-1",
        kind: "thinking",
        summary: "Checked the test surface.\n\nNeed one focused assertion.",
      }),
      expect.objectContaining({
        id: "activity:cmd-1",
        kind: "tool.completed",
        title: "Command",
        summary: "$ pnpm test\nPASS tests",
      }),
      expect.objectContaining({
        id: "activity:patch-1",
        kind: "tool.completed",
        title: "File change",
      }),
      expect.objectContaining({
        id: "activity:mcp-1",
        kind: "tool.completed",
        tone: "error",
      }),
      expect.objectContaining({
        id: "activity:dynamic-1",
        kind: "tool.completed",
      }),
      expect.objectContaining({
        id: "activity:search-1",
        kind: "info",
        title: "Web search",
      }),
      expect.objectContaining({
        id: "activity:turn-2:error",
        kind: "runtime.error",
      }),
    ]));
  });

  it("starts a new Codex thread and streams turn events", async () => {
    let client: FakeCodexClient;
    client = new FakeCodexClient((method) => {
      if (method === "thread/start") {
        return {
          thread: createCodexThread({
            id: "thread-new",
            preview: "New thread",
            cwd: "/workspace/Desktop/Projects/app",
            createdAt: 10,
            updatedAt: 10,
          }),
        };
      }

      if (method === "turn/start") {
        queueMicrotask(() => {
          client.emit(createNotification("item/started", {
            threadId: "thread-new",
            turnId: "turn-new",
            item: {
              type: "userMessage",
              id: "user-live",
              content: [{ type: "text", text: "Hello Codex" }],
            },
          }));
          client.emit(createNotification("item/started", {
            threadId: "thread-new",
            turnId: "turn-new",
            item: { type: "agentMessage", id: "assistant-live", text: "", phase: "commentary" },
          }));
          client.emit(createNotification("item/agentMessage/delta", {
            threadId: "thread-new",
            turnId: "turn-new",
            itemId: "assistant-live",
            delta: "Hello",
          }));
          client.emit(createNotification("item/completed", {
            threadId: "thread-new",
            turnId: "turn-new",
            item: { type: "agentMessage", id: "assistant-live", text: "Hello", phase: "final_answer" },
          }));
          client.emit(createNotification("item/started", {
            threadId: "thread-new",
            turnId: "turn-new",
            item: {
              type: "commandExecution",
              id: "cmd-live",
              command: "printf hi",
              cwd: "/workspace/Desktop/Projects/app",
              status: "inProgress",
              commandActions: [],
            },
          }));
          client.emit(createNotification("item/commandExecution/outputDelta", {
            threadId: "thread-new",
            turnId: "turn-new",
            itemId: "cmd-live",
            delta: "hi",
          }));
          client.emit(createNotification("item/completed", {
            threadId: "thread-new",
            turnId: "turn-new",
            item: {
              type: "commandExecution",
              id: "cmd-live",
              command: "printf hi",
              cwd: "/workspace/Desktop/Projects/app",
              status: "completed",
              commandActions: [],
              aggregatedOutput: "hi",
              exitCode: 0,
            },
          }));
          client.emit(createNotification("item/completed", {
            threadId: "thread-new",
            turnId: "turn-new",
            item: { type: "webSearch", id: "search-live", query: "Codex", action: { type: "search", query: "Codex" } },
          }));
          client.emit(createNotification("turn/completed", {
            threadId: "thread-new",
            turn: { id: "turn-new", status: "completed" },
          }));
        });
        return {
          turn: { id: "turn-new", status: "inProgress", items: [] },
        };
      }

      if (method === "thread/read") {
        return {
          thread: createCodexThread({
            id: "thread-new",
            preview: "New thread",
            cwd: "/workspace/Desktop/Projects/app",
            createdAt: 10,
            updatedAt: 20,
            turns: [createUserTurn("turn-new")],
          }),
        };
      }

      throw new Error(`Unexpected method ${method}`);
    });
    const harness = new CodexAgentHarness({
      filesystemRoot: "/workspace/Desktop",
      client,
    });

    const events = await collectAsyncIterable(harness.sendMessage({
      path: "Projects/app",
      content: [{ type: "text", content: "Hello Codex" }],
    }));

    expect(client.requests.slice(0, 2)).toEqual([
      {
        method: "thread/start",
        params: {
          cwd: "/workspace/Desktop/Projects/app",
          serviceName: "ank1015_app",
        },
      },
      {
        method: "turn/start",
        params: {
          threadId: "thread-new",
          input: [
            { type: "text", text: "Hello Codex" },
            {
              type: "text",
              text: "<navigated_directory>/workspace/Desktop/Projects/app</navigated_directory>",
            },
          ],
        },
      },
    ]);
    expect(events.map((event) => event.type)).toEqual([
      "thread.created",
      "turn.started",
      "message.started",
      "message.completed",
      "message.started",
      "content.delta",
      "message.completed",
      "item.started",
      "item.updated",
      "content.delta",
      "item.completed",
      "item.completed",
      "turn.completed",
      "thread.updated",
    ]);
    expect(events.find((event) => event.type === "content.delta" && event.streamKind === "assistant_text")).toMatchObject({
      messageId: "assistant-live",
      delta: "Hello",
    });
    expect(events.find((event) => event.type === "item.completed" && event.item.id === "cmd-live")).toMatchObject({
      item: {
        id: "cmd-live",
        itemType: "command_execution",
        isError: false,
      },
    });
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "item.completed",
        item: expect.objectContaining({ itemType: "web_search" }),
      }),
    ]));
    expect(events.at(-1)).toMatchObject({
      type: "thread.updated",
    });
  });

  it("resumes an existing Codex thread without overriding cwd", async () => {
    let client: FakeCodexClient;
    client = new FakeCodexClient((method) => {
      if (method === "thread/resume") {
        return {
          thread: createCodexThread({
            id: "thread-old",
            preview: "Old thread",
            cwd: "/workspace/Desktop/Projects/old",
            createdAt: 10,
            updatedAt: 20,
          }),
        };
      }

      if (method === "turn/start") {
        queueMicrotask(() => {
          client.emit(createNotification("turn/completed", {
            threadId: "thread-old",
            turn: { id: "turn-old", status: "completed" },
          }));
        });
        return { turn: { id: "turn-old", status: "inProgress", items: [] } };
      }

      if (method === "thread/read") {
        return {
          thread: createCodexThread({
            id: "thread-old",
            preview: "Old thread",
            cwd: "/workspace/Desktop/Projects/old",
            createdAt: 10,
            updatedAt: 30,
            turns: [createUserTurn("turn-old")],
          }),
        };
      }

      throw new Error(`Unexpected method ${method}`);
    });
    const harness = new CodexAgentHarness({
      filesystemRoot: "/workspace/Desktop",
      client,
    });

    const events = await collectAsyncIterable(harness.sendMessage({
      threadId: "thread-old",
      path: "Projects/ignored",
      content: [{ type: "text", content: "Continue" }],
    }));

    expect(client.requests.slice(0, 2)).toEqual([
      {
        method: "thread/resume",
        params: { threadId: "thread-old" },
      },
      {
        method: "turn/start",
        params: {
          threadId: "thread-old",
          input: [
            { type: "text", text: "Continue" },
            {
              type: "text",
              text: "<navigated_directory>/workspace/Desktop/Projects/ignored</navigated_directory>",
            },
          ],
        },
      },
    ]);
    expect(events.some((event) => event.type === "thread.created")).toBe(false);
    expect(events.map((event) => event.type)).toContain("turn.completed");
  });

  it("rolls back a previous Codex user turn before starting an edited turn", async () => {
    let client: FakeCodexClient;
    client = new FakeCodexClient((method) => {
      if (method === "thread/resume") {
        return {
          thread: createCodexThread({
            id: "thread-edit",
            preview: "Edited thread",
            cwd: "/workspace/Desktop/Projects/app",
            createdAt: 10,
            updatedAt: 20,
          }),
        };
      }

      if (method === "thread/rollback") {
        return {};
      }

      if (method === "turn/start") {
        queueMicrotask(() => {
          client.emit(createNotification("turn/completed", {
            threadId: "thread-edit",
            turn: { id: "turn-edited", status: "completed" },
          }));
        });
        return { turn: { id: "turn-edited", status: "inProgress", items: [] } };
      }

      if (method === "thread/read") {
        return {
          thread: createCodexThread({
            id: "thread-edit",
            preview: "Edited thread",
            cwd: "/workspace/Desktop/Projects/app",
            createdAt: 10,
            updatedAt: 30,
            turns: [createUserTurn("turn-edited")],
          }),
        };
      }

      throw new Error(`Unexpected method ${method}`);
    });
    const harness = new CodexAgentHarness({
      filesystemRoot: "/workspace/Desktop",
      client,
    });

    const events = await collectAsyncIterable(harness.editThreadUserMessage({
      threadId: "thread-edit",
      path: "Projects/app",
      content: [{ type: "text", content: "Edited user message" }],
      numTurns: 1,
    }));

    expect(client.requests.slice(0, 3)).toEqual([
      {
        method: "thread/resume",
        params: { threadId: "thread-edit" },
      },
      {
        method: "thread/rollback",
        params: {
          threadId: "thread-edit",
          numTurns: 1,
        },
      },
      {
        method: "turn/start",
        params: {
          threadId: "thread-edit",
          input: [
            { type: "text", text: "Edited user message" },
          ],
        },
      },
    ]);
    expect(events.some((event) => event.type === "thread.created")).toBe(false);
    expect(events.find((event) => event.type === "turn.started")).toMatchObject({
      input: [{ type: "text", content: "Edited user message" }],
      path: "Projects/app",
    });
    expect(events.map((event) => event.type)).toContain("turn.completed");
  });

  it("hides appended navigated directory context from user messages", async () => {
    let client: FakeCodexClient;
    client = new FakeCodexClient((method) => {
      if (method === "thread/resume") {
        return {
          thread: createCodexThread({
            id: "thread-directory-context",
            preview: "Directory context",
            cwd: "/workspace/Desktop/Projects/app",
            createdAt: 10,
            updatedAt: 20,
          }),
        };
      }

      if (method === "turn/start") {
        queueMicrotask(() => {
          client.emit(createNotification("item/started", {
            threadId: "thread-directory-context",
            turnId: "turn-directory-context",
            item: {
              type: "userMessage",
              id: "live-user-directory-context",
              content: [
                { type: "text", text: "Where am I?" },
                { type: "text", text: "<navigated_directory>/workspace/Desktop/Projects/app</navigated_directory>" },
              ],
            },
          }));
          client.emit(createNotification("turn/completed", {
            threadId: "thread-directory-context",
            turn: { id: "turn-directory-context", status: "completed" },
          }));
        });
        return { turn: { id: "turn-directory-context", status: "inProgress", items: [] } };
      }

      if (method === "thread/read") {
        return {
          thread: createCodexThread({
            id: "thread-directory-context",
            preview: "Directory context",
            cwd: "/workspace/Desktop/Projects/app",
            createdAt: 10,
            updatedAt: 30,
            turns: [
              {
                id: "turn-directory-context",
                status: "completed",
                items: [
                  {
                    type: "userMessage",
                    id: "persisted-user-directory-context",
                    content: [
                      {
                        type: "text",
                        text: "Where am I?\n<navigated_directory>/workspace/Desktop/Projects/app</navigated_directory>",
                      },
                    ],
                  },
                ],
              },
            ],
          }),
        };
      }

      throw new Error(`Unexpected method ${method}`);
    });
    const harness = new CodexAgentHarness({
      filesystemRoot: "/workspace/Desktop",
      client,
    });

    const events = await collectAsyncIterable(harness.sendMessage({
      threadId: "thread-directory-context",
      path: "Projects/app",
      content: [{ type: "text", content: "Where am I?" }],
    }));
    const thread = await harness.getThread({ threadId: "thread-directory-context" });

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "message.completed",
        message: expect.objectContaining({
          role: "user",
          content: [{ type: "text", content: "Where am I?" }],
        }),
      }),
    ]));
    expect(thread.messages).toEqual([
      expect.objectContaining({
        role: "user",
        content: [{ type: "text", content: "Where am I?" }],
      }),
    ]);
  });

  it("keeps live interrupted assistant text when Codex thread history omits it", async () => {
    let client: FakeCodexClient;
    client = new FakeCodexClient((method) => {
      if (method === "thread/resume") {
        return {
          thread: createCodexThread({
            id: "thread-interrupted",
            preview: "Interrupted thread",
            cwd: "/workspace/Desktop",
            updatedAt: 20,
          }),
        };
      }

      if (method === "turn/start") {
        queueMicrotask(() => {
          client.emit(createNotification("item/started", {
            threadId: "thread-interrupted",
            turnId: "turn-interrupted",
            item: {
              type: "userMessage",
              id: "user-interrupted",
              content: [{ type: "text", text: "What?" }],
            },
          }));
          client.emit(createNotification("item/agentMessage/delta", {
            threadId: "thread-interrupted",
            turnId: "turn-interrupted",
            itemId: "assistant-interrupted",
            delta: "Partial interrupted answer",
          }));
          client.emit(createNotification("turn/completed", {
            threadId: "thread-interrupted",
            turn: { id: "turn-interrupted", status: "interrupted" },
          }));
        });
        return { turn: { id: "turn-interrupted", status: "inProgress", items: [] } };
      }

      if (method === "thread/read") {
        return {
          thread: createCodexThread({
            id: "thread-interrupted",
            preview: "Interrupted thread",
            cwd: "/workspace/Desktop",
            createdAt: 10,
            updatedAt: 30,
            turns: [
              {
                id: "turn-interrupted",
                status: "interrupted",
                items: [
                  {
                    type: "userMessage",
                    id: "user-interrupted",
                    content: [{ type: "text", text: "What?" }],
                  },
                ],
              },
            ],
          }),
        };
      }

      throw new Error(`Unexpected method ${method}`);
    });
    const harness = new CodexAgentHarness({
      filesystemRoot: "/workspace/Desktop",
      client,
    });

    const events = await collectAsyncIterable(harness.sendMessage({
      threadId: "thread-interrupted",
      path: "",
      content: [{ type: "text", content: "What?" }],
    }));

    const thread = await harness.getThread({ threadId: "thread-interrupted" });

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "content.delta",
        messageId: "assistant-interrupted",
        delta: "Partial interrupted answer",
      }),
    ]));
    expect(thread.messages).toEqual([
      expect.objectContaining({ role: "user", id: "user-interrupted" }),
    ]);
  });

  it("does not duplicate completed live messages that Codex later persists with different ids", async () => {
    let client: FakeCodexClient;
    client = new FakeCodexClient((method) => {
      if (method === "thread/resume") {
        return {
          thread: createCodexThread({
            id: "thread-completed",
            preview: "Completed thread",
            cwd: "/workspace/Desktop",
            updatedAt: 20,
          }),
        };
      }

      if (method === "turn/start") {
        queueMicrotask(() => {
          client.emit(createNotification("item/started", {
            threadId: "thread-completed",
            turnId: "turn-completed",
            item: {
              type: "userMessage",
              id: "live-user",
              content: [{ type: "text", text: "What is this project about?" }],
            },
          }));
          client.emit(createNotification("item/started", {
            threadId: "thread-completed",
            turnId: "turn-completed",
            item: {
              type: "agentMessage",
              id: "live-assistant",
              text: "",
            },
          }));
          client.emit(createNotification("item/agentMessage/delta", {
            threadId: "thread-completed",
            turnId: "turn-completed",
            itemId: "live-assistant",
            delta: "Project answer",
          }));
          client.emit(createNotification("item/completed", {
            threadId: "thread-completed",
            turnId: "turn-completed",
            item: {
              type: "agentMessage",
              id: "live-assistant",
              text: "Project answer",
            },
          }));
          client.emit(createNotification("turn/completed", {
            threadId: "thread-completed",
            turn: { id: "turn-completed", status: "completed" },
          }));
        });
        return { turn: { id: "turn-completed", status: "inProgress", items: [] } };
      }

      if (method === "thread/read") {
        return {
          thread: createCodexThread({
            id: "thread-completed",
            preview: "Completed thread",
            cwd: "/workspace/Desktop",
            createdAt: 10,
            updatedAt: 30,
            turns: [
              {
                id: "turn-completed",
                status: "completed",
                items: [
                  {
                    type: "userMessage",
                    id: "persisted-user",
                    content: [{ type: "text", text: "What is this project about?" }],
                  },
                  {
                    type: "agentMessage",
                    id: "persisted-assistant",
                    text: "Project answer",
                    phase: "final_answer",
                  },
                ],
              },
            ],
          }),
        };
      }

      throw new Error(`Unexpected method ${method}`);
    });
    const harness = new CodexAgentHarness({
      filesystemRoot: "/workspace/Desktop",
      client,
    });

    await collectAsyncIterable(harness.sendMessage({
      threadId: "thread-completed",
      path: "",
      content: [{ type: "text", content: "What is this project about?" }],
    }));

    const thread = await harness.getThread({ threadId: "thread-completed" });

    expect(thread.messageCount).toBe(1);
    expect(thread.messages.map((message) => message.id)).toEqual([
      "persisted-user",
      "persisted-assistant",
    ]);
  });

  it("maps failed turns to agent_error", async () => {
    let client: FakeCodexClient;
    client = new FakeCodexClient((method) => {
      if (method === "thread/resume") {
        return {
          thread: createCodexThread({
            id: "thread-failed",
            preview: "Failed thread",
            cwd: "/workspace/Desktop",
            updatedAt: 20,
          }),
        };
      }

      if (method === "turn/start") {
        queueMicrotask(() => {
          client.emit(createNotification("turn/completed", {
            threadId: "thread-failed",
            turn: {
              id: "turn-failed",
              status: "failed",
              error: { message: "Boom" },
            },
          }));
        });
        return { turn: { id: "turn-failed", status: "inProgress", items: [] } };
      }

      if (method === "thread/read") {
        return {
          thread: createCodexThread({
            id: "thread-failed",
            preview: "Failed thread",
            cwd: "/workspace/Desktop",
            updatedAt: 30,
          }),
        };
      }

      throw new Error(`Unexpected method ${method}`);
    });
    const harness = new CodexAgentHarness({
      filesystemRoot: "/workspace/Desktop",
      client,
    });

    const events = await collectAsyncIterable(harness.sendMessage({
      threadId: "thread-failed",
      path: "",
      content: [{ type: "text", content: "Fail" }],
    }));

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "runtime.error",
        error: expect.objectContaining({ message: "Boom" }),
      }),
    ]));
  });

  it("cancels Codex turns by interrupting the run id", async () => {
    const client = new FakeCodexClient({});
    const harness = new CodexAgentHarness({
      filesystemRoot: "/workspace/Desktop",
      client,
    });

    await expect(harness.cancelRun({ threadId: "thread-1", runId: "turn-1" })).resolves.toBeUndefined();

    expect(client.requests).toEqual([
      {
        method: "turn/interrupt",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
        },
      },
    ]);
  });
});

describe("codex app-server client", () => {
  it("injects the Codex gateway token from the machine token file", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "ank1015-codex-env-"));

    try {
      const tokenPath = join(tempDir, "machine-token");
      await writeFile(tokenPath, "machine-token-value\n");

      expect(resolveCodexAppServerEnv({
        ANK1015_MACHINE_TOKEN_FILE: tokenPath,
        EXISTING_ENV: "kept",
      })).toMatchObject({
        ANK1015_CODEX_GATEWAY_TOKEN: "machine-token-value",
        EXISTING_ENV: "kept",
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("fails clearly when cloud machine registration has not produced a token yet", () => {
    expect(() => resolveCodexAppServerEnv({
      ANK1015_MACHINE_TOKEN_FILE: "/tmp/ank1015-missing-machine-token",
    })).toThrow("Machine registration is not ready");
  });

  it("leaves local Codex app-server environments unchanged", () => {
    const env = { EXISTING_ENV: "kept" };

    expect(resolveCodexAppServerEnv(env)).toBe(env);
  });

  it("dispatches JSON-RPC notifications to subscribers", () => {
    const client = new CodexStdioAppServerClient();
    const notifications: CodexAppServerNotification[] = [];
    const unsubscribe = client.subscribe((notification) => notifications.push(notification));

    callPrivateHandleLine(client, JSON.stringify({
      method: "turn/started",
      params: { threadId: "thread-1", turn: { id: "turn-1" } },
    }));
    unsubscribe();
    callPrivateHandleLine(client, JSON.stringify({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: { id: "turn-1" } },
    }));

    expect(notifications).toEqual([
      {
        method: "turn/started",
        params: { threadId: "thread-1", turn: { id: "turn-1" } },
      },
    ]);
  });

  it("auto-accepts command and file approval requests", () => {
    const client = new CodexStdioAppServerClient();
    const writes = installFakeClientStdin(client);

    callPrivateHandleLine(client, JSON.stringify({
      id: 10,
      method: "item/commandExecution/requestApproval",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "cmd-1" },
    }));
    callPrivateHandleLine(client, JSON.stringify({
      id: 11,
      method: "item/fileChange/requestApproval",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "patch-1" },
    }));

    expect(writes.map((line) => JSON.parse(line))).toEqual([
      { id: 10, result: { decision: "accept" } },
      { id: 11, result: { decision: "accept" } },
    ]);
  });

  it("rejects unknown server requests", () => {
    const client = new CodexStdioAppServerClient();
    const writes = installFakeClientStdin(client);

    callPrivateHandleLine(client, JSON.stringify({
      id: 12,
      method: "item/tool/requestUserInput",
      params: {},
    }));

    expect(JSON.parse(writes[0] ?? "{}")).toEqual({
      id: 12,
      error: {
        code: -32601,
        message: "Unsupported Codex app-server request: item/tool/requestUserInput",
      },
    });
  });
});

class FakeCodexClient implements CodexAppServerClient {
  readonly requests: Array<{ readonly method: string; readonly params: unknown }> = [];
  closedCount = 0;
  private readonly listeners = new Set<(notification: CodexAppServerNotification) => void>();

  constructor(
    private readonly response: unknown | ((method: string, params: unknown) => unknown),
  ) {}

  async request<TResponse = unknown>(method: string, params?: unknown): Promise<TResponse> {
    this.requests.push({ method, params });
    if (typeof this.response === "function") {
      return this.response(method, params) as TResponse;
    }

    return this.response as TResponse;
  }

  subscribe(listener: (notification: CodexAppServerNotification) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(notification: CodexAppServerNotification): void {
    for (const listener of this.listeners) {
      listener(notification);
    }
  }

  close(): void {
    this.closedCount += 1;
  }
}

const createCodexThread = (input: {
  readonly id: string;
  readonly preview: string;
  readonly cwd: string;
  readonly modelProvider?: string;
  readonly updatedAt: number;
  readonly name?: string | null;
  readonly path?: string | null;
  readonly source?: unknown;
  readonly status?: unknown;
  readonly createdAt?: number;
  readonly turns?: readonly unknown[];
}): Record<string, unknown> => ({
  id: input.id,
  preview: input.preview,
  name: input.name,
  cwd: input.cwd,
  path: input.path,
  source: input.source ?? "appServer",
  status: input.status,
  modelProvider: input.modelProvider,
  createdAt: input.createdAt ?? input.updatedAt,
  updatedAt: input.updatedAt,
  turns: input.turns ?? [],
});

const createUserTurn = (id: string): Record<string, unknown> => ({
  id,
  status: "completed",
  items: [
    {
      type: "userMessage",
      id: `${id}-user`,
      content: [{ type: "text", text: `Prompt for ${id}` }],
    },
  ],
});

const createNotification = (method: string, params: unknown): CodexAppServerNotification => ({
  method,
  params,
});

const callPrivateHandleLine = (client: CodexStdioAppServerClient, line: string): void => {
  (client as unknown as { handleLine(line: string): void }).handleLine(line);
};

const installFakeClientStdin = (client: CodexStdioAppServerClient): string[] => {
  const writes: string[] = [];
  (client as unknown as {
    child: {
      stdin: {
        destroyed: boolean;
        write(chunk: string): boolean;
      };
    };
  }).child = {
    stdin: {
      destroyed: false,
      write: (chunk: string): boolean => {
        writes.push(chunk.trim());
        return true;
      },
    },
  };
  return writes;
};

const collectAsyncIterable = async (iterable: AsyncIterable<unknown>): Promise<unknown[]> => {
  const events: unknown[] = [];

  for await (const _event of iterable) {
    events.push(_event);
  }

  return events;
};
