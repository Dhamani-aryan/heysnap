import { Hono } from "hono";

import { requireAuth } from "../auth/middleware.js";
import type { AuthService } from "../auth/service.js";
import type { CloudServerConfig } from "../config.js";
import { badGateway, badRequest, serviceUnavailable } from "../shared/errors.js";
import type { AppVariables } from "../shared/context.js";
import { logger } from "../shared/logger.js";

const SARVAM_API_BASE_URL = "https://api.sarvam.ai";
const SARVAM_STT_MODEL = "saaras:v3";
const SARVAM_STT_MODE = "translit";
const SARVAM_BATCH_POLL_INTERVAL_MS = 2_000;
const SARVAM_BATCH_TIMEOUT_MS = 20 * 60 * 1_000;

type SarvamJobState = "Accepted" | "Pending" | "Running" | "Completed" | "Failed";

interface SarvamSignedUrlDetails {
  readonly file_url: string;
  readonly file_metadata?: Record<string, unknown> | null;
}

interface SarvamTaskFileDetails {
  readonly file_name: string;
  readonly file_id: string;
}

interface SarvamTaskDetail {
  readonly outputs?: SarvamTaskFileDetails[];
  readonly state?: string;
  readonly error_message?: string | null;
}

interface SarvamBatchStatusResponse {
  readonly job_state: SarvamJobState;
  readonly job_id: string;
  readonly job_details?: SarvamTaskDetail[];
  readonly error_message?: string;
}

interface SarvamBatchInitResponse {
  readonly job_id: string;
}

interface SarvamUploadLinksResponse {
  readonly upload_urls: Record<string, SarvamSignedUrlDetails>;
  readonly storage_container_type?: string;
}

interface SarvamDownloadLinksResponse {
  readonly download_urls: Record<string, SarvamSignedUrlDetails>;
}

export const createSarvamGatewayRoutes = (
  authService: AuthService,
  config: CloudServerConfig,
): Hono<{ Variables: AppVariables }> => {
  const app = new Hono<{ Variables: AppVariables }>();

  app.post("/speech-to-text/batch", requireAuth(authService), async (context) => {
    logger.info({ event: "sarvam.batch.received" }, "Received Sarvam batch request");
    const apiKey = config.sarvamApiKey;

    if (apiKey === undefined || apiKey.length === 0) {
      logger.warn({ event: "sarvam.batch.not_configured" }, "Sarvam gateway not configured");
      throw serviceUnavailable("SARVAM_GATEWAY_NOT_CONFIGURED", "Sarvam gateway is not configured");
    }

    const formData = await context.req.raw.formData();
    const audioFile = formData.get("file");

    if (!(audioFile instanceof File) || audioFile.size === 0) {
      logger.warn({ event: "sarvam.batch.invalid_audio" }, "Sarvam batch missing audio file");
      throw badRequest("SARVAM_INVALID_AUDIO", "A non-empty audio file is required.");
    }

    const fileName = sanitizeSarvamAudioFileName(audioFile.name, audioFile.type);
    logger.info(
      { event: "sarvam.batch.start", fileName, sizeBytes: audioFile.size, mimeType: audioFile.type },
      "Starting Sarvam batch transcription",
    );

    try {
      const result = await transcribeBatchSarvamAudio({
        apiKey,
        audioFile,
        fileName,
      });
      logger.info({ event: "sarvam.batch.complete", fileName }, "Sarvam batch transcription complete");

      return context.json(result);
    } catch (error) {
      logger.error(
        { event: "sarvam.batch.error", err: error instanceof Error ? error.message : String(error) },
        "Sarvam batch transcription failed",
      );
      throw badGateway(
        "SARVAM_GATEWAY_UPSTREAM_ERROR",
        error instanceof Error ? error.message : "Sarvam batch speech-to-text failed.",
      );
    }
  });

  return app;
};

const transcribeBatchSarvamAudio = async ({
  apiKey,
  audioFile,
  fileName,
}: {
  readonly apiKey: string;
  readonly audioFile: File;
  readonly fileName: string;
}): Promise<unknown> => {
  logger.info({ event: "sarvam.batch.init" }, "Sarvam: creating job");
  const initResponse = await sarvamJsonFetch<SarvamBatchInitResponse>("/speech-to-text/job/v1", apiKey, {
    method: "POST",
    body: JSON.stringify({
      job_parameters: {
        model: SARVAM_STT_MODEL,
        mode: SARVAM_STT_MODE,
      },
    }),
  });
  const jobId = initResponse.job_id;
  logger.info({ event: "sarvam.batch.init.ok", jobId }, "Sarvam: job created");
  const uploadLinksResponse = await sarvamJsonFetch<SarvamUploadLinksResponse>(
    "/speech-to-text/job/v1/upload-files",
    apiKey,
    {
      method: "POST",
      body: JSON.stringify({
        job_id: jobId,
        files: [fileName],
      }),
    },
  );
  logger.info({ event: "sarvam.batch.upload_links.ok", jobId }, "Sarvam: upload URLs obtained");
  const uploadUrl = getSarvamSignedUrl(uploadLinksResponse.upload_urls, fileName);
  const uploadHeaders = createSarvamUploadHeaders(
    uploadUrl.file_metadata,
    audioFile.type,
    uploadLinksResponse.storage_container_type,
  );
  logger.info(
    { event: "sarvam.batch.upload.start", jobId, fileName, sizeBytes: audioFile.size },
    "Sarvam: uploading audio",
  );
  const uploadResponse = await fetch(uploadUrl.file_url, {
    method: "PUT",
    headers: uploadHeaders,
    body: audioFile,
  });

  if (!uploadResponse.ok) {
    throw new Error(`Sarvam batch upload failed with ${String(uploadResponse.status)}: ${await uploadResponse.text()}`);
  }
  logger.info({ event: "sarvam.batch.upload.ok", jobId }, "Sarvam: audio uploaded");

  await sarvamJsonFetch(`/speech-to-text/job/v1/${encodeURIComponent(jobId)}/start`, apiKey, {
    method: "POST",
    body: JSON.stringify({}),
  });
  logger.info({ event: "sarvam.batch.start.ok", jobId }, "Sarvam: job started, polling status");

  const status = await waitForSarvamBatchJob(apiKey, jobId);
  logger.info({ event: "sarvam.batch.status.complete", jobId, jobState: status.job_state }, "Sarvam: job reached terminal state");
  const outputFileNames = getSarvamOutputFileNames(status);
  const downloadLinksResponse = await sarvamJsonFetch<SarvamDownloadLinksResponse>(
    "/speech-to-text/job/v1/download-files",
    apiKey,
    {
      method: "POST",
      body: JSON.stringify({
        job_id: jobId,
        files: outputFileNames,
      }),
    },
  );

  return Promise.all(outputFileNames.map(async (outputFileName) => {
    const downloadUrl = getSarvamSignedUrl(downloadLinksResponse.download_urls, outputFileName);
    const response = await fetch(downloadUrl.file_url);

    if (!response.ok) {
      throw new Error(`Sarvam batch download failed with ${String(response.status)}: ${await response.text()}`);
    }

    return {
      fileName: outputFileName,
      output: await readPossiblyJsonResponse(response),
    };
  }));
};

const waitForSarvamBatchJob = async (
  apiKey: string,
  jobId: string,
): Promise<SarvamBatchStatusResponse> => {
  const startedAt = Date.now();
  let pollCount = 0;

  while (Date.now() - startedAt < SARVAM_BATCH_TIMEOUT_MS) {
    const status = await sarvamJsonFetch<SarvamBatchStatusResponse>(
      `/speech-to-text/job/v1/${encodeURIComponent(jobId)}/status`,
      apiKey,
      { method: "GET" },
    );
    pollCount += 1;
    logger.debug(
      { event: "sarvam.batch.poll", jobId, pollCount, jobState: status.job_state },
      "Sarvam: poll status",
    );

    if (status.job_state === "Completed") {
      return status;
    }

    if (status.job_state === "Failed") {
      throw new Error(status.error_message ?? "Sarvam batch speech-to-text job failed.");
    }

    await wait(SARVAM_BATCH_POLL_INTERVAL_MS);
  }

  throw new Error("Timed out waiting for Sarvam batch speech-to-text job.");
};

const sarvamJsonFetch = async <ResponseBody>(
  path: string,
  apiKey: string,
  init: RequestInit,
): Promise<ResponseBody> => {
  const response = await fetch(`${SARVAM_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "api-subscription-key": apiKey,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  return readSarvamJsonResponse(response) as Promise<ResponseBody>;
};

const readSarvamJsonResponse = async (response: Response): Promise<unknown> => {
  const body = await readPossiblyJsonResponse(response);

  if (!response.ok) {
    throw new Error(`Sarvam API failed with ${String(response.status)}: ${formatSarvamResponseBody(body)}`);
  }

  return body;
};

const readPossiblyJsonResponse = async (response: Response): Promise<unknown> => {
  const text = await response.text();

  if (text.length === 0) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

const formatSarvamResponseBody = (body: unknown): string => {
  if (typeof body === "string") {
    return body;
  }

  return JSON.stringify(body);
};

const getSarvamSignedUrl = (
  urls: Record<string, SarvamSignedUrlDetails>,
  fileName: string,
): SarvamSignedUrlDetails => {
  const url = urls[fileName] ?? Object.values(urls)[0];

  if (url === undefined) {
    throw new Error(`Sarvam did not return a signed URL for ${fileName}.`);
  }

  return url;
};

const createSarvamUploadHeaders = (
  metadata: Record<string, unknown> | null | undefined,
  contentType: string,
  storageContainerType: string | undefined,
): Headers => {
  const headers = new Headers();

  if (metadata !== null && metadata !== undefined) {
    for (const [key, value] of Object.entries(metadata)) {
      if (value !== null && value !== undefined) {
        headers.set(key, String(value));
      }
    }
  }

  if (!headers.has("Content-Type") && contentType.length > 0) {
    headers.set("Content-Type", contentType);
  }

  if (storageContainerType?.toLowerCase().startsWith("azure") === true && !headers.has("x-ms-blob-type")) {
    headers.set("x-ms-blob-type", "BlockBlob");
  }

  return headers;
};

const getSarvamOutputFileNames = (status: SarvamBatchStatusResponse): string[] => {
  const outputFileNames = status.job_details
    ?.filter((detail) => detail.state === undefined || detail.state === "Success")
    .flatMap((detail) => detail.outputs ?? [])
    .map((output) => output.file_name)
    .filter((fileName) => fileName.length > 0) ?? [];

  if (outputFileNames.length === 0) {
    const failedDetail = status.job_details?.find(
      (detail) => detail.error_message !== null && detail.error_message !== undefined,
    );
    throw new Error(failedDetail?.error_message ?? "Sarvam batch job completed without an output file.");
  }

  return outputFileNames;
};

const sanitizeSarvamAudioFileName = (fileName: string, mimeType: string): string => {
  const trimmedFileName = fileName.trim();
  const safeFileName = trimmedFileName.length === 0
    ? `heysnap-recording.${getAudioFileExtension(mimeType)}`
    : trimmedFileName.replaceAll(/[^a-zA-Z0-9._-]/g, "-");

  return safeFileName.includes(".") ? safeFileName : `${safeFileName}.${getAudioFileExtension(mimeType)}`;
};

const getAudioFileExtension = (mimeType: string): string => {
  const normalizedMimeType = mimeType.toLowerCase();

  if (normalizedMimeType.includes("ogg")) return "ogg";
  if (normalizedMimeType.includes("mp4")) return "m4a";
  if (normalizedMimeType.includes("mpeg") || normalizedMimeType.includes("mp3")) return "mp3";
  if (normalizedMimeType.includes("wav")) return "wav";

  return "webm";
};

const wait = (durationMs: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, durationMs);
});
