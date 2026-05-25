import { describe, expect, it } from "vitest";

import { normalizeFilesystemConnectionIdentity } from "../../src/filesystem/filesystem-url";

describe("filesystem connection url identity", () => {
  it("ignores volatile access and view query params", () => {
    expect(
      normalizeFilesystemConnectionIdentity(
        "wss://api.example.com/gateway/computers/cmp_123/filesystem?accessToken=first&path=src&showHidden=true&v=1",
      ),
    ).toBe(
      normalizeFilesystemConnectionIdentity(
        "wss://api.example.com/gateway/computers/cmp_123/filesystem?accessToken=second&path=docs&showHidden=false&v=2",
      ),
    );
  });

  it("keeps different machines distinct", () => {
    expect(
      normalizeFilesystemConnectionIdentity(
        "wss://api.example.com/gateway/computers/cmp_123/filesystem?accessToken=token",
      ),
    ).not.toBe(
      normalizeFilesystemConnectionIdentity(
        "wss://api.example.com/gateway/computers/cmp_456/filesystem?accessToken=token",
      ),
    );
  });

  it("keeps stable non-auth query params in sorted order", () => {
    expect(
      normalizeFilesystemConnectionIdentity(
        "wss://api.example.com/filesystem?z=last&accessToken=token&a=first",
      ),
    ).toBe("wss://api.example.com/filesystem?a=first&z=last");
  });
});
