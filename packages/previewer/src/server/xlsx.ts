import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_XLSX_CLI = "heysnap-xlsxl";
const DEFAULT_XLSX_TIMEOUT_MS = 60_000;

export interface XlsxConversionInput {
  readonly sourcePath: string;
  readonly outputDirectory: string;
}

export interface PreviewXlsxOptions {
  readonly convertXlsxToWorkbook?: (input: XlsxConversionInput) => Promise<unknown>;
  readonly xlsxCliBin?: string;
  readonly xlsxCliTimeoutMs?: number;
  readonly xlsxAssetRoot?: string;
}

export interface PreviewWorkbookResult {
  readonly assetId: string;
  readonly assetDirectory: string;
  readonly workbook: unknown;
}

export const createWorkbookPreview = async (
  sourcePath: string,
  options: PreviewXlsxOptions,
): Promise<PreviewWorkbookResult> => {
  const assetId = randomUUID();
  const assetDirectory = join(getXlsxAssetRoot(options), assetId);

  await rm(assetDirectory, { recursive: true, force: true });
  await mkdir(assetDirectory, { recursive: true });

  try {
    const workbook = await convertXlsxToWorkbook({ sourcePath, outputDirectory: assetDirectory }, options);
    stripWorkbookChartAssets(workbook);

    return { assetId, assetDirectory, workbook };
  } catch (error) {
    await rm(assetDirectory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
};

export const readWorkbookJson = async (outputDirectory: string): Promise<unknown> =>
  JSON.parse(await readFile(join(outputDirectory, "workbook.json"), "utf8")) as unknown;

const convertXlsxToWorkbook = async (
  input: XlsxConversionInput,
  options: PreviewXlsxOptions,
): Promise<unknown> => {
  if (options.convertXlsxToWorkbook !== undefined) {
    return options.convertXlsxToWorkbook(input);
  }

  await runXlsxCli(input.sourcePath, input.outputDirectory, options);
  return readWorkbookJson(input.outputDirectory);
};

const runXlsxCli = (
  sourcePath: string,
  outputDirectory: string,
  options: PreviewXlsxOptions,
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
    const timeoutMs = options.xlsxCliTimeoutMs ?? DEFAULT_XLSX_TIMEOUT_MS;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill("SIGKILL");
      rejectRun(new Error(`${options.xlsxCliBin?.trim() || DEFAULT_XLSX_CLI} timed out after ${String(timeoutMs)}ms`));
    }, timeoutMs);

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
      rejectRun(error);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      if (code !== 0) {
        rejectRun(new Error(renderXlsxCliError(code ?? -1, stdout, stderr)));
        return;
      }

      resolveRun();
    });
  });

export const attachWorkbookAssetUrls = (
  workbook: unknown,
  assetUrlForPath: (assetPath: string) => string,
): void => {
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
      const images = Array.isArray(drawing?.["images"]) ? drawing["images"] : [];
      images.forEach((image) => attachWorkbookAssetUrl(image, assetUrlForPath));
    }

    const images = Array.isArray(sheet["images"]) ? sheet["images"] : [];
    images.forEach((image) => attachWorkbookAssetUrl(image, assetUrlForPath));
  }
};

const attachWorkbookAssetUrl = (
  imageValue: unknown,
  assetUrlForPath: (assetPath: string) => string,
): void => {
  const image = asRecord(imageValue);
  const assetPath = image?.["assetPath"];

  if (image === null || typeof assetPath !== "string" || assetPath.length === 0) {
    return;
  }

  image["assetUrl"] = assetUrlForPath(assetPath);
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

const getXlsxAssetRoot = (options: PreviewXlsxOptions): string =>
  options.xlsxAssetRoot ?? join(tmpdir(), "heysnap-previewer-xlsx");

const renderXlsxCliError = (code: number, stdout: string, stderr: string): string => {
  const detail = [stderr.trim(), stdout.trim()].filter((value) => value.length > 0).join("\n");

  return detail.length > 0
    ? `${DEFAULT_XLSX_CLI} failed (${String(code)}): ${detail}`
    : `${DEFAULT_XLSX_CLI} failed (${String(code)})`;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
