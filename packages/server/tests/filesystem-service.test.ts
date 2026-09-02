import { mkdir, readFile, rename, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { FilesystemService, removeEntriesForTest } from "../src/filesystem/service.js";

const createRoot = async (): Promise<string> => mkdtemp(join(tmpdir(), "ank1015-fs-"));

describe("FilesystemService", () => {
  it("lists entries with directories first, hidden filtering, and root-relative paths", async () => {
    const root = await createRoot();
    await mkdir(join(root, "z-folder"));
    await mkdir(join(root, "a-folder"));
    await writeFile(join(root, "b.txt"), "b");
    await writeFile(join(root, ".hidden"), "hidden");

    const service = new FilesystemService({ rootPath: root, trashFunction: removeEntriesForTest });
    const visible = await service.listDirectory(undefined, false);
    const hidden = await service.listDirectory(undefined, true);

    expect(visible.entries.map((entry) => entry.name)).toEqual(["a-folder", "z-folder", "b.txt"]);
    expect(visible.entries.find((entry) => entry.name === "b.txt")?.path).toBe("b.txt");
    expect(hidden.entries.map((entry) => entry.name)).toContain(".hidden");
  });

  it("skips symlinks that resolve outside the root", async () => {
    const root = await createRoot();
    const outside = await createRoot();
    await writeFile(join(root, "inside.txt"), "inside");
    await writeFile(join(outside, "outside.txt"), "outside");
    await symlink(join(root, "inside.txt"), join(root, "inside-link"));
    await symlink(join(outside, "outside.txt"), join(root, "outside-link"));

    const service = new FilesystemService({ rootPath: root, trashFunction: removeEntriesForTest });
    const listing = await service.listDirectory(undefined, true);

    expect(listing.entries.map((entry) => entry.name)).toContain("inside-link");
    expect(listing.entries.map((entry) => entry.name)).not.toContain("outside-link");
  });

  it("creates folders with available default names", async () => {
    const root = await createRoot();
    const service = new FilesystemService({ rootPath: root, trashFunction: removeEntriesForTest });

    const first = await service.createFolder(undefined);
    const second = await service.createFolder(undefined);

    expect(first.name).toBe("untitled folder");
    expect(second.name).toBe("untitled folder 2");
  });

  it("uploads files into the target directory and preserves folder-relative paths", async () => {
    const root = await createRoot();
    await mkdir(join(root, "target"));

    const service = new FilesystemService({ rootPath: root, trashFunction: removeEntriesForTest });
    const result = await service.uploadFiles("target", [
      {
        relativePath: "plain.txt",
        contentBase64: Buffer.from("plain").toString("base64"),
      },
      {
        relativePath: "Folder/nested.txt",
        contentBase64: Buffer.from("nested").toString("base64"),
      },
    ]);

    expect(result.entries.map((entry) => entry.path).sort()).toEqual([
      "target/Folder/nested.txt",
      "target/plain.txt",
    ]);
    expect(await readFile(join(root, "target", "plain.txt"), "utf8")).toBe("plain");
    expect(await readFile(join(root, "target", "Folder", "nested.txt"), "utf8")).toBe("nested");
  });

  it("uploads folder entries with empty subfolders", async () => {
    const root = await createRoot();
    const service = new FilesystemService({ rootPath: root, trashFunction: removeEntriesForTest });

    const result = await service.uploadFiles(undefined, [
      {
        type: "directory",
        relativePath: "Project",
      },
      {
        type: "directory",
        relativePath: "Project/empty",
      },
      {
        type: "file",
        relativePath: "Project/src/index.txt",
        contentBase64: Buffer.from("nested").toString("base64"),
      },
    ]);

    expect(result.entries.map((entry) => entry.path).sort()).toEqual([
      "Project",
      "Project/empty",
      "Project/src/index.txt",
    ]);
    await expect(stat(join(root, "Project", "empty")).then((entry) => entry.isDirectory())).resolves.toBe(true);
    expect(await readFile(join(root, "Project", "src", "index.txt"), "utf8")).toBe("nested");
  });

  it("rejects upload paths that escape the target directory", async () => {
    const root = await createRoot();
    const service = new FilesystemService({ rootPath: root, trashFunction: removeEntriesForTest });

    await expect(service.uploadFiles(undefined, [{
      relativePath: "../bad.txt",
      contentBase64: Buffer.from("bad").toString("base64"),
    }])).rejects.toThrow("cannot leave");
  });

  it("renames entries and rejects conflicts", async () => {
    const root = await createRoot();
    await writeFile(join(root, "old.txt"), "old");
    await writeFile(join(root, "taken.txt"), "taken");

    const service = new FilesystemService({ rootPath: root, trashFunction: removeEntriesForTest });
    const renamed = await service.renameEntry("old.txt", "new.txt");

    expect(renamed.path).toBe("new.txt");
    await expect(service.renameEntry("new.txt", "taken.txt")).rejects.toThrow("already exists");
    await expect(service.renameEntry("new.txt", "../bad")).rejects.toThrow("path separators");
  });

  it("trashes entries through the configured trash function", async () => {
    const root = await createRoot();
    await writeFile(join(root, "trash-me.txt"), "trash");

    const service = new FilesystemService({ rootPath: root, trashFunction: removeEntriesForTest });
    const result = await service.trashEntries(["trash-me.txt"]);
    const listing = await service.listDirectory(undefined, true);

    expect(result.paths).toEqual(["trash-me.txt"]);
    expect(listing.entries.map((entry) => entry.name)).not.toContain("trash-me.txt");
  });

  it("copies files into the target directory", async () => {
    const root = await createRoot();
    await mkdir(join(root, "target"));
    await writeFile(join(root, "source.txt"), "copy me");

    const service = new FilesystemService({ rootPath: root, trashFunction: removeEntriesForTest });
    const result = await service.pasteEntries("target", ["source.txt"], "copy");

    expect(result.entries.map((entry) => entry.path)).toEqual(["target/source.txt"]);
    expect(await readFile(join(root, "source.txt"), "utf8")).toBe("copy me");
    expect(await readFile(join(root, "target", "source.txt"), "utf8")).toBe("copy me");
  });

  it("copies folders recursively into the target directory", async () => {
    const root = await createRoot();
    await mkdir(join(root, "target"));
    await mkdir(join(root, "Project", "src"), { recursive: true });
    await writeFile(join(root, "Project", "src", "index.txt"), "nested");

    const service = new FilesystemService({ rootPath: root, trashFunction: removeEntriesForTest });
    const result = await service.pasteEntries("target", ["Project"], "copy");

    expect(result.entries.map((entry) => entry.path)).toEqual(["target/Project"]);
    expect(await readFile(join(root, "Project", "src", "index.txt"), "utf8")).toBe("nested");
    expect(await readFile(join(root, "target", "Project", "src", "index.txt"), "utf8")).toBe("nested");
  });

  it("moves entries into the target directory", async () => {
    const root = await createRoot();
    await mkdir(join(root, "target"));
    await writeFile(join(root, "source.txt"), "move me");

    const service = new FilesystemService({ rootPath: root, trashFunction: removeEntriesForTest });
    const result = await service.pasteEntries("target", ["source.txt"], "move");

    expect(result.entries.map((entry) => entry.path)).toEqual(["target/source.txt"]);
    await expect(stat(join(root, "source.txt"))).rejects.toThrow();
    expect(await readFile(join(root, "target", "source.txt"), "utf8")).toBe("move me");
  });

  it("rejects paste conflicts without changing the source", async () => {
    const root = await createRoot();
    await mkdir(join(root, "target"));
    await writeFile(join(root, "source.txt"), "source");
    await writeFile(join(root, "target", "source.txt"), "existing");

    const service = new FilesystemService({ rootPath: root, trashFunction: removeEntriesForTest });

    await expect(service.pasteEntries("target", ["source.txt"], "copy")).rejects.toThrow("already exists");
    expect(await readFile(join(root, "source.txt"), "utf8")).toBe("source");
    expect(await readFile(join(root, "target", "source.txt"), "utf8")).toBe("existing");
  });

  it("rejects pasting folders into themselves or descendants", async () => {
    const root = await createRoot();
    await mkdir(join(root, "Project", "src"), { recursive: true });

    const service = new FilesystemService({ rootPath: root, trashFunction: removeEntriesForTest });

    await expect(service.pasteEntries("Project", ["Project"], "copy")).rejects.toThrow("itself");
    await expect(service.pasteEntries("Project/src", ["Project"], "move")).rejects.toThrow("itself");
  });

  it("rolls back moved entries if a later move fails", async () => {
    const root = await createRoot();
    await mkdir(join(root, "target"));
    await writeFile(join(root, "one.txt"), "one");
    await writeFile(join(root, "two.txt"), "two");
    let renameCount = 0;

    const service = new FilesystemService({
      rootPath: root,
      trashFunction: removeEntriesForTest,
      renameFunction: async (oldPath, newPath) => {
        renameCount += 1;
        if (renameCount === 2) {
          throw new Error("simulated move failure");
        }
        await rename(oldPath, newPath);
      },
    });

    await expect(service.pasteEntries("target", ["one.txt", "two.txt"], "move")).rejects.toThrow("simulated");
    expect(await readFile(join(root, "one.txt"), "utf8")).toBe("one");
    expect(await readFile(join(root, "two.txt"), "utf8")).toBe("two");
    await expect(stat(join(root, "target", "one.txt"))).rejects.toThrow();
  });
});
