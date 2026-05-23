import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";

import type { CloudServerConfig } from "../config.js";

export interface FeedbackArchiveObject {
  readonly body: Buffer;
  readonly contentType?: string;
}

export interface FeedbackArchiveStorage {
  putArchive(input: {
    readonly key: string;
    readonly body: Buffer;
    readonly contentType: string;
  }): Promise<void>;
  getArchive(key: string): Promise<FeedbackArchiveObject | null>;
}

export const createFeedbackArchiveStorage = (config: CloudServerConfig): FeedbackArchiveStorage => {
  if (config.feedbackArchiveS3Bucket !== undefined) {
    return new S3FeedbackArchiveStorage({
      bucket: config.feedbackArchiveS3Bucket,
      region: config.awsRegion,
    });
  }

  return new LocalFeedbackArchiveStorage(config.feedbackArchiveLocalDir ?? ".local/feedback-archives");
};

export const buildFeedbackArchiveStorageKey = (
  config: CloudServerConfig,
  input: {
    readonly feedbackId: string;
    readonly computerId: string;
  },
): string => {
  const prefix = normalizeStoragePrefix(config.feedbackArchiveS3Prefix);
  const relativeKey = `feedback/${input.computerId}/${input.feedbackId}.zip`;
  return prefix.length === 0 ? relativeKey : `${prefix}/${relativeKey}`;
};

class LocalFeedbackArchiveStorage implements FeedbackArchiveStorage {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = resolve(rootDir);
  }

  async putArchive(input: {
    readonly key: string;
    readonly body: Buffer;
    readonly contentType: string;
  }): Promise<void> {
    const path = this.resolveKey(input.key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, input.body);
  }

  async getArchive(key: string): Promise<FeedbackArchiveObject | null> {
    const path = this.resolveKey(key);

    try {
      return {
        body: await readFile(path),
        contentType: "application/zip",
      };
    } catch (error) {
      if (isNodeErrorWithCode(error, "ENOENT")) {
        return null;
      }
      throw error;
    }
  }

  private resolveKey(key: string): string {
    const path = resolve(this.rootDir, key);

    if (path !== this.rootDir && !path.startsWith(`${this.rootDir}/`)) {
      throw new Error("Feedback archive key resolved outside storage root");
    }

    return path;
  }
}

class S3FeedbackArchiveStorage implements FeedbackArchiveStorage {
  private readonly client: {
    send(command: PutObjectCommand): Promise<unknown>;
    send(command: GetObjectCommand): Promise<{ readonly Body?: unknown; readonly ContentType?: string }>;
  };

  constructor(private readonly options: {
    readonly bucket: string;
    readonly region: string;
  }) {
    this.client = new S3Client({ region: options.region }) as unknown as S3FeedbackArchiveStorage["client"];
  }

  async putArchive(input: {
    readonly key: string;
    readonly body: Buffer;
    readonly contentType: string;
  }): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.options.bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
    }));
  }

  async getArchive(key: string): Promise<FeedbackArchiveObject | null> {
    try {
      const result = await this.client.send(new GetObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
      })) as { readonly Body?: unknown; readonly ContentType?: string };

      if (result.Body === undefined) {
        return { body: Buffer.alloc(0), contentType: result.ContentType };
      }

      return {
        body: await bodyToBuffer(result.Body),
        contentType: result.ContentType,
      };
    } catch (error) {
      if (error instanceof S3ServiceException && (error as { readonly name?: string }).name === "NoSuchKey") {
        return null;
      }
      throw error;
    }
  }
}

const bodyToBuffer = async (body: unknown): Promise<Buffer> => {
  if (Buffer.isBuffer(body)) {
    return body;
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  if (typeof body === "object" && body !== null && "transformToByteArray" in body) {
    const bytes = await (body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
    return Buffer.from(bytes);
  }

  throw new Error("Unsupported feedback archive storage body type");
};

const normalizeStoragePrefix = (prefix: string | undefined): string =>
  prefix
    ?.trim()
    .replace(/^\/+/u, "")
    .replace(/\/+$/u, "") ?? "";

const isNodeErrorWithCode = (error: unknown, code: string): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { readonly code?: unknown }).code === code;
