import assert from "node:assert/strict";
import test from "node:test";

import {
  applyWorkbookPatch,
  createWorkbookPatch,
  shouldUseFullWorkbookSnapshot,
  summarizeWorkbookPatch,
} from "./workbookPatch";

const workbook = (sheets: unknown[], styles: unknown = { cellFormats: [] }, extra: Record<string, unknown> = {}) => ({
  source: { fileName: "Book.xlsx" },
  workbook: {
    name: "Book.xlsx",
    sheets,
    styles,
    ...extra,
  },
});

const sheet = (name: string, cells: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  cells,
  columns: [],
  dimension: "A1:C3",
  id: name.toLowerCase(),
  mergedCells: [],
  name,
  rows: [],
  ...extra,
});

test("creates and applies cell add/change/delete patches", () => {
  const previous = workbook([
    sheet("Sheet1", {
      A1: { address: "A1", value: "old" },
      B1: { address: "B1", value: "remove me" },
    }),
  ]);
  const next = workbook([
    sheet("Sheet1", {
      A1: { address: "A1", value: "new" },
      C1: { address: "C1", value: "added" },
    }),
  ]);

  const patch = createWorkbookPatch(previous, next);

  assert.deepEqual(patch, [
    {
      cells: {
        A1: { address: "A1", value: "new" },
        B1: null,
        C1: { address: "C1", value: "added" },
      },
      kind: "cells",
      sheetIndex: 0,
      sheetKey: "id:sheet1",
    },
  ]);
  assert.deepEqual(applyWorkbookPatch(previous, patch ?? []), next);
});

test("creates replaceSheet when sheet structure changes", () => {
  const previous = workbook([sheet("Sheet1", { A1: { value: "same" } })]);
  const next = workbook([
    sheet("Sheet1", { A1: { value: "same" } }, { columns: [{ min: 1, max: 1, width: 24 }] }),
  ]);

  const patch = createWorkbookPatch(previous, next);

  assert.equal(patch?.[0]?.kind, "replaceSheet");
  assert.deepEqual(applyWorkbookPatch(previous, patch ?? []), next);
});

test("creates replaceSheets when sheet order changes", () => {
  const previous = workbook([
    sheet("Sheet1", { A1: { value: "one" } }),
    sheet("Sheet2", { A1: { value: "two" } }),
  ]);
  const next = workbook([
    sheet("Sheet2", { A1: { value: "two" } }),
    sheet("Sheet1", { A1: { value: "one" } }),
  ]);

  const patch = createWorkbookPatch(previous, next);

  assert.equal(patch?.[0]?.kind, "replaceSheets");
  assert.deepEqual(applyWorkbookPatch(previous, patch ?? []), next);
});

test("creates replaceStyles when workbook styles change", () => {
  const previous = workbook([sheet("Sheet1", { A1: { styleIndex: 0, value: "same" } })], {
    cellFormats: [{ index: 0, fontId: 0 }],
  });
  const next = workbook([sheet("Sheet1", { A1: { styleIndex: 0, value: "same" } })], {
    cellFormats: [{ index: 0, fontId: 1 }],
  });

  const patch = createWorkbookPatch(previous, next);
  const change = summarizeWorkbookPatch(patch ?? [], 2);

  assert.equal(patch?.[0]?.kind, "replaceStyles");
  assert.equal(change.stylesChanged, true);
  assert.deepEqual(applyWorkbookPatch(previous, patch ?? []), next);
});

test("falls back to full snapshots when patch is too large", () => {
  const previous = workbook([sheet("Sheet1", { A1: { value: "old" } })]);
  const next = workbook([sheet("Sheet1", { A1: { value: "x".repeat(1000) } })]);
  const patch = createWorkbookPatch(previous, next);

  assert.equal(shouldUseFullWorkbookSnapshot(next, patch ?? [], 0.01), true);
});
