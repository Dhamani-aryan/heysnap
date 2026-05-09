import { describe, expect, it } from "vitest";

import {
  createLocalReleasePlan,
  createManifestPayload,
} from "../../../scripts/local-dev/release-machine-server.mjs";

describe("local machine-server release publisher", () => {
  it("builds a local-channel artifact plan and manifest payload", () => {
    const plan = createLocalReleasePlan({
      LOCAL_MACHINE_SERVER_VERSION: "0.0.0-local.test",
      MACHINE_SERVER_CHANNEL: "local",
      LOCAL_MACHINE_SERVER_PLATFORM: "linux-x64",
      LOCAL_ARTIFACT_BASE_URL: "http://host.docker.internal:4101",
    }, new Date("2026-05-09T12:34:56.000Z"));
    const payload = createManifestPayload(plan, {
      sha256: "abc123",
      sizeBytes: 1234,
    });

    expect(plan.archivePath).toContain(".local/artifacts/machine-server/local/0.0.0-local.test");
    expect(plan.artifactName).toBe("machine-server-0.0.0-local.test-linux-x64.tar.gz");
    expect(payload).toEqual({
      channel: "local",
      platform: "default",
      version: "0.0.0-local.test",
      downloadUrl: "http://host.docker.internal:4101/machine-server/local/0.0.0-local.test/machine-server-0.0.0-local.test-linux-x64.tar.gz",
      notes: "Local machine-server development release",
      metadata: {
        sha256: "abc123",
        artifactName: "machine-server-0.0.0-local.test-linux-x64.tar.gz",
        sizeBytes: 1234,
        local: true,
      },
    });
  });
});
