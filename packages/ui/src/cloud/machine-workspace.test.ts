import { describe, expect, it } from "vitest";

import { executeBrowserControlExtensionCommand, shouldWaitForNavigationCommit } from "./machine-workspace";

describe("machine workspace browser load waiting", () => {
  it("keeps waiting while Chrome reports a pending tab URL", () => {
    expect(shouldWaitForNavigationCommit("https://previous.example/", undefined, "https://images.google.com/")).toBe(true);
    expect(shouldWaitForNavigationCommit("about:blank", "https://images.google.com/", "https://images.google.com/")).toBe(true);
  });

  it("does not treat the initial about:blank document as a committed target navigation", () => {
    expect(shouldWaitForNavigationCommit("about:blank", "https://images.google.com/")).toBe(true);
    expect(shouldWaitForNavigationCommit("", "https://images.google.com/")).toBe(true);
  });

  it("allows committed target, redirect, and explicit blank navigations to finish normally", () => {
    expect(shouldWaitForNavigationCommit("https://images.google.com/", "https://images.google.com/")).toBe(false);
    expect(shouldWaitForNavigationCommit("https://consent.google.com/", "https://images.google.com/")).toBe(false);
    expect(shouldWaitForNavigationCommit("about:blank", "about:blank")).toBe(false);
    expect(shouldWaitForNavigationCommit("about:blank", undefined)).toBe(false);
  });
});

describe("machine workspace browser screenshots", () => {
  it("captures and streams a viewport screenshot", async () => {
    const debuggerCommands: Array<{ readonly method: string; readonly params?: Record<string, unknown>; readonly tabId: number }> = [];
    const writes: Array<{ readonly dataBase64: string; readonly done: boolean; readonly offset: number; readonly outputId: string }> = [];
    const dataBase64 = Buffer.from("fake-screenshot").toString("base64");

    const result = await executeBrowserControlExtensionCommand({
      command: "tab.screenshot",
      executeDebuggerCommand: async (command) => {
        debuggerCommands.push(command);
        expect(command.method).toBe("Page.captureScreenshot");
        return { data: dataBase64 };
      },
      executeExtensionCommand: async () => ({}),
      outputs: [{ id: "screenshot", mimeType: "image/png", maxBytes: 1024 }],
      params: {
        tabId: 123,
        outputId: "screenshot",
        captureMode: "viewport",
        format: "png",
      },
      signal: new AbortController().signal,
      windowId: 1,
      writeOutput: async (write) => {
        writes.push(write);
        return {
          bytesWritten: Buffer.from(write.dataBase64, "base64").byteLength,
          done: write.done,
          offset: write.offset,
          outputId: write.outputId,
        };
      },
    });

    expect(result).toEqual({ tabId: 123, outputId: "screenshot", size: Buffer.byteLength("fake-screenshot") });
    expect(debuggerCommands).toHaveLength(1);
    expect(debuggerCommands[0]).toMatchObject({
      method: "Page.captureScreenshot",
      params: { format: "png" },
      tabId: 123,
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      dataBase64,
      done: true,
      offset: 0,
      outputId: "screenshot",
    });
  });

  it("uses layout metrics for full-page screenshots", async () => {
    const methods: string[] = [];

    await executeBrowserControlExtensionCommand({
      command: "tab.screenshot",
      executeDebuggerCommand: async (command) => {
        methods.push(command.method);
        if (command.method === "Page.getLayoutMetrics") {
          return { cssContentSize: { x: 0, y: 0, width: 900, height: 1200 } };
        }
        expect(command.params).toMatchObject({
          captureBeyondViewport: true,
          clip: { x: 0, y: 0, width: 900, height: 1200, scale: 1 },
          format: "jpeg",
          quality: 80,
        });
        return { data: Buffer.from("jpeg").toString("base64") };
      },
      executeExtensionCommand: async () => ({}),
      outputs: [{ id: "screenshot", mimeType: "image/jpeg", maxBytes: 1024 }],
      params: {
        tabId: 123,
        outputId: "screenshot",
        captureMode: "fullPage",
        format: "jpeg",
        quality: 80,
      },
      signal: new AbortController().signal,
      windowId: 1,
      writeOutput: async (write) => ({
        bytesWritten: Buffer.from(write.dataBase64, "base64").byteLength,
        done: write.done,
        offset: write.offset,
        outputId: write.outputId,
      }),
    });

    expect(methods).toEqual(["Page.getLayoutMetrics", "Page.captureScreenshot"]);
  });
});
