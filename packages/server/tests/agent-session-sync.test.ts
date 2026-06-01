import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  discoverAgentSessionFiles,
  readMachineTokenWithWait,
  syncAgentSessionsOnce,
} from "../src/agent/session-sync.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("agent session sync", () => {
  it("discovers Codex and Pi jsonl files with stable metadata", async () => {
    const home = await createTempRoot();
    const codexFile = join(
      home,
      ".codex",
      "sessions",
      "2026",
      "06",
      "01",
      "rollout-2026-06-01T00-00-00-codex-thread.jsonl",
    );
    const piFile = join(home, ".pi", "agent", "sessions", "pi-thread.jsonl");
    await writeStableFile(codexFile, `${JSON.stringify({
      timestamp: "2026-06-01T00:00:00.000Z",
      type: "session_meta",
      payload: {
        id: "codex-thread",
        timestamp: "2026-06-01T00:00:00.000Z",
      },
    })}\n{"type":"event"}\n`);
    await writeStableFile(piFile, `${JSON.stringify({
      type: "session",
      id: "pi-thread",
      timestamp: "2026-06-01T00:00:01.000Z",
    })}\n{"type":"message","id":"m1","parentId":null}\n`);

    const files = await discoverAgentSessionFiles({
      home,
      stableFileAgeMs: 0,
    });

    expect(files).toHaveLength(2);
    expect(files.map((file) => ({
      harness: file.harness,
      nativeThreadId: file.nativeThreadId,
      threadId: file.threadId,
    })).sort((left, right) => left.harness.localeCompare(right.harness))).toEqual([
      { harness: "codex", nativeThreadId: "codex-thread", threadId: "codex-thread" },
      { harness: "pi", nativeThreadId: "pi-thread", threadId: "pi:pi-thread" },
    ]);
    expect(files.find((file) => file.harness === "codex")?.sha256).toBe(sha256(await readFile(codexFile)));
    expect(files.find((file) => file.harness === "pi")?.sha256).toBe(sha256(await readFile(piFile)));
  });

  it("uploads only files requested by the cloud sync plan and preserves raw bytes", async () => {
    const home = await createTempRoot();
    const tokenFile = join(home, "machine-token");
    const codexFile = join(home, ".codex", "sessions", "2026", "06", "01", "session.jsonl");
    const raw = `${JSON.stringify({
      type: "session_meta",
      payload: { id: "thread-upload", timestamp: "2026-06-01T00:00:00.000Z" },
    })}\n{"raw":true}\n`;
    await writeFile(tokenFile, "machine-token\n");
    await writeStableFile(codexFile, raw);

    let uploadedBody = Buffer.alloc(0);
    const fetchFn: typeof fetch = async (input, init) => {
      const url = new URL(String(input));

      if (url.pathname.endsWith("/sync-plan")) {
        const body = JSON.parse(String(init?.body)) as {
          readonly files: ReadonlyArray<{
            readonly harness: string;
            readonly nativeThreadId: string;
            readonly threadId: string;
            readonly sha256: string;
          }>;
        };
        return jsonResponse({
          uploads: body.files.map((file) => ({
            harness: file.harness,
            nativeThreadId: file.nativeThreadId,
            threadId: file.threadId,
            sha256: file.sha256,
          })),
        });
      }

      uploadedBody = await readRequestBody(init?.body);
      expect(url.searchParams.get("nativeThreadId")).toBe("thread-upload");
      return jsonResponse({ uploaded: true }, 201);
    };

    const result = await syncAgentSessionsOnce({
      cloudServerPublicUrl: "https://cloud.example.com",
      tokenFile,
      home,
      stableFileAgeMs: 0,
      fetchFn,
    });

    expect(result).toMatchObject({
      status: "synced",
      discoveredCount: 1,
      uploadedCount: 1,
    });
    expect(uploadedBody.toString("utf8")).toBe(raw);
  });

  it("waits briefly for the machine token file", async () => {
    const home = await createTempRoot();
    const tokenFile = join(home, "machine-token");
    setTimeout(() => {
      void writeFile(tokenFile, "late-token\n");
    }, 10);

    await expect(readMachineTokenWithWait(tokenFile, {
      timeoutMs: 1_000,
      intervalMs: 5,
    })).resolves.toBe("late-token");
  });

  it("skips files that are too recently modified", async () => {
    const home = await createTempRoot();
    const recentFile = join(home, ".codex", "sessions", "recent.jsonl");
    await mkdir(dirname(recentFile), { recursive: true });
    await writeFile(recentFile, `${JSON.stringify({
      type: "session_meta",
      payload: { id: "recent-thread" },
    })}\n`);

    await expect(discoverAgentSessionFiles({
      home,
      now: new Date(),
      stableFileAgeMs: 60_000,
    })).resolves.toEqual([]);
  });
});

const createTempRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "heysnap-agent-session-sync-"));
  tempRoots.push(root);
  return root;
};

const writeStableFile = async (path: string, content: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  const oldDate = new Date(Date.now() - 120_000);
  await utimes(path, oldDate, oldDate);
};

const sha256 = (buffer: Buffer): string =>
  createHash("sha256").update(buffer).digest("hex");

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const readRequestBody = async (body: BodyInit | null | undefined): Promise<Buffer> => {
  if (body === undefined || body === null) {
    return Buffer.alloc(0);
  }

  const chunks: Buffer[] = [];

  for await (const chunk of body as unknown as AsyncIterable<Buffer | Uint8Array | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
};
