import { describe, expect, it } from "vitest";

import { shouldWaitForNavigationCommit } from "./machine-workspace";

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
