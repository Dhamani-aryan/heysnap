import { describe, expect, it } from "vitest";

import {
  buildFilesystemPreviewerUrl,
  deriveFilesystemPreviewBaseUrl,
  resolveFilesystemPreviewBaseUrl,
} from "./file-preview";

describe("standalone file preview urls", () => {
  it("derives the local preview base URL from the filesystem websocket URL", () => {
    expect(deriveFilesystemPreviewBaseUrl("ws://127.0.0.1:4000/filesystem")).toBe("http://127.0.0.1:4000/preview");
    expect(deriveFilesystemPreviewBaseUrl("wss://machine.example.com/filesystem?accessToken=token")).toBe(
      "https://machine.example.com/preview?accessToken=token",
    );
  });

  it("does not synthesize gateway preview routes when the access session did not provide one", () => {
    expect(
      resolveFilesystemPreviewBaseUrl("wss://api.example.com/gateway/computers/cmp_123/filesystem?accessToken=token"),
    ).toBeNull();
    expect(
      resolveFilesystemPreviewBaseUrl(
        "wss://api.example.com/gateway/computers/cmp_123/filesystem?accessToken=token",
        "https://api.example.com/gateway/computers/cmp_123/preview?accessToken=token",
      ),
    ).toBe("https://api.example.com/gateway/computers/cmp_123/preview?accessToken=token");
  });

  it("builds iframe URLs without dropping existing access tokens", () => {
    const url = new URL(buildFilesystemPreviewerUrl(
      "https://api.example.com/gateway/computers/cmp_123/preview?accessToken=token",
      "Reports/Budget Sheet.xlsx",
      "2026-05-21:1234",
    ));

    expect(url.pathname).toBe("/gateway/computers/cmp_123/preview");
    expect(url.searchParams.get("accessToken")).toBe("token");
    expect(url.searchParams.get("path")).toBe("Reports/Budget Sheet.xlsx");
    expect(url.searchParams.get("chrome")).toBe("0");
    expect(url.searchParams.get("v")).toBe("2026-05-21:1234");
  });
});
