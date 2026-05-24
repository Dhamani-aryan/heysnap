const SARVAM_API_BASE_URL = "https://api.sarvam.ai";
const SARVAM_SHORT_AUDIO_MAX_SECONDS = 30;
const SARVAM_STT_MODEL = "saaras:v3";
const SARVAM_STT_MODE = "translit";
const SARVAM_BATCH_POLL_INTERVAL_MS = 2_000;
const SARVAM_BATCH_TIMEOUT_MS = 20 * 60 * 1_000;

type SarvamJobState = "Accepted" | "Pending" | "Running" | "Completed" | "Failed";

type SarvamSignedUrlDetails = {
  readonly file_url: string;
  readonly file_metadata?: Record<string, unknown> | null;
};

type SarvamTaskFileDetails = {
  readonly file_name: string;
  readonly file_id: string;
};

type SarvamTaskDetail = {
  readonly outputs?: SarvamTaskFileDetails[];
  readonly state?: string;
  readonly error_message?: string | null;
};

type SarvamBatchStatusResponse = {
  readonly job_state: SarvamJobState;
  readonly job_id: string;
  readonly job_details?: SarvamTaskDetail[];
  readonly error_message?: string;
};

type SarvamBatchInitResponse = {
  readonly job_id: string;
};

type SarvamUploadLinksResponse = {
  readonly upload_urls: Record<string, SarvamSignedUrlDetails>;
  readonly storage_container_type?: string;
};

type SarvamDownloadLinksResponse = {
  readonly download_urls: Record<string, SarvamSignedUrlDetails>;
};

export const getPreferredRecordingMimeType = (): string | undefined => {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return undefined;
  }

  return [
    "audio/ogg;codecs=opus",
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
  ].find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
};

export const normalizeSarvamAudioMimeType = (mimeType: string): string => {
  const normalizedMimeType = mimeType.toLowerCase().split(";")[0]?.trim() ?? "";

  if (normalizedMimeType === "audio/webm" || normalizedMimeType === "video/webm") {
    return "audio/webm";
  }

  if (normalizedMimeType === "audio/ogg" || normalizedMimeType === "audio/opus") {
    return normalizedMimeType;
  }

  if (normalizedMimeType === "audio/mp4" || normalizedMimeType === "audio/x-m4a") {
    return normalizedMimeType;
  }

  if (normalizedMimeType === "audio/wav" || normalizedMimeType === "audio/x-wav" || normalizedMimeType === "audio/wave") {
    return normalizedMimeType;
  }

  if (normalizedMimeType === "audio/mpeg" || normalizedMimeType === "audio/mp3") {
    return normalizedMimeType;
  }

  return "audio/webm";
};

export const transcribeSarvamRecording = async ({
  apiKey,
  audioBlob,
  durationSeconds,
}: {
  readonly apiKey?: string;
  readonly audioBlob: Blob;
  readonly durationSeconds: number;
}): Promise<unknown> => {
  if (audioBlob.size === 0) {
    console.warn("Sarvam STT skipped because the recording was empty.");
    return null;
  }

  if (apiKey === undefined || apiKey.length === 0) {
    console.warn("Sarvam STT skipped because NEXT_PUBLIC_SARVAM_API_KEY is not set.");
    return null;
  }

  const fileName = createSarvamAudioFileName(audioBlob.type);
  const result = durationSeconds < SARVAM_SHORT_AUDIO_MAX_SECONDS
    ? await transcribeShortSarvamAudio({ apiKey, audioBlob, fileName })
    : await transcribeBatchSarvamAudio({ apiKey, audioBlob, fileName });

  return result;
};

export const extractSarvamTranscript = (result: unknown): string | null => {
  if (typeof result === "string") {
    const trimmed = result.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  if (Array.isArray(result)) {
    const joined = result
      .map((item) => extractSarvamTranscript(item))
      .filter((transcript): transcript is string => transcript !== null)
      .join("\n")
      .trim();

    return joined.length === 0 ? null : joined;
  }

  if (typeof result !== "object" || result === null) {
    return null;
  }

  const record = result as Record<string, unknown>;

  if (typeof record["transcript"] === "string") {
    const transcript = record["transcript"].trim();
    return transcript.length === 0 ? null : transcript;
  }

  if ("output" in record) {
    return extractSarvamTranscript(record["output"]);
  }

  if (Array.isArray(record["transcripts"])) {
    return extractSarvamTranscript(record["transcripts"]);
  }

  return null;
};

const transcribeShortSarvamAudio = async ({
  apiKey,
  audioBlob,
  fileName,
}: {
  readonly apiKey: string;
  readonly audioBlob: Blob;
  readonly fileName: string;
}): Promise<unknown> => {
  const formData = new FormData();
  formData.set("model", SARVAM_STT_MODEL);
  formData.set("mode", SARVAM_STT_MODE);
  formData.set("file", audioBlob, fileName);

  const response = await fetch(`${SARVAM_API_BASE_URL}/speech-to-text`, {
    method: "POST",
    headers: {
      "api-subscription-key": apiKey,
    },
    body: formData,
  });

  return readSarvamJsonResponse(response);
};

const transcribeBatchSarvamAudio = async ({
  apiKey,
  audioBlob,
  fileName,
}: {
  readonly apiKey: string;
  readonly audioBlob: Blob;
  readonly fileName: string;
}): Promise<unknown> => {
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
  const uploadUrl = getSarvamSignedUrl(uploadLinksResponse.upload_urls, fileName);
  const uploadHeaders = createSarvamUploadHeaders(
    uploadUrl.file_metadata,
    audioBlob.type,
    uploadLinksResponse.storage_container_type,
  );
  const uploadResponse = await fetch(uploadUrl.file_url, {
    method: "PUT",
    headers: uploadHeaders,
    body: audioBlob,
  });

  if (!uploadResponse.ok) {
    throw new Error(`Sarvam batch upload failed with ${uploadResponse.status}: ${await uploadResponse.text()}`);
  }

  await sarvamJsonFetch(`/speech-to-text/job/v1/${encodeURIComponent(jobId)}/start`, apiKey, {
    method: "POST",
    body: JSON.stringify({}),
  });

  const status = await waitForSarvamBatchJob(apiKey, jobId);
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
      throw new Error(`Sarvam batch download failed with ${response.status}: ${await response.text()}`);
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

  while (Date.now() - startedAt < SARVAM_BATCH_TIMEOUT_MS) {
    const status = await sarvamJsonFetch<SarvamBatchStatusResponse>(
      `/speech-to-text/job/v1/${encodeURIComponent(jobId)}/status`,
      apiKey,
      { method: "GET" },
    );

    if (status.job_state === "Completed") {
      return status;
    }

    if (status.job_state === "Failed") {
      throw new Error(status.error_message || "Sarvam batch speech-to-text job failed.");
    }

    await wait(SARVAM_BATCH_POLL_INTERVAL_MS);
  }

  throw new Error("Timed out waiting for Sarvam batch speech-to-text job.");
};

const sarvamJsonFetch = async <ResponseBody,>(
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
    throw new Error(`Sarvam API failed with ${response.status}: ${formatSarvamResponseBody(body)}`);
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
    const failedDetail = status.job_details?.find((detail) => detail.error_message !== null && detail.error_message !== undefined);
    throw new Error(failedDetail?.error_message ?? "Sarvam batch job completed without an output file.");
  }

  return outputFileNames;
};

const createSarvamAudioFileName = (mimeType: string): string => {
  const extension = getAudioFileExtension(mimeType);
  return `heysnap-recording-${Date.now()}.${extension}`;
};

const getAudioFileExtension = (mimeType: string): string => {
  const normalizedMimeType = mimeType.toLowerCase();

  if (normalizedMimeType.includes("ogg")) {
    return "ogg";
  }

  if (normalizedMimeType.includes("mp4")) {
    return "m4a";
  }

  if (normalizedMimeType.includes("mpeg") || normalizedMimeType.includes("mp3")) {
    return "mp3";
  }

  if (normalizedMimeType.includes("wav")) {
    return "wav";
  }

  return "webm";
};

const wait = (durationMs: number): Promise<void> => new Promise((resolve) => {
  window.setTimeout(resolve, durationMs);
});
