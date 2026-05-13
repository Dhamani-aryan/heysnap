import { describe, expect, it } from "vitest";

import { resolveMarkdownFileLinkMeta, rewriteMarkdownFileUriHref } from "./markdown-links";

describe("markdown file links", () => {
  it("resolves relative links against the current transcript path", () => {
    const meta = resolveMarkdownFileLinkMeta(
      "../src/app.tsx:12:4",
      "apps/web/pages",
      "/Users/notacoder/Desktop/agents/ank1015-app",
    );

    expect(meta).toMatchObject({
      targetPath: "apps/web/src/app.tsx",
      fullPath: "/Users/notacoder/Desktop/agents/ank1015-app/apps/web/src/app.tsx",
      line: 12,
      column: 4,
      basename: "app.tsx",
    });
  });

  it("keeps absolute workspace paths openable as workspace-relative file targets", () => {
    const meta = resolveMarkdownFileLinkMeta(
      "/Users/notacoder/Desktop/agents/ank1015-app/packages/ui/src/index.ts#L7",
      "packages/ui",
      "/Users/notacoder/Desktop/agents/ank1015-app",
    );

    expect(meta).toMatchObject({
      targetPath: "packages/ui/src/index.ts",
      fullPath: "/Users/notacoder/Desktop/agents/ank1015-app/packages/ui/src/index.ts",
      line: 7,
      basename: "index.ts",
    });
  });

  it("resolves machine /workspace links as workspace-relative file targets", () => {
    expect(resolveMarkdownFileLinkMeta("/workspace/Welcome/get_started.md", "", undefined)).toMatchObject({
      targetPath: "Welcome/get_started.md",
      fullPath: "/workspace/Welcome/get_started.md",
      basename: "get_started.md",
    });
    expect(resolveMarkdownFileLinkMeta("/workspace", "", undefined)).toMatchObject({
      targetPath: "",
      fullPath: "/workspace",
      basename: "",
    });
  });

  it("resolves same-app /workspace urls as workspace-relative file targets", () => {
    expect(
      resolveMarkdownFileLinkMeta("http://localhost:3000/workspace/2024-calendar-planner-v2%20(1).xlsx", "", undefined),
    ).toMatchObject({
      targetPath: "2024-calendar-planner-v2 (1).xlsx",
      fullPath: "/workspace/2024-calendar-planner-v2 (1).xlsx",
      basename: "2024-calendar-planner-v2 (1).xlsx",
    });
  });

  it("decodes file URIs before resolving link metadata", () => {
    const href = "file:///Users/notacoder/Desktop/agents/ank1015-app/packages/ui/src/agent/agent-panel.tsx#L42";

    expect(rewriteMarkdownFileUriHref(href)).toBe(
      "/Users/notacoder/Desktop/agents/ank1015-app/packages/ui/src/agent/agent-panel.tsx#L42",
    );
    expect(resolveMarkdownFileLinkMeta(href, "packages/ui", "/Users/notacoder/Desktop/agents/ank1015-app")).toMatchObject({
      targetPath: "packages/ui/src/agent/agent-panel.tsx",
      line: 42,
    });
  });

  it("ignores external links and path traversal outside the current path", () => {
    expect(resolveMarkdownFileLinkMeta("https://example.com/file.ts", "packages/ui", undefined)).toBeNull();
    expect(resolveMarkdownFileLinkMeta("../../../outside.ts", "packages/ui", undefined)).toBeNull();
  });
});
