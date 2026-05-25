import { describe, expect, it } from "vitest";

import {
  buildFilesystemExplorerStorageKey,
  parsePersistedFilesystemExplorerState,
  readPersistedFilesystemExplorerState,
  reconcileFilesystemViewState,
  writePersistedFilesystemExplorerState,
} from "../../src/filesystem/filesystem-persistence";
import type { FilesystemEntry } from "../../src/filesystem/types";

const HISTORY_LIMIT = 4;

describe("filesystem explorer persistence", () => {
  it("round-trips valid persisted state", () => {
    const storage = createMemoryStorage();
    const storageKey = buildFilesystemExplorerStorageKey("filesystem:cmp_123");

    writePersistedFilesystemExplorerState(storage, storageKey, {
      currentPath: "src",
      history: ["", "src"],
      historyIndex: 1,
      openFileTabs: [{
        name: "index.ts",
        path: "src/index.ts",
        size: 12,
        updatedAt: "2026-05-25T00:00:00.000Z",
      }],
      activeFilePath: "src/index.ts",
      activeLeftPaneSurface: "file",
    }, HISTORY_LIMIT);

    expect(readPersistedFilesystemExplorerState(storage, storageKey, HISTORY_LIMIT)).toEqual({
      currentPath: "src",
      history: ["", "src"],
      historyIndex: 1,
      openFileTabs: [{
        name: "index.ts",
        path: "src/index.ts",
        size: 12,
        updatedAt: "2026-05-25T00:00:00.000Z",
      }],
      activeFilePath: "src/index.ts",
      activeLeftPaneSurface: "file",
    });
  });

  it("rejects malformed or old persisted data", () => {
    expect(parsePersistedFilesystemExplorerState({ version: 0, state: {} }, HISTORY_LIMIT)).toBeNull();
    expect(parsePersistedFilesystemExplorerState({ version: 1, state: null }, HISTORY_LIMIT)).toBeNull();
  });

  it("drops invalid active file focus", () => {
    expect(parsePersistedFilesystemExplorerState({
      version: 1,
      state: {
        currentPath: "src",
        history: ["", "src"],
        historyIndex: 1,
        openFileTabs: [],
        activeFilePath: "src/missing.ts",
        activeLeftPaneSurface: "file",
      },
    }, HISTORY_LIMIT)).toMatchObject({
      activeFilePath: null,
      activeLeftPaneSurface: "directory",
    });
  });

  it("preserves active file when server view state still includes it", () => {
    const reconciled = reconcileFilesystemViewState({
      currentOpenFileTabs: [{
        name: "old.ts",
        path: "src/index.ts",
        size: 10,
        updatedAt: "old",
      }],
      activeFilePath: "src/index.ts",
      activeLeftPaneSurface: "file",
      viewState: {
        currentPath: "src",
        openFiles: [entry({ name: "index.ts", path: "src/index.ts", size: 20, updatedAt: "new" })],
      },
      shouldHydrateFromServer: false,
    });

    expect(reconciled).toEqual({
      openFileTabs: [{
        name: "index.ts",
        path: "src/index.ts",
        size: 20,
        updatedAt: "new",
      }],
      activeFilePath: "src/index.ts",
      activeLeftPaneSurface: "file",
    });
  });

  it("hydrates tabs from server only as a fallback", () => {
    const viewState = {
      currentPath: "src",
      openFiles: [entry({ name: "server.ts", path: "src/server.ts" })],
    };

    expect(reconcileFilesystemViewState({
      currentOpenFileTabs: [],
      activeFilePath: null,
      activeLeftPaneSurface: "directory",
      viewState,
      shouldHydrateFromServer: true,
    }).openFileTabs).toEqual([{
      name: "server.ts",
      path: "src/server.ts",
      size: 1,
      updatedAt: "2026-05-25T00:00:00.000Z",
    }]);

    expect(reconcileFilesystemViewState({
      currentOpenFileTabs: [{
        name: "local.ts",
        path: "src/local.ts",
        size: 1,
        updatedAt: "local",
      }],
      activeFilePath: "src/local.ts",
      activeLeftPaneSurface: "file",
      viewState,
      shouldHydrateFromServer: false,
    }).openFileTabs).toEqual([{
      name: "local.ts",
      path: "src/local.ts",
      size: 1,
      updatedAt: "local",
    }]);
  });
});

const createMemoryStorage = (): Pick<Storage, "getItem" | "setItem"> => {
  const values = new Map<string, string>();

  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
};

const entry = (input: {
  readonly name: string;
  readonly path: string;
  readonly size?: number | null;
  readonly updatedAt?: string;
}): FilesystemEntry => ({
  name: input.name,
  path: input.path,
  type: "file",
  size: input.size ?? 1,
  updatedAt: input.updatedAt ?? "2026-05-25T00:00:00.000Z",
  isHidden: false,
  isSymlink: false,
});
