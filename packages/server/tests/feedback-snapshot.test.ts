import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { createFeedbackSnapshotArchive } from "../src/feedback/http.js";

const tempDirs: string[] = [];
const oldCodexHome = process.env.CODEX_HOME;

afterEach(async () => {
  if (oldCodexHome === undefined) {
    delete process.env.CODEX_HOME;
  } else {
    process.env.CODEX_HOME = oldCodexHome;
  }

  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("feedback snapshot archive", () => {
  it("includes nested sessions files and feedback.json while skipping symlinks", async () => {
    const codexHome = await makeCodexHome();
    const sessionDir = join(codexHome, "sessions", "2026", "05", "23");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, "thread.jsonl"), "{\"type\":\"session\"}\n");
    await symlink(join(sessionDir, "thread.jsonl"), join(sessionDir, "thread-link.jsonl"));

    const archive = await createFeedbackSnapshotArchive({
      feedbackId: "feedback-1",
      comment: "Something bad happened",
      threadId: "thread-1",
      cwd: "/workspace",
      createdAt: "2026-05-23T00:00:00.000Z",
      machineServerVersion: "test-version",
      now: new Date("2026-05-23T00:01:00.000Z"),
    });

    try {
      const zip = await readFile(archive.archivePath);
      const names = readZipEntryNames(zip);

      expect(names).toContain("feedback.json");
      expect(names).toContain("sessions/2026/05/23/thread.jsonl");
      expect(names).not.toContain("sessions/2026/05/23/thread-link.jsonl");
      expect(archive.fileCount).toBe(1);
      expect(archive.machineContext).toMatchObject({
        sessionsPresent: true,
        skippedSymlinks: 1,
        fileCount: 1,
      });
      expect(zip.toString("utf8")).toContain("\"comment\": \"Something bad happened\"");
      expect(zip.toString("utf8")).toContain("\"threadId\": \"thread-1\"");
    } finally {
      await rm(archive.archivePath, { force: true });
    }
  });

  it("still creates a manifest-only ZIP when the sessions folder is missing", async () => {
    await makeCodexHome();

    const archive = await createFeedbackSnapshotArchive({
      feedbackId: "feedback-2",
      comment: "No sessions yet",
      machineServerVersion: "test-version",
      now: new Date("2026-05-23T00:02:00.000Z"),
    });

    try {
      const zip = await readFile(archive.archivePath);
      const names = readZipEntryNames(zip);

      expect(names).toEqual(["feedback.json"]);
      expect(archive.fileCount).toBe(0);
      expect(archive.machineContext).toMatchObject({
        sessionsPresent: false,
        skippedSymlinks: 0,
        fileCount: 0,
      });
      expect(zip.toString("utf8")).toContain("\"sessionsPresent\": false");
      expect(zip.toString("utf8")).toContain("\"fileCount\": 0");
    } finally {
      await rm(archive.archivePath, { force: true });
    }
  });
});

const makeCodexHome = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "heysnap-codex-home-"));
  tempDirs.push(root);
  process.env.CODEX_HOME = root;
  return root;
};

const readZipEntryNames = (zip: Buffer): string[] => {
  const eocdOffset = findEndOfCentralDirectory(zip);
  const entryCount = zip.readUInt16LE(eocdOffset + 10);
  let offset = zip.readUInt32LE(eocdOffset + 16);
  const names: string[] = [];

  for (let index = 0; index < entryCount; index += 1) {
    expect(zip.readUInt32LE(offset)).toBe(0x02014b50);
    const fileNameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    names.push(zip.subarray(nameStart, nameStart + fileNameLength).toString("utf8"));
    offset = nameStart + fileNameLength + extraLength + commentLength;
  }

  return names;
};

const findEndOfCentralDirectory = (zip: Buffer): number => {
  for (let offset = zip.byteLength - 22; offset >= 0; offset -= 1) {
    if (zip.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }

  throw new Error("ZIP end of central directory not found");
};
