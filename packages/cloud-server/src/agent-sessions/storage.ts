import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

export interface AgentSessionObjectStorage {
  readonly bucket: string;
  putObject(input: AgentSessionPutObjectInput): Promise<void>;
  getObject(input: AgentSessionGetObjectInput): Promise<Uint8Array>;
}

export interface AgentSessionPutObjectInput {
  readonly key: string;
  readonly filePath: string;
  readonly sizeBytes: number;
  readonly contentType: string;
  readonly metadata?: Record<string, string>;
}

export interface AgentSessionGetObjectInput {
  readonly key: string;
}

export interface S3AgentSessionObjectStorageOptions {
  readonly bucket: string;
  readonly region: string;
  readonly kmsKeyId?: string;
}

export class S3AgentSessionObjectStorage implements AgentSessionObjectStorage {
  readonly bucket: string;
  private readonly client: S3Client;
  private readonly kmsKeyId?: string;

  constructor(options: S3AgentSessionObjectStorageOptions) {
    this.bucket = options.bucket;
    this.client = new S3Client({ region: options.region });
    this.kmsKeyId = options.kmsKeyId;
  }

  async putObject(input: AgentSessionPutObjectInput): Promise<void> {
    await new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: input.key,
        Body: createReadStream(input.filePath),
        ContentLength: input.sizeBytes,
        ContentType: input.contentType,
        Metadata: input.metadata,
        ...(this.kmsKeyId !== undefined
          ? { ServerSideEncryption: "aws:kms" as const, SSEKMSKeyId: this.kmsKeyId }
          : {}),
      },
    }).done();
  }

  async getObject(input: AgentSessionGetObjectInput): Promise<Uint8Array> {
    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: input.key,
    }));

    if (response.Body === undefined) {
      return new Uint8Array();
    }

    return response.Body.transformToByteArray();
  }
}

export class InMemoryAgentSessionObjectStorage implements AgentSessionObjectStorage {
  readonly objects = new Map<string, Uint8Array>();

  constructor(readonly bucket: string = "agent-session-test-bucket") {}

  async putObject(input: AgentSessionPutObjectInput): Promise<void> {
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(input.filePath);
      stream.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      stream.once("error", reject);
      stream.once("end", resolve);
    });
    this.objects.set(input.key, Buffer.concat(chunks));
  }

  async getObject(input: AgentSessionGetObjectInput): Promise<Uint8Array> {
    const object = this.objects.get(input.key);

    if (object === undefined) {
      throw new Error(`Object not found: ${input.key}`);
    }

    return object;
  }
}

export class FileAgentSessionObjectStorage implements AgentSessionObjectStorage {
  readonly bucket = "local-filesystem";
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async putObject(input: AgentSessionPutObjectInput): Promise<void> {
    const target = this.resolveKey(input.key);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(input.filePath, target);
  }

  async getObject(input: AgentSessionGetObjectInput): Promise<Uint8Array> {
    return readFile(this.resolveKey(input.key));
  }

  private resolveKey(key: string): string {
    const target = resolve(this.root, key);

    if (target !== this.root && !target.startsWith(`${this.root}/`)) {
      throw new Error(`Invalid object key: ${key}`);
    }

    return target;
  }
}
