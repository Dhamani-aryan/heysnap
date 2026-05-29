import type {
  PreviewWorkbookChange,
  PreviewWorkbookChangedCells,
  PreviewWorkbookChangedSheet,
  PreviewWorkbookPatch,
  PreviewWorkbookPatchOperation,
} from "./protocol.js";

const PATCH_FULL_RATIO = 0.7;

type RecordValue = Record<string, unknown>;

export const getWorkbookSheetKey = (sheet: unknown, index: number): string => {
  const record = asRecord(sheet);
  const id = record?.["id"];
  const name = record?.["name"];

  if (id !== undefined && id !== null && String(id).length > 0) {
    return `id:${String(id)}`;
  }

  if (name !== undefined && name !== null && String(name).length > 0) {
    return `name:${String(name)}`;
  }

  return `index:${String(index)}`;
};

export const createWorkbookPatch = (
  previousWorkbook: unknown,
  nextWorkbook: unknown,
): PreviewWorkbookPatch | null => {
  const previousRoot = asRecord(previousWorkbook);
  const nextRoot = asRecord(nextWorkbook);
  const previousWorkbookRecord = asRecord(previousRoot?.["workbook"]);
  const nextWorkbookRecord = asRecord(nextRoot?.["workbook"]);

  if (previousRoot === null || nextRoot === null || previousWorkbookRecord === null || nextWorkbookRecord === null) {
    return null;
  }

  if (
    stableStringify(withoutKey(previousRoot, "workbook")) !== stableStringify(withoutKey(nextRoot, "workbook")) ||
    stableStringify(withoutKeys(previousWorkbookRecord, ["sheets", "styles"])) !==
      stableStringify(withoutKeys(nextWorkbookRecord, ["sheets", "styles"]))
  ) {
    return null;
  }

  const previousSheets = getWorkbookSheets(previousWorkbook);
  const nextSheets = getWorkbookSheets(nextWorkbook);
  const operations: PreviewWorkbookPatchOperation[] = [];

  if (stableStringify(previousWorkbookRecord["styles"]) !== stableStringify(nextWorkbookRecord["styles"])) {
    operations.push({
      kind: "replaceStyles",
      styles: nextWorkbookRecord["styles"] ?? null,
    });
  }

  if (!sameSheetKeys(previousSheets, nextSheets)) {
    operations.push({ kind: "replaceSheets", sheets: deepClone(nextSheets) as readonly unknown[] });
    return operations;
  }

  nextSheets.forEach((nextSheet, sheetIndex) => {
    const previousSheet = previousSheets[sheetIndex];
    const sheetKey = getWorkbookSheetKey(nextSheet, sheetIndex);

    if (stableStringify(withoutKey(asRecord(previousSheet), "cells")) !== stableStringify(withoutKey(asRecord(nextSheet), "cells"))) {
      operations.push({
        kind: "replaceSheet",
        sheet: deepClone(nextSheet),
        sheetIndex,
        sheetKey,
      });
      return;
    }

    const changedCells = diffCells(
      asRecord(asRecord(previousSheet)?.["cells"]) ?? {},
      asRecord(asRecord(nextSheet)?.["cells"]) ?? {},
    );

    if (Object.keys(changedCells).length > 0) {
      operations.push({
        cells: changedCells,
        kind: "cells",
        sheetIndex,
        sheetKey,
      });
    }
  });

  return operations;
};

export const shouldUseFullWorkbookSnapshot = (
  nextWorkbook: unknown,
  patch: PreviewWorkbookPatch,
  ratio = PATCH_FULL_RATIO,
): boolean => {
  if (patch.length === 0) {
    return false;
  }

  return stableStringify(patch).length > stableStringify(nextWorkbook).length * ratio;
};

export const applyWorkbookPatch = (
  workbook: unknown,
  patch: PreviewWorkbookPatch,
): unknown => {
  const nextWorkbook = deepClone(workbook);
  const root = asRecord(nextWorkbook);
  const workbookRecord = asRecord(root?.["workbook"]);

  if (root === null || workbookRecord === null) {
    return nextWorkbook;
  }

  for (const operation of patch) {
    switch (operation.kind) {
      case "replaceStyles":
        if (operation.styles === null) {
          delete workbookRecord["styles"];
        } else {
          workbookRecord["styles"] = deepClone(operation.styles);
        }
        break;
      case "replaceSheets":
        workbookRecord["sheets"] = deepClone(operation.sheets);
        break;
      case "replaceSheet": {
        const sheets = getWorkbookSheets(nextWorkbook);
        const sheetIndex = findSheetIndex(sheets, operation.sheetKey, operation.sheetIndex);
        if (sheetIndex === -1) {
          sheets[operation.sheetIndex] = deepClone(operation.sheet);
        } else {
          sheets[sheetIndex] = deepClone(operation.sheet);
        }
        workbookRecord["sheets"] = sheets;
        break;
      }
      case "cells": {
        const sheets = getWorkbookSheets(nextWorkbook);
        const sheetIndex = findSheetIndex(sheets, operation.sheetKey, operation.sheetIndex);
        const sheet = asRecord(sheets[sheetIndex]);

        if (sheet === null) {
          break;
        }

        const cells = {
          ...(asRecord(sheet["cells"]) ?? {}),
        };

        for (const [address, value] of Object.entries(operation.cells)) {
          if (value === null) {
            delete cells[address];
          } else {
            cells[address] = deepClone(value);
          }
        }

        sheet["cells"] = cells;
        break;
      }
    }
  }

  return nextWorkbook;
};

export const summarizeWorkbookPatch = (
  patch: PreviewWorkbookPatch,
  version: number,
): PreviewWorkbookChange => {
  const changedCells: PreviewWorkbookChangedCells[] = [];
  const replacedSheets: PreviewWorkbookChangedSheet[] = [];
  let stylesChanged = false;

  for (const operation of patch) {
    if (operation.kind === "cells") {
      changedCells.push({
        addresses: Object.keys(operation.cells),
        sheetIndex: operation.sheetIndex,
        sheetKey: operation.sheetKey,
      });
    } else if (operation.kind === "replaceSheet") {
      replacedSheets.push({
        sheetIndex: operation.sheetIndex,
        sheetKey: operation.sheetKey,
      });
    } else if (operation.kind === "replaceSheets") {
      replacedSheets.push({ sheetIndex: -1, sheetKey: "*" });
    } else if (operation.kind === "replaceStyles") {
      stylesChanged = true;
    }
  }

  return {
    type: "patch",
    version,
    ...(changedCells.length === 0 ? {} : { changedCells }),
    ...(replacedSheets.length === 0 ? {} : { replacedSheets }),
    ...(stylesChanged ? { stylesChanged } : {}),
  };
};

export const createFullWorkbookChange = (
  type: "initial" | "full",
  version: number,
): PreviewWorkbookChange => ({ type, version });

const getWorkbookSheets = (workbook: unknown): unknown[] => {
  const workbookRecord = asRecord(asRecord(workbook)?.["workbook"]);
  const sheets = workbookRecord?.["sheets"];
  return Array.isArray(sheets) ? [...sheets] : [];
};

const sameSheetKeys = (previousSheets: readonly unknown[], nextSheets: readonly unknown[]): boolean => {
  if (previousSheets.length !== nextSheets.length) {
    return false;
  }

  return previousSheets.every(
    (sheet, index) => getWorkbookSheetKey(sheet, index) === getWorkbookSheetKey(nextSheets[index], index),
  );
};

const diffCells = (
  previousCells: RecordValue,
  nextCells: RecordValue,
): Record<string, unknown | null> => {
  const changedCells: Record<string, unknown | null> = {};
  const addresses = new Set([...Object.keys(previousCells), ...Object.keys(nextCells)]);

  for (const address of addresses) {
    if (!(address in nextCells)) {
      changedCells[address] = null;
      continue;
    }

    if (!(address in previousCells) || stableStringify(previousCells[address]) !== stableStringify(nextCells[address])) {
      changedCells[address] = deepClone(nextCells[address]);
    }
  }

  return changedCells;
};

const findSheetIndex = (
  sheets: readonly unknown[],
  sheetKey: string,
  fallbackIndex: number,
): number => {
  if (fallbackIndex >= 0 && getWorkbookSheetKey(sheets[fallbackIndex], fallbackIndex) === sheetKey) {
    return fallbackIndex;
  }

  return sheets.findIndex((sheet, index) => getWorkbookSheetKey(sheet, index) === sheetKey);
};

const withoutKey = (record: RecordValue | null | undefined, key: string): RecordValue | null => {
  if (record === null || record === undefined) {
    return null;
  }

  const clone: RecordValue = {};

  for (const [entryKey, value] of Object.entries(record)) {
    if (entryKey !== key) {
      clone[entryKey] = value;
    }
  }

  return clone;
};

const withoutKeys = (record: RecordValue | null | undefined, keys: readonly string[]): RecordValue | null => {
  if (record === null || record === undefined) {
    return null;
  }

  const ignoredKeys = new Set(keys);
  const clone: RecordValue = {};

  for (const [entryKey, value] of Object.entries(record)) {
    if (!ignoredKeys.has(entryKey)) {
      clone[entryKey] = value;
    }
  }

  return clone;
};

const stableStringify = (value: unknown): string =>
  JSON.stringify(sortForStableStringify(value));

const sortForStableStringify = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sortForStableStringify);
  }

  const record = asRecord(value);
  if (record === null) {
    return value;
  }

  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, sortForStableStringify(record[key])]),
  );
};

const deepClone = <T>(value: T): T =>
  value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;

const asRecord = (value: unknown): RecordValue | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as RecordValue : null;
