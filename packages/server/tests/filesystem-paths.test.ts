import { describe, expect, it } from "vitest";

import { ensureWithinRoot, resolveClientPath, resolveFilesystemRoot, toClientPath, validateEntryName } from "../src/filesystem/paths.js";

describe("filesystem path safety", () => {
  it("defaults the root to ~/Desktop", () => {
    const root = resolveFilesystemRoot({}, "/tmp/test-home");

    expect(root.absolutePath).toBe("/tmp/test-home/Desktop");
    expect(root.name).toBe("Desktop");
  });

  it("expands a configured home-relative root", () => {
    const root = resolveFilesystemRoot({ ANK1015_FILESYSTEM_ROOT: "~/Workspace" }, "/tmp/test-home");

    expect(root.absolutePath).toBe("/tmp/test-home/Workspace");
  });

  it("resolves root-relative client paths", () => {
    expect(resolveClientPath("/tmp/root", "Projects/app")).toBe("/tmp/root/Projects/app");
    expect(toClientPath("/tmp/root", "/tmp/root/Projects/app")).toBe("Projects/app");
  });

  it("rejects paths outside the root", () => {
    expect(() => resolveClientPath("/tmp/root", "../secret")).toThrow("parent directory");
    expect(() => resolveClientPath("/tmp/root", "/tmp/root/file")).toThrow("root-relative");
    expect(() => ensureWithinRoot("/tmp/root", "/tmp/other")).toThrow("outside");
  });

  it("validates entry names", () => {
    expect(validateEntryName("New Folder")).toBe("New Folder");
    expect(() => validateEntryName("../bad")).toThrow("path separators");
    expect(() => validateEntryName("")).toThrow("required");
  });
});
