import { Hono } from "hono";

import type { CloudStore, ReleaseManifestRecord, ReleaseTarget } from "../db/types.js";
import { stringField } from "../shared/validation.js";

export const DEFAULT_RELEASE_CHANNEL = "stable";
export const DEFAULT_RELEASE_PLATFORM = "default";

export const createReleaseRoutes = (store: CloudStore): Hono => {
  const app = new Hono();

  app.get("/desktop/latest", async (context) => {
    const channel = readQueryString(context.req.query("channel"), DEFAULT_RELEASE_CHANNEL);
    const platform = readQueryString(context.req.query("platform"), "");
    const currentVersion = readQueryString(context.req.query("currentVersion"), null);

    if (platform === "") {
      return context.json({
        latest: null,
        updateAvailable: false,
        currentVersion,
        error: {
          code: "PLATFORM_REQUIRED",
          message: "platform is required",
        },
      }, 400);
    }

    const manifest = await store.getReleaseManifest({
      target: "desktop",
      channel,
      platform,
    });

    return context.json(buildReleaseCheckResponse(manifest, currentVersion));
  });

  app.get("/machine-server/latest", async (context) => {
    const channel = readQueryString(context.req.query("channel"), DEFAULT_RELEASE_CHANNEL);
    const currentVersion = readQueryString(context.req.query("currentVersion"), null);
    const manifest = await store.getReleaseManifest({
      target: "machine-server",
      channel,
      platform: DEFAULT_RELEASE_PLATFORM,
    });

    return context.json(buildReleaseCheckResponse(manifest, currentVersion));
  });

  return app;
};

export const buildReleaseCheckResponse = (
  manifest: ReleaseManifestRecord | null,
  currentVersion: string | null,
) => ({
  latest: manifest === null ? null : serializeReleaseManifest(manifest),
  currentVersion,
  updateAvailable: manifest !== null && currentVersion !== null && currentVersion !== manifest.version,
});

export const serializeReleaseManifest = (manifest: ReleaseManifestRecord) => ({
  id: manifest.id,
  target: manifest.target,
  channel: manifest.channel,
  platform: manifest.platform,
  version: manifest.version,
  downloadUrl: manifest.downloadUrl,
  signatureUrl: manifest.signatureUrl,
  dockerImage: manifest.dockerImage,
  notes: manifest.notes,
  metadata: manifest.metadata,
  releasedAt: manifest.releasedAt.toISOString(),
  createdAt: manifest.createdAt.toISOString(),
  updatedAt: manifest.updatedAt.toISOString(),
});

export const readReleaseChannel = (input: Record<string, unknown>): string =>
  stringField(input, "channel", { maxLength: 80 }) ?? DEFAULT_RELEASE_CHANNEL;

export const readReleasePlatform = (input: Record<string, unknown>): string =>
  stringField(input, "platform", { maxLength: 120 }) ?? DEFAULT_RELEASE_PLATFORM;

export const requireReleaseTarget = (target: unknown): ReleaseTarget => {
  if (target === "desktop" || target === "machine-server") {
    return target;
  }

  return "desktop";
};

function readQueryString(value: string | undefined, fallback: string): string;
function readQueryString(value: string | undefined, fallback: null): string | null;
function readQueryString(value: string | undefined, fallback: string | null): string | null {
  if (value === undefined) {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? fallback : trimmed;
}
