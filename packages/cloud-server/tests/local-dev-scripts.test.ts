import { describe, expect, it } from "vitest";

import {
  createLocalCloudEnv,
} from "../../../scripts/local-dev/cloud.mjs";
import { getDevelopmentCloudServerConfig } from "../src/config.js";
import {
  createLocalReleasePlan,
  createManifestPayload,
} from "../../../scripts/local-dev/release-machine-server.mjs";

describe("local machine-server release publisher", () => {
  it("enables AI gateway body capture in the local cloud environment", () => {
    const previous = process.env.AI_GATEWAY_CAPTURE_BODIES;
    delete process.env.AI_GATEWAY_CAPTURE_BODIES;

    try {
      const env = createLocalCloudEnv();
      expect(env.AI_GATEWAY_CAPTURE_BODIES).toBe("true");
    } finally {
      if (previous === undefined) {
        delete process.env.AI_GATEWAY_CAPTURE_BODIES;
      } else {
        process.env.AI_GATEWAY_CAPTURE_BODIES = previous;
      }
    }
  });

  it("allows the web Vite dev origin in local CORS defaults", () => {
    const previous = process.env.CLOUD_SERVER_ALLOWED_ORIGINS;
    delete process.env.CLOUD_SERVER_ALLOWED_ORIGINS;

    try {
      const env = createLocalCloudEnv();
      const origins = env.CLOUD_SERVER_ALLOWED_ORIGINS?.split(",");
      expect(origins).toContain("http://localhost:5175");
      expect(origins).toContain("http://127.0.0.1:5175");

      const config = getDevelopmentCloudServerConfig(env);
      expect(config.allowedOrigins).toContain("http://localhost:5175");
      expect(config.allowedOrigins).toContain("http://127.0.0.1:5175");
    } finally {
      if (previous === undefined) {
        delete process.env.CLOUD_SERVER_ALLOWED_ORIGINS;
      } else {
        process.env.CLOUD_SERVER_ALLOWED_ORIGINS = previous;
      }
    }
  });

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
