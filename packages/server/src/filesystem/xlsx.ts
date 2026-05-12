import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";

import { FilesystemError, toFilesystemError } from "./errors.js";
import { resolveClientPath } from "./paths.js";
import type { FilesystemRoot } from "./types.js";

const XLSX_EXTENSION = ".xlsx";
const DEFAULT_XLSX_CLI = "heysnap-xlsxl";
const DEFAULT_XLSX_TIMEOUT_MS = 60_000;
const XLSX_ASSET_ID_HEADER = "x-heysnap-xlsx-asset-id";

export const filesystemXlsxCorsHeaders = {
  "access-control-allow-headers": "Range",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-origin": "*",
  "access-control-expose-headers": `Content-Disposition, Content-Length, Content-Range, ${XLSX_ASSET_ID_HEADER}`,
} as const;

export interface XlsxConversionInput {
  readonly sourcePath: string;
  readonly outputDirectory: string;
}

export interface FilesystemXlsxOptions {
  readonly convertXlsxToWorkbook?: (input: XlsxConversionInput) => Promise<unknown>;
  readonly xlsxCliBin?: string;
  readonly xlsxCliTimeoutMs?: number;
  readonly xlsxAssetRoot?: string;
}

export const handleFilesystemXlsxRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  root: FilesystemRoot,
  options: FilesystemXlsxOptions = {},
): Promise<void> => {
  const requestUrl = new URL(request.url ?? "/", "http://localhost");

  if (requestUrl.pathname.startsWith("/filesystem/xlsx-assets/")) {
    await handleFilesystemXlsxAssetRequest(requestUrl, response, options);
    return;
  }

  const rawPath = requestUrl.searchParams.get("path") ?? undefined;

  if (rawPath === undefined || rawPath.length === 0) {
    throw new FilesystemError("INVALID_PATH", "Path is required");
  }

  const targetPath = resolveClientPath(root.absolutePath, rawPath);
  const targetStats = await getStats(targetPath);

  if (!targetStats.isFile()) {
    throw new FilesystemError("UNSUPPORTED_ENTRY", "Only files can be parsed as XLSX");
  }

  if (extname(targetPath).toLowerCase() !== XLSX_EXTENSION) {
    throw new FilesystemError("UNSUPPORTED_PREVIEW_TYPE", "This file type does not support XLSX preview");
  }

  const assetId = randomUUID();
  const outputDirectory = join(getXlsxAssetRoot(options), assetId);
  const sourcePath = join(outputDirectory, "source.xlsx");

  await mkdir(outputDirectory, { recursive: true });

  try {
    await copyFile(targetPath, sourcePath);
    const workbook = await convertXlsxToWorkbook({ sourcePath, outputDirectory }, options);
    stripWorkbookChartAssets(workbook);

    response.writeHead(200, {
      ...filesystemXlsxCorsHeaders,
      [XLSX_ASSET_ID_HEADER]: assetId,
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    response.end(JSON.stringify(workbook));
  } finally {
    await rm(sourcePath, { force: true });
  }
};

export const sendFilesystemXlsxError = (
  response: ServerResponse,
  error: unknown,
): void => {
  const filesystemError = toFilesystemError(error);

  response.writeHead(getXlsxErrorStatus(filesystemError), {
    ...filesystemXlsxCorsHeaders,
    "content-type": "application/json",
  });
  response.end(JSON.stringify({
    code: filesystemError.code,
    message: filesystemError.message,
  }));
};

const handleFilesystemXlsxAssetRequest = async (
  requestUrl: URL,
  response: ServerResponse,
  options: FilesystemXlsxOptions,
): Promise<void> => {
  const match = /^\/filesystem\/xlsx-assets\/([^/]+)\/(.+)$/u.exec(requestUrl.pathname);

  if (match === null) {
    throw new FilesystemError("INVALID_PATH", "Asset path is required");
  }

  const assetId = decodeURIComponent(match[1] ?? "");
  const relativePath = decodeURIComponent(match[2] ?? "");
  const assetPath = safeResolveAssetPath(getXlsxAssetRoot(options), assetId, relativePath);

  if (assetPath === null) {
    throw new FilesystemError("INVALID_PATH", "Invalid asset path");
  }

  const content = await readFile(assetPath);
  response.writeHead(200, {
    ...filesystemXlsxCorsHeaders,
    "content-type": getAssetContentType(assetPath),
    "content-length": String(content.byteLength),
    "cache-control": "no-store",
  });
  response.end(content);
};

const convertXlsxToWorkbook = async (
  input: XlsxConversionInput,
  options: FilesystemXlsxOptions,
): Promise<unknown> => {
  if (options.convertXlsxToWorkbook !== undefined) {
    return options.convertXlsxToWorkbook(input);
  }

  await runXlsxCli(input.sourcePath, input.outputDirectory, options);
  const workbookJsonPath = join(input.outputDirectory, "workbook.json");
  return JSON.parse(await readFile(workbookJsonPath, "utf8")) as unknown;
};

const runXlsxCli = (
  sourcePath: string,
  outputDirectory: string,
  options: FilesystemXlsxOptions,
): Promise<void> =>
  new Promise((resolveRun, rejectRun) => {
    const child = spawn(options.xlsxCliBin?.trim() || DEFAULT_XLSX_CLI, [
      "xlsx-assets",
      sourcePath,
      outputDirectory,
    ], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill("SIGKILL");
      rejectRun(new FilesystemError(
        "PREVIEW_UNAVAILABLE",
        `heysnap-xlsxl timed out after ${String(options.xlsxCliTimeoutMs ?? DEFAULT_XLSX_TIMEOUT_MS)} ms`,
      ));
    }, options.xlsxCliTimeoutMs ?? DEFAULT_XLSX_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      rejectRun(new FilesystemError("PREVIEW_UNAVAILABLE", `Failed to run heysnap-xlsxl: ${error.message}`));
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      if (code !== 0) {
        rejectRun(new FilesystemError(
          "PREVIEW_UNAVAILABLE",
          renderXlsxCliError(code ?? -1, stdout, stderr),
        ));
        return;
      }

      resolveRun();
    });
  });

const renderXlsxCliError = (code: number, stdout: string, stderr: string): string => {
  const detail = [stderr.trim(), stdout.trim()].filter((value) => value.length > 0).join("\n");

  return detail.length > 0
    ? `heysnap-xlsxl failed (${String(code)}): ${detail}`
    : `heysnap-xlsxl failed (${String(code)})`;
};

const stripWorkbookChartAssets = (workbook: unknown): void => {
  const root = asRecord(workbook);
  const workbookRecord = asRecord(root?.["workbook"]);
  const sheets = Array.isArray(workbookRecord?.["sheets"]) ? workbookRecord["sheets"] : [];

  for (const sheetValue of sheets) {
    const sheet = asRecord(sheetValue);
    if (sheet === null) {
      continue;
    }

    const drawings = Array.isArray(sheet["drawings"]) ? sheet["drawings"] : [];
    for (const drawingValue of drawings) {
      const drawing = asRecord(drawingValue);
      const charts = Array.isArray(drawing?.["charts"]) ? drawing["charts"] : [];
      charts.forEach(stripChartAssetFields);
    }

    const charts = Array.isArray(sheet["charts"]) ? sheet["charts"] : [];
    charts.forEach(stripChartAssetFields);
  }
};

const stripChartAssetFields = (chartValue: unknown): void => {
  const chart = asRecord(chartValue);

  if (chart === null) {
    return;
  }

  delete chart["assetPath"];
  delete chart["assetUrl"];
  delete chart["renderedAssetPath"];
  delete chart["renderedAssetUrl"];
};

const safeResolveAssetPath = (assetRoot: string, assetId: string, relativePath: string): string | null => {
  if (assetId.length === 0 || relativePath.length === 0) {
    return null;
  }

  const base = resolve(assetRoot, assetId);
  const assetPath = resolve(base, relativePath);

  return assetPath === base || assetPath.startsWith(base + sep) ? assetPath : null;
};

const getXlsxAssetRoot = (options: FilesystemXlsxOptions): string =>
  options.xlsxAssetRoot ?? join(tmpdir(), "ank1015-xlsx-assets");

const getStats = async (targetPath: string): Promise<Awaited<ReturnType<typeof stat>>> => {
  try {
    return await stat(targetPath);
  } catch {
    throw new FilesystemError("PATH_NOT_FOUND", "Path not found");
  }
};

const getXlsxErrorStatus = (error: FilesystemError): number => {
  switch (error.code) {
    case "PATH_NOT_FOUND":
      return 404;
    case "UNSUPPORTED_PREVIEW_TYPE":
    case "UNSUPPORTED_ENTRY":
      return 415;
    case "PREVIEW_UNAVAILABLE":
      return 503;
    default:
      return 400;
  }
};

const getAssetContentType = (assetPath: string): string => {
  const contentTypesByExtension: Record<string, string> = {
    ".bmp": "image/bmp",
    ".bin": "application/octet-stream",
    ".emf": "application/octet-stream",
    ".gif": "image/gif",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".wmf": "application/octet-stream",
    ".xml": "application/xml",
  };

  return contentTypesByExtension[extname(assetPath).toLowerCase()] ?? "application/octet-stream";
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
