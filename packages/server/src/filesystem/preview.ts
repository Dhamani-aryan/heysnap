import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { FilesystemError, toFilesystemError } from "./errors.js";
import { filesystemDownloadCorsHeaders } from "./download.js";
import { resolveClientPath } from "./paths.js";
import type { FilesystemRoot } from "./types.js";

const execFileAsync = promisify(execFile);
const PREVIEW_TIMEOUT_MS = 60_000;
const PDF_EXTENSION = ".pdf";
const SUPPORTED_OFFICE_PDF_PREVIEW_EXTENSIONS = new Set([".ppt", ".xls"]);

export interface OfficePdfConversionInput {
  readonly sourcePath: string;
  readonly outputDirectory: string;
}

export interface FilesystemPreviewOptions {
  readonly convertOfficeToPdf?: (input: OfficePdfConversionInput) => Promise<Buffer>;
}

export const handleFilesystemPreviewRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  root: FilesystemRoot,
  options: FilesystemPreviewOptions = {},
): Promise<void> => {
  const requestUrl = new URL(request.url ?? "/", "http://localhost");
  const rawPath = requestUrl.searchParams.get("path") ?? undefined;
  const format = requestUrl.searchParams.get("format") ?? "pdf";

  if (format !== "pdf") {
    throw new FilesystemError("UNSUPPORTED_PREVIEW_FORMAT", "Only PDF previews are supported");
  }

  if (rawPath === undefined || rawPath.length === 0) {
    throw new FilesystemError("INVALID_PATH", "Path is required");
  }

  const targetPath = resolveClientPath(root.absolutePath, rawPath);
  const targetStats = await getStats(targetPath);

  if (!targetStats.isFile()) {
    throw new FilesystemError("UNSUPPORTED_ENTRY", "Only files can be previewed");
  }

  const extension = extname(targetPath).toLowerCase();

  if (extension === PDF_EXTENSION) {
    const pdf = await readFile(targetPath);

    response.writeHead(200, {
      ...filesystemDownloadCorsHeaders,
      "content-type": "application/pdf",
      "content-length": String(pdf.byteLength),
      "content-disposition": `inline; filename="${escapeHeaderValue(basename(targetPath))}"`,
      "cache-control": "no-store",
    });
    response.end(pdf);
    return;
  }

  if (!SUPPORTED_OFFICE_PDF_PREVIEW_EXTENSIONS.has(extension)) {
    throw new FilesystemError("UNSUPPORTED_PREVIEW_TYPE", "This file type does not support PDF preview");
  }

  const pdf = await convertToPdfBuffer(targetPath, options);
  const previewName = `${basename(targetPath, extension)}.pdf`;

  response.writeHead(200, {
    ...filesystemDownloadCorsHeaders,
    "content-type": "application/pdf",
    "content-length": String(pdf.byteLength),
    "content-disposition": `inline; filename="${escapeHeaderValue(previewName)}"`,
    "cache-control": "no-store",
  });
  response.end(pdf);
};

export const sendFilesystemPreviewError = (
  response: ServerResponse,
  error: unknown,
): void => {
  const filesystemError = toFilesystemError(error);

  response.writeHead(getPreviewErrorStatus(filesystemError), {
    ...filesystemDownloadCorsHeaders,
    "content-type": "application/json",
  });
  response.end(JSON.stringify({
    code: filesystemError.code,
    message: filesystemError.message,
  }));
};

const convertToPdfBuffer = async (
  sourcePath: string,
  options: FilesystemPreviewOptions,
): Promise<Buffer> => {
  const outputDirectory = await mkPreviewDirectory();

  try {
    if (options.convertOfficeToPdf !== undefined) {
      return await options.convertOfficeToPdf({ sourcePath, outputDirectory });
    }

    return await convertOfficeFileToPdf({ sourcePath, outputDirectory });
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
};

const convertOfficeFileToPdf = async ({
  sourcePath,
  outputDirectory,
}: OfficePdfConversionInput): Promise<Buffer> => {
  const command = getLibreOfficeCommand();
  const sourceExtension = extname(sourcePath).toLowerCase();
  const temporarySourcePath = join(outputDirectory, `source${sourceExtension}`);
  const profileDirectory = join(outputDirectory, "profile");
  const expectedOutputPath = join(outputDirectory, "source.pdf");

  await copyFile(sourcePath, temporarySourcePath);
  await mkdir(profileDirectory, { recursive: true });

  try {
    await execFileAsync(command, [
      "--headless",
      "--invisible",
      "--nologo",
      "--nodefault",
      "--nofirststartwizard",
      `-env:UserInstallation=${pathToFileURL(profileDirectory).href}`,
      "--convert-to",
      "pdf",
      "--outdir",
      outputDirectory,
      temporarySourcePath,
    ], {
      timeout: PREVIEW_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    throw new FilesystemError(
      "PREVIEW_UNAVAILABLE",
      error instanceof Error
        ? `Failed to convert file preview: ${error.message}`
        : "Failed to convert file preview",
    );
  }

  try {
    return await readFile(await findConvertedPdfPath(outputDirectory, expectedOutputPath));
  } catch {
    throw new FilesystemError("PREVIEW_UNAVAILABLE", "Preview conversion did not produce a PDF");
  }
};

const findConvertedPdfPath = async (outputDirectory: string, expectedOutputPath: string): Promise<string> => {
  try {
    const expectedStats = await stat(expectedOutputPath);

    if (expectedStats.isFile()) {
      return expectedOutputPath;
    }
  } catch {
    // LibreOffice can occasionally choose a different output filename.
  }

  const outputEntries = await readdir(outputDirectory, { withFileTypes: true });
  const pdfPaths = outputEntries
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".pdf")
    .map((entry) => join(outputDirectory, entry.name))
    .sort((left, right) => left.localeCompare(right));

  if (pdfPaths.length > 0) {
    return pdfPaths[0]!;
  }

  throw new FilesystemError("PREVIEW_UNAVAILABLE", "Preview conversion did not produce a PDF");
};

const getLibreOfficeCommand = (): string => {
  const configuredCommand = process.env.LIBREOFFICE_BIN?.trim() || process.env.SOFFICE_BIN?.trim();

  if (configuredCommand !== undefined && configuredCommand.length > 0) {
    return configuredCommand;
  }

  const commonCommands = [
    "/opt/homebrew/bin/soffice",
    "/usr/local/bin/soffice",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  ];
  const existingCommand = commonCommands.find((command) => existsSync(command));

  return existingCommand ?? "soffice";
};

const mkPreviewDirectory = async (): Promise<string> => {
  const { mkdtemp } = await import("node:fs/promises");
  return mkdtemp(join(tmpdir(), "ank1015-preview-"));
};

const getStats = async (targetPath: string): Promise<Awaited<ReturnType<typeof stat>>> => {
  try {
    return await stat(targetPath);
  } catch {
    throw new FilesystemError("PATH_NOT_FOUND", "Path not found");
  }
};

const getPreviewErrorStatus = (error: FilesystemError): number => {
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

const escapeHeaderValue = (value: string): string =>
  value.replace(/["\\]/gu, "");
