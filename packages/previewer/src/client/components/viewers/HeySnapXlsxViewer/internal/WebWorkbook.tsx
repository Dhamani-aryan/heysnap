/*
 * WebWorkbook engine.
 *
 * Ported from the reference openxml-demo-client `WebWorkbook` so the rendered
 * output is pixel-identical: same Geist Sans font stack, same grid theme,
 * same chart palette, same border-width table, same cell-content contract
 * the upstream component shipped. The entire engine — constants, helpers,
 * chart routines, drawing overlay, and the React component itself — lives in
 * this one file so the port reads top-to-bottom the same way the source did.
 *
 * Types are deliberately loose (`any`) on the workbook/sheet/cell side: the
 * source operates on a server-emitted JSON whose shape is wide and dynamic,
 * and pretending otherwise would require ~300 lines of shape types that
 * would immediately drift from whatever the parser hands us. Public props
 * stay strongly typed.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";

import {
  CompactSelection,
  DataEditor,
  GridCellKind,
  type DataEditorRef,
} from "@glideapps/glide-data-grid";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  Download01Icon,
  FunctionOfXIcon,
  Refresh01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";

import "@glideapps/glide-data-grid/dist/index.css";
import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/geist-sans/700.css";

import type { PreviewWorkbookChange } from "../../../../../protocol";
import { getWorkbookSheetKey } from "../../../../../workbookPatch";
import { readHashParam, writeHashParam } from "../../../_internal/urlHashState";
import "./webWorkbook.css";

// ── Constants ────────────────────────────────────────────────────────────

const workbookZoomStorageKey = "openxml-web-workbook-zoom";
const sheetHashParam = "sheet";
const workbookZoomLevels = [50, 75, 90, 100, 110, 125, 150, 200] as const;

const defaultGridTheme = {
  accentColor: "#19736a",
  accentFg: "#ffffff",
  accentLight: "#d9f0ed",
  bgCell: "#ffffff",
  bgHeader: "#f5f7fa",
  borderColor: "#d2d8e2",
  cellHorizontalPadding: 10,
  cellVerticalPadding: 4,
  fontFamily:
    "Geist Sans, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
  headerFontStyle: "600 13px",
  textDark: "#172033",
  textHeader: "#536174",
  textMedium: "#536174",
};

const borderWidthByStyle: Record<string, number> = {
  dashDot: 1,
  dashDotDot: 1,
  dashed: 1,
  dotted: 1,
  double: 3,
  hair: 1,
  medium: 2,
  mediumDashDot: 2,
  mediumDashDotDot: 2,
  mediumDashed: 2,
  slantDashDot: 2,
  thick: 3,
  thin: 1,
};

const drawingColors: Record<
  string,
  { bg: string; border: string; labelBg: string; labelText: string }
> = {
  chart: {
    bg: "rgba(92, 95, 190, 0.08)",
    border: "#5c5fbe",
    labelBg: "#eef0ff",
    labelText: "#31346f",
  },
  image: {
    bg: "rgba(188, 109, 36, 0.08)",
    border: "#bc6d24",
    labelBg: "#fff3e7",
    labelText: "#7a3e0e",
  },
};

const chartPalette = [
  "#2f6f73",
  "#d88c40",
  "#5c5fbe",
  "#87a83b",
  "#bd5d76",
  "#4590b8",
  "#9f6ab7",
  "#c3a33a",
];

const defaultExcelThemeColors: Record<number, string> = {
  0: "#ffffff",
  1: "#000000",
  2: "#e7e6e6",
  3: "#44546a",
  4: "#4472c4",
  5: "#ed7d31",
  6: "#a5a5a5",
  7: "#ffc000",
  8: "#5b9bd5",
  9: "#70ad47",
  10: "#0563c1",
  11: "#954f72",
};

const indexedExcelColors: Record<number, string> = {
  0: "#000000",
  1: "#ffffff",
  2: "#ff0000",
  3: "#00ff00",
  4: "#0000ff",
  5: "#ffff00",
  6: "#ff00ff",
  7: "#00ffff",
  8: "#000000",
  9: "#ffffff",
  10: "#ff0000",
  11: "#00ff00",
  12: "#0000ff",
  13: "#ffff00",
  14: "#ff00ff",
  15: "#00ffff",
  16: "#800000",
  17: "#008000",
  18: "#000080",
  19: "#808000",
  20: "#800080",
  21: "#008080",
  22: "#c0c0c0",
  23: "#808080",
  24: "#9999ff",
  25: "#993366",
  26: "#ffffcc",
  27: "#ccffff",
  28: "#660066",
  29: "#ff8080",
  30: "#0066cc",
  31: "#ccccff",
  32: "#000080",
  33: "#ff00ff",
  34: "#ffff00",
  35: "#00ffff",
  36: "#800080",
  37: "#800000",
  38: "#008080",
  39: "#0000ff",
  40: "#00ccff",
  41: "#ccffff",
  42: "#ccffcc",
  43: "#ffff99",
  44: "#99ccff",
  45: "#ff99cc",
  46: "#cc99ff",
  47: "#ffcc99",
  48: "#3366ff",
  49: "#33cccc",
  50: "#99cc00",
  51: "#ffcc00",
  52: "#ff9900",
  53: "#ff6600",
  54: "#666699",
  55: "#969696",
  56: "#003366",
  57: "#339966",
  58: "#003300",
  59: "#333300",
  60: "#993300",
  61: "#993366",
  62: "#333399",
  63: "#333333",
};

const minDrawingSpanRowHeight = 8;
const emptyWorkbookSheets: any[] = [];

// ── Small helpers ────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lastOf<T>(items: T[]): T | undefined {
  return items.length > 0 ? items[items.length - 1] : undefined;
}

function getStoredWorkbookZoom(): number {
  try {
    const value = Number(window.localStorage.getItem(workbookZoomStorageKey));
    return Number.isFinite(value) ? clamp(value, 50, 200) : 75;
  } catch {
    return 75;
  }
}

function getWorkbookSheets(workbook: any): any[] {
  return workbook?.workbook?.sheets || emptyWorkbookSheets;
}

function getWorkbookTitle(workbook: any, fallbackTitle = "Workbook.xlsx"): string {
  return (
    workbook?.source?.fileName ||
    workbook?.source?.filename ||
    workbook?.source?.name ||
    workbook?.workbook?.source?.fileName ||
    workbook?.workbook?.name ||
    workbook?.name ||
    getWorkbookSheets(workbook)[0]?.name ||
    fallbackTitle
  );
}

const resolveSheetIndexFromHash = (sheets: readonly any[]): number => {
  const hashSheet = readHashParam(sheetHashParam);

  if (hashSheet === null) {
    return 0;
  }

  const index = sheets.findIndex(
    (sheet, sheetIndex) => sheetHashName(sheet, sheetIndex) === hashSheet,
  );

  return index === -1 ? 0 : index;
};

const sheetHashName = (sheet: any, index: number): string =>
  String(sheet?.name || `Sheet ${index + 1}`);

const sheetStateKey = (sheet: any, index: number): string =>
  getWorkbookSheetKey(sheet, index);

function createEmptyGridSelection(): any {
  return {
    columns: CompactSelection.empty(),
    rows: CompactSelection.empty(),
  };
}

function selectedCellFromDetails(details: any): any {
  return details
    ? {
        address: details.address,
        drawings: details.drawings,
        formula: details.formula,
        merge: details.merge,
        sourceAddress: details.sourceAddress,
        style: details.style,
        styleIndex: details.styleIndex,
        table: details.table,
        type: details.type,
        value: details.value,
      }
    : null;
}

function getFormulaBarText(selectedCell: any): string {
  if (!selectedCell) return "";
  return getFormulaText(selectedCell.formula) || selectedCell.value || "";
}

function getSelectionLabel(selection: any, gridData: any, fallback = "A1"): string {
  const range = selection?.current?.range;
  if (!range) return fallback;

  const startCol = Math.max(1, range.x);
  const endCol = Math.max(1, range.x + range.width - 1);
  const start = gridData.getCellMeta(startCol, range.y);
  const end = gridData.getCellMeta(endCol, range.y + range.height - 1);

  if (!start?.address) return fallback;
  if (!end?.address || end.address === start.address) return start.address;
  return `${start.address}:${end.address}`;
}

type SelectionSnapshot = {
  readonly cellAddress: string | null;
  readonly rangeEndAddress: string | null;
  readonly rangeStartAddress: string | null;
};

const captureSelectionSnapshot = (selection: any, gridData: any): SelectionSnapshot | null => {
  const current = selection?.current;
  const range = current?.range;

  if (!range) {
    return null;
  }

  const startCol = Math.max(1, range.x);
  const endCol = Math.max(1, range.x + range.width - 1);
  const startRow = range.y;
  const endRow = range.y + range.height - 1;
  const activeCell = current.cell;

  return {
    cellAddress: activeCell ? gridData.getCellMeta(Math.max(1, activeCell[0]), activeCell[1])?.address ?? null : null,
    rangeEndAddress: gridData.getCellMeta(endCol, endRow)?.address ?? null,
    rangeStartAddress: gridData.getCellMeta(startCol, startRow)?.address ?? null,
  };
};

const restoreSelectionSnapshot = (snapshot: SelectionSnapshot | null, gridData: any): any | null => {
  if (snapshot === null || snapshot.rangeStartAddress === null) {
    return null;
  }

  const start = gridData.getCellPosition(snapshot.rangeStartAddress);
  const end = gridData.getCellPosition(snapshot.rangeEndAddress ?? snapshot.rangeStartAddress) ?? start;
  const active = snapshot.cellAddress === null ? start : gridData.getCellPosition(snapshot.cellAddress) ?? start;

  if (start === null || end === null || active === null) {
    return null;
  }

  const left = Math.min(start[0], end[0]);
  const right = Math.max(start[0], end[0]);
  const top = Math.min(start[1], end[1]);
  const bottom = Math.max(start[1], end[1]);

  return {
    columns: CompactSelection.empty(),
    current: {
      cell: active,
      range: {
        height: bottom - top + 1,
        width: right - left + 1,
        x: left,
        y: top,
      },
      rangeStack: [],
    },
    rows: CompactSelection.empty(),
  };
};

function safeDownloadName(name: string | null | undefined): string {
  return (
    (name || "workbook")
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "workbook"
  );
}

function downloadWorkbookJson(workbook: any, title: string): void {
  if (!workbook) return;

  const blob = new Blob([JSON.stringify(workbook, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = `${safeDownloadName(title)}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function downloadWorkbookFile(
  source: Blob | ArrayBuffer | Uint8Array,
  name: string,
  mime: string,
): void {
  const blob = source instanceof Blob ? source : new Blob([toBlobPart(source)], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = name || "workbook.xlsx";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadWorkbookUrl(url: string, name: string): void {
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = name || "workbook.xlsx";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function reloadWorkbookPreview(): void {
  window.location.reload();
}

function nearestWorkbookZoomIndex(zoom: number): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  workbookZoomLevels.forEach((level, index) => {
    const distance = Math.abs(level - zoom);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function toBlobPart(source: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (source instanceof ArrayBuffer) {
    return source;
  }

  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy.buffer;
}

function selectionFillRegions(selection: any): any[] {
  const range = selection?.current?.range;
  const activeCell = selection?.current?.cell;
  if (!range || !activeCell) return [];

  const x = Math.max(1, range.x);
  const y = range.y;
  const width = Math.max(0, range.x + range.width - x);
  const height = Math.max(0, range.height);
  if (width === 0 || height === 0) return [];

  const activeX = activeCell[0];
  const activeY = activeCell[1];
  const activeInside =
    activeX >= x && activeX < x + width && activeY >= y && activeY < y + height;

  if (!activeInside) {
    return [
      { color: "#DFEDFF", range: { height, width, x, y }, style: "no-outline" },
    ];
  }

  return [
    activeY > y
      ? { color: "#DFEDFF", range: { height: activeY - y, width, x, y }, style: "no-outline" }
      : null,
    activeY + 1 < y + height
      ? {
          color: "#DFEDFF",
          range: { height: y + height - activeY - 1, width, x, y: activeY + 1 },
          style: "no-outline",
        }
      : null,
    activeX > x
      ? {
          color: "#DFEDFF",
          range: { height: 1, width: activeX - x, x, y: activeY },
          style: "no-outline",
        }
      : null,
    activeX + 1 < x + width
      ? {
          color: "#DFEDFF",
          range: { height: 1, width: x + width - activeX - 1, x: activeX + 1, y: activeY },
          style: "no-outline",
        }
      : null,
  ].filter(Boolean);
}

type Rect = { x: number; y: number; width: number; height: number };

function drawSelectionOutline(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  col: number,
  row: number,
  selection: any,
): void {
  const range = selection?.current?.range;
  if (!range || col === 0) return;

  const x = Math.max(1, range.x);
  const y = range.y;
  const width = Math.max(0, range.x + range.width - x);
  const height = Math.max(0, range.height);

  if (
    width === 0 ||
    height === 0 ||
    col < x ||
    col >= x + width ||
    row < y ||
    row >= y + height
  ) {
    return;
  }

  const left = col === x;
  const right = col === x + width - 1;
  const top = row === y;
  const bottom = row === y + height - 1;

  if (!left && !right && !top && !bottom) return;

  ctx.save();
  ctx.strokeStyle = "#0285FF";
  ctx.lineWidth = 2.5;
  ctx.setLineDash([]);

  if (top) drawStraightLine(ctx, rect.x, rect.y + 1.25, rect.x + rect.width, rect.y + 1.25);
  if (right)
    drawStraightLine(
      ctx,
      rect.x + rect.width - 1.25,
      rect.y,
      rect.x + rect.width - 1.25,
      rect.y + rect.height,
    );
  if (bottom)
    drawStraightLine(
      ctx,
      rect.x,
      rect.y + rect.height - 1.25,
      rect.x + rect.width,
      rect.y + rect.height - 1.25,
    );
  if (left) drawStraightLine(ctx, rect.x + 1.25, rect.y, rect.x + 1.25, rect.y + rect.height);

  ctx.restore();
}

// ── Address / dimension / sheet bounds ──────────────────────────────────

function columnNameToNumber(columnName: string): number {
  return [...columnName].reduce(
    (total, letter) => total * 26 + letter.charCodeAt(0) - 64,
    0,
  );
}

function numberToColumnName(columnNumber: number): string {
  let name = "";
  let current = columnNumber;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
}

function parseCellAddress(address: string): { column: number; row: number } | null {
  const match = /^([A-Z]+)(\d+)$/i.exec(address);
  if (!match) return null;
  return { column: columnNameToNumber(match[1].toUpperCase()), row: Number(match[2]) };
}

function parseDimension(dimension: string | null | undefined) {
  const [start, end = start] = String(dimension || "").split(":");
  const startAddress = parseCellAddress(start);
  const endAddress = parseCellAddress(end);
  if (!startAddress || !endAddress) return null;
  return {
    minColumn: Math.min(startAddress.column, endAddress.column),
    maxColumn: Math.max(startAddress.column, endAddress.column),
    minRow: Math.min(startAddress.row, endAddress.row),
    maxRow: Math.max(startAddress.row, endAddress.row),
  };
}

function getSheetBounds(sheet: any) {
  const cells = Object.values(sheet?.cells || {}) as any[];
  const dimensionBounds = parseDimension(sheet?.dimension);
  if (dimensionBounds) return dimensionBounds;

  if (cells.length === 0) {
    return { minColumn: 1, maxColumn: 1, minRow: 1, maxRow: 1 };
  }

  return cells.reduce(
    (bounds, cell) => ({
      minColumn: Math.min(bounds.minColumn, cell.column),
      maxColumn: Math.max(bounds.maxColumn, cell.column),
      minRow: Math.min(bounds.minRow, cell.row),
      maxRow: Math.max(bounds.maxRow, cell.row),
    }),
    {
      minColumn: Number.POSITIVE_INFINITY,
      maxColumn: 1,
      minRow: Number.POSITIVE_INFINITY,
      maxRow: 1,
    },
  );
}

// ── Cell value / formula extraction ─────────────────────────────────────

function getCellDisplayValue(cell: any): string {
  if (!cell) return "";
  if (cell.displayValue !== undefined && cell.displayValue !== null)
    return String(cell.displayValue);
  if (cell.value !== undefined && cell.value !== null) return String(cell.value);
  if (cell.rawValue !== undefined && cell.rawValue !== null) return String(cell.rawValue);
  if (cell.formula?.cachedDisplayValue !== undefined && cell.formula.cachedDisplayValue !== null)
    return String(cell.formula.cachedDisplayValue);
  if (cell.formula?.cachedValue !== undefined && cell.formula.cachedValue !== null)
    return String(cell.formula.cachedValue);
  if (cell.formula?.cachedRawValue !== undefined && cell.formula.cachedRawValue !== null)
    return String(cell.formula.cachedRawValue);
  return "";
}

function getFormulaSummary(cell: any): any {
  if (!cell?.formula) return null;
  return {
    address: cell.address,
    baseAddress: cell.formula.baseAddress,
    baseText: cell.formula.baseText,
    cachedValue: getCellDisplayValue(cell),
    kind: cell.formula.kind,
    reference: cell.formula.reference,
    resolvedText: cell.formula.resolvedText,
    sharedIndex: cell.formula.sharedIndex,
    text: cell.formula.text,
  };
}

function getFormulaText(formula: any): string {
  return formula?.resolvedText || formula?.text || "";
}

// ── Color resolution (hex, tint, theme, indexed) ────────────────────────

function normalizeHexColor(hex: string | null | undefined): string | null {
  if (!hex) return null;
  const value = String(hex).replace("#", "");
  const normalized = value.length === 8 ? value.slice(2) : value;
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;
  return `#${normalized.toLowerCase()}`;
}

function applyTint(hex: string | null | undefined, tint: number | null | undefined): string | null {
  const normalized = normalizeHexColor(hex);
  if (!normalized || tint === undefined || tint === null || tint === 0) return normalized;

  const amount = Number(tint);
  if (!Number.isFinite(amount)) return normalized;

  const channels = [1, 3, 5].map((start) => parseInt(normalized.slice(start, start + 2), 16));
  const tintedChannels = channels.map((channel) => {
    const adjusted =
      amount < 0 ? channel * (1 + amount) : channel * (1 - amount) + 255 * amount;
    return clamp(Math.round(adjusted), 0, 255).toString(16).padStart(2, "0");
  });

  return `#${tintedChannels.join("")}`;
}

function colorToCss(color: any): string | null {
  if (!color || color.auto) return null;

  const resolvedRgb = normalizeHexColor(color.resolvedRgb);
  if (resolvedRgb) return resolvedRgb;

  const rgb = normalizeHexColor(color.rgb);
  if (rgb) return applyTint(rgb, color.tint);

  if (color.theme !== undefined && color.theme !== null) {
    return applyTint(defaultExcelThemeColors[color.theme], color.tint);
  }

  return applyTint(indexedExcelColors[color.indexed], color.tint);
}

// ── Style resolution ────────────────────────────────────────────────────

function itemByIndex(items: any, index: any): any {
  if (!Array.isArray(items) || index === undefined || index === null) return null;
  return items.find((item: any) => item.index === index) || items[index] || null;
}

function resolveStyle(workbookStyles: any, styleIndex: any): any {
  if (styleIndex === undefined || styleIndex === null) return null;
  return itemByIndex(workbookStyles?.cellFormats, styleIndex);
}

function resolveEffectiveStyle(
  cell: any,
  rowMeta: any,
  columnMeta: any,
  workbookStyles: any,
): any {
  return (
    cell?.style ||
    resolveStyle(workbookStyles, cell?.styleIndex) ||
    resolveStyle(workbookStyles, rowMeta?.styleIndex) ||
    resolveStyle(workbookStyles, columnMeta?.styleIndex) ||
    null
  );
}

function resolveStyleParts(style: any, workbookStyles: any) {
  return {
    border: itemByIndex(workbookStyles?.borders, style?.borderId),
    fill: itemByIndex(workbookStyles?.fills, style?.fillId),
    font: itemByIndex(workbookStyles?.fonts, style?.fontId),
  };
}

function borderLine(side: any): { color: string; style: string; width: number } | null {
  if (!side?.style) return null;
  return {
    color: colorToCss(side.color) || "#cfd6e2",
    style: side.style,
    width: borderWidthByStyle[side.style] || 1,
  };
}

function hasWrapText(style: any): boolean {
  const wrapText = style?.wrapText ?? style?.alignment?.wrapText;
  return wrapText === true || wrapText === "1";
}

function buildCellPresentation(cell: any, style: any, workbookStyles: any, merge: any, table: any) {
  const { border, fill, font } = resolveStyleParts(style, workbookStyles);
  const fontColor = colorToCss(font?.color);
  const fillColor = fill?.patternType === "solid" ? colorToCss(fill.foregroundColor) : null;
  const themeOverride: Record<string, any> = {};
  const fontSize = font?.size || 13;

  if (font?.name) {
    themeOverride.fontFamily = defaultGridTheme.fontFamily;
  }

  if (font || style?.applyFont) {
    themeOverride.baseFontStyle = `${font?.italic ? "italic " : ""}${font?.bold ? "700" : "400"} ${fontSize}px`;
  }

  if (fontColor) {
    themeOverride.textDark = fontColor;
    themeOverride.textMedium = fontColor;
  }

  if ((style?.applyFill || fill?.patternType === "solid") && fillColor) {
    themeOverride.bgCell = fillColor;
  }

  if (table && !themeOverride.bgCell) {
    if (table.role === "header") {
      themeOverride.bgCell = "#e5f1f9";
    } else if (table.role === "totals") {
      themeOverride.bgCell = "#edf4ea";
    } else if (table.isStriped) {
      themeOverride.bgCell = "#f8fbfd";
    }
  }

  if ((table?.role === "header" || table?.role === "totals") && !themeOverride.baseFontStyle) {
    themeOverride.baseFontStyle = `700 ${fontSize}px`;
  }

  return {
    border: {
      bottom: borderLine(border?.bottom),
      left: borderLine(border?.left),
      right: borderLine(border?.right),
      top: borderLine(border?.top),
    },
    font: {
      size: fontSize,
      strike: Boolean(font?.strike),
      underline: Boolean(font?.underline),
    },
    themeOverride,
    textAlign: getContentAlign(cell, style, merge),
    wrapText: hasWrapText(style),
  };
}

function getContentAlign(cell: any, style: any, merge: any): "left" | "center" | "right" {
  const horizontal = style?.alignment?.horizontal || style?.horizontalAlignment;
  if (horizontal === "center" || merge) return "center";
  if (horizontal === "right" || cell?.type === "number" || cell?.type === "date") return "right";
  return "left";
}

// ── Excel column-width / row-height → pixels ────────────────────────────

function excelColumnWidthToPixels(width: any): number {
  if (!Number.isFinite(width)) return 132;
  return clamp(Math.round(width * 7 + 5), 36, 420);
}

function rowHeightToPixels(height: any): number {
  if (!Number.isFinite(height)) return 32;
  return clamp(Math.round(height * (4 / 3)), 22, 260);
}

function buildRowMetaByIndex(sheet: any): Map<number, any> {
  return new Map((sheet?.rows || []).map((row: any) => [row.index, row]));
}

function findColumnMeta(sheet: any, columnNumber: number): any {
  return (sheet?.columns || []).find(
    (column: any) => column.min <= columnNumber && column.max >= columnNumber,
  );
}

function buildMergeByAddress(sheet: any): Map<string, any> {
  const mergeByAddress = new Map<string, any>();
  for (const merge of sheet?.mergedCells || []) {
    for (let row = merge.startRow; row <= merge.endRow; row += 1) {
      for (let column = merge.startColumn; column <= merge.endColumn; column += 1) {
        mergeByAddress.set(`${numberToColumnName(column)}${row}`, merge);
      }
    }
  }
  return mergeByAddress;
}

function normalizeTables(sheet: any): any[] {
  return (sheet?.tables || [])
    .map((table: any) => {
      const bounds = parseDimension(table.reference);
      const referenceParts = table.reference?.split(":") || [];
      const startAddress = table.startAddress || (bounds ? referenceParts[0] : null);
      const endAddress =
        table.endAddress || (bounds ? referenceParts[referenceParts.length - 1] : null);

      return {
        ...table,
        displayName: table.displayName || table.name || `Table ${table.id || ""}`.trim(),
        endAddress,
        endColumn: table.endColumn ?? bounds?.maxColumn,
        endRow: table.endRow ?? bounds?.maxRow,
        startAddress,
        startColumn: table.startColumn ?? bounds?.minColumn,
        startRow: table.startRow ?? bounds?.minRow,
      };
    })
    .filter(
      (table: any) =>
        Number.isFinite(table.startColumn) &&
        Number.isFinite(table.endColumn) &&
        Number.isFinite(table.startRow) &&
        Number.isFinite(table.endRow),
    );
}

function findTableInfo(tables: any[], row: number, column: number): any {
  for (const table of tables) {
    if (
      row < table.startRow ||
      row > table.endRow ||
      column < table.startColumn ||
      column > table.endColumn
    ) {
      continue;
    }

    const headerEndRow = table.startRow + Math.max(0, table.headerRowCount || 0) - 1;
    const totalsStartRow = table.endRow - Math.max(0, table.totalsRowCount || 0) + 1;
    const role =
      table.headerRowCount > 0 && row <= headerEndRow
        ? "header"
        : table.totalsRowCount > 0 && row >= totalsStartRow
          ? "totals"
          : "body";
    const bodyRowOffset = row - headerEndRow - 1;

    return {
      bodyRowOffset,
      columnOffset: column - table.startColumn,
      isBottom: row === table.endRow,
      isHeaderBottom: role === "header" && row === headerEndRow,
      isLeft: column === table.startColumn,
      isRight: column === table.endColumn,
      isStriped:
        role === "body" &&
        table.style?.showRowStripes &&
        bodyRowOffset >= 0 &&
        bodyRowOffset % 2 === 1,
      isTop: row === table.startRow,
      isTotalsTop: role === "totals" && row === totalsStartRow,
      role,
      table,
    };
  }

  return null;
}

// ── Drawing geometry (anchors, EMU → pixels, cell intersection) ─────────

function markerRow(marker: any): number | null {
  return marker?.row === undefined || marker?.row === null ? null : Number(marker.row);
}

function anchorToBounds(anchor: any) {
  if (!anchor) return null;

  if (anchor.from) {
    const startRow = markerRow(anchor.from);
    const startColumn = Number(anchor.from.column);
    const endRow = markerRow(anchor.to) ?? startRow;
    const endColumn = anchor.to ? Number(anchor.to.column) : startColumn;

    if (
      !Number.isFinite(startColumn) ||
      !Number.isFinite(endColumn) ||
      !Number.isFinite(startRow) ||
      !Number.isFinite(endRow)
    ) {
      return null;
    }

    return {
      endColumn: Math.max(startColumn, endColumn as number),
      endRow: Math.max(startRow as number, endRow as number),
      startColumn: Math.min(startColumn, endColumn as number),
      startRow: Math.min(startRow as number, endRow as number),
    };
  }

  return null;
}

function parseCellReference(reference: string | null | undefined) {
  if (!reference) return null;
  const parts = String(reference).split("!");
  const rangePart = parts[parts.length - 1]?.replace(/\$/g, "");
  if (!rangePart) return null;
  return parseDimension(rangePart) || parseDimension(`${rangePart}:${rangePart}`);
}

function valuesFromRange(cells: any, reference: any, coerceNumber: boolean): any[] {
  const bounds = parseCellReference(reference);
  if (!bounds) return [];

  const values: any[] = [];
  for (let row = bounds.minRow; row <= bounds.maxRow; row += 1) {
    for (let column = bounds.minColumn; column <= bounds.maxColumn; column += 1) {
      const cell = cells?.[`${numberToColumnName(column)}${row}`];
      const value = getCellDisplayValue(cell);

      if (coerceNumber) {
        const number = Number(String(value).replace(/,/g, ""));
        values.push(Number.isFinite(number) ? number : Number.NaN);
      } else if (value) {
        values.push(value);
      }
    }
  }
  return values;
}

function cellsFromRange(cells: any, reference: any): any[] {
  const bounds = parseCellReference(reference);
  if (!bounds) return [];

  const items: any[] = [];
  for (let row = bounds.minRow; row <= bounds.maxRow; row += 1) {
    for (let column = bounds.minColumn; column <= bounds.maxColumn; column += 1) {
      items.push(cells?.[`${numberToColumnName(column)}${row}`] || null);
    }
  }
  return items;
}

function cellFillColor(cell: any, workbookStyles: any): string | null {
  const style = resolveEffectiveStyle(cell, null, null, workbookStyles);
  const { fill } = resolveStyleParts(style, workbookStyles);
  return fill?.patternType === "solid" ? colorToCss(fill.foregroundColor) : null;
}

function colorsFromRange(cells: any, reference: any, workbookStyles: any): any[] {
  const colors = cellsFromRange(cells, reference).map((cell) =>
    cellFillColor(cell, workbookStyles),
  );
  return colors.some(Boolean) ? colors : [];
}

function hydrateChartSeries(chart: any, cells: any, workbookStyles: any) {
  return {
    ...chart,
    series: (chart.series || []).map((series: any) => {
      const categoryColors = colorsFromRange(cells, series.categoriesRange, workbookStyles);
      const valueColors = colorsFromRange(cells, series.valuesRange, workbookStyles);
      const pointColors = categoryColors.length > 0 ? categoryColors : valueColors;

      return {
        ...series,
        cachedCategories:
          series.cachedCategories?.length > 0
            ? series.cachedCategories
            : valuesFromRange(cells, series.categoriesRange, false),
        cachedValues:
          series.cachedValues?.length > 0
            ? series.cachedValues
            : valuesFromRange(cells, series.valuesRange, true),
        pointColors,
        seriesColor: pointColors[0],
      };
    }),
  };
}

function drawingLabel(object: any): string {
  if (object.kind === "chart") {
    return object.title || `${object.type || "chart"} ${object.id}`;
  }
  return object.name || object.fileName || object.id;
}

function drawingImageUrl(drawing: any): string | null {
  return drawing.kind === "image" ? drawing.assetUrl : null;
}

function normalizeDrawingObjects(sheet: any, workbookStyles: any): any[] {
  const charts = (sheet?.charts || []).map((chart: any) => {
    const hydratedChart = hydrateChartSeries(chart, sheet?.cells, workbookStyles);
    return {
      ...hydratedChart,
      bounds: anchorToBounds(hydratedChart.anchor),
      kind: "chart",
      label: drawingLabel({ ...hydratedChart, kind: "chart" }),
    };
  });
  const images = (sheet?.images || []).map((image: any) => ({
    ...image,
    bounds: anchorToBounds(image.anchor),
    kind: "image",
    label: drawingLabel({ ...image, kind: "image" }),
  }));

  return [...charts, ...images];
}

function buildVisibleAxis(
  items: any[],
  keyField: string,
  sizeField: string,
  sizeForKey: ((key: number) => number) | undefined,
) {
  const metrics = new Map<number, { offset: number; size: number }>();
  let total = 0;

  for (const item of items) {
    const key = item[keyField];
    const size = item[sizeField] || 1;
    metrics.set(key, { offset: total, size });
    total += size;
  }

  return {
    items: items.map((item) => ({ key: item[keyField], size: item[sizeField] || 1 })),
    metrics,
    sizeForKey,
    total,
  };
}

function emuToPixels(value: any): number {
  return (Number(value) || 0) / 9525;
}

function markerToPixel(marker: any, axis: any): number | null {
  if (!marker) return null;

  const coordinate = Number(marker.column ?? marker.row);
  const offset = emuToPixels(marker.columnOffsetEmu ?? marker.rowOffsetEmu);
  const exactMetric = axis.metrics.get(coordinate);

  if (exactMetric) return exactMetric.offset + offset;

  const first = axis.items[0];
  const last = lastOf(axis.items as any[]);
  if (!first || !last) return null;

  if (coordinate < first.key) {
    let position = 0;
    for (let key = first.key - 1; key >= coordinate; key -= 1) {
      position -= axis.sizeForKey?.(key) || first.size;
    }
    return position + offset;
  }

  if (coordinate > last.key) {
    let position = axis.total;
    for (let key = last.key + 1; key < coordinate; key += 1) {
      position += axis.sizeForKey?.(key) || last.size;
    }
    return position + offset;
  }

  return null;
}

function anchorToPixelRect(anchor: any, columnAxis: any, rowAxis: any): Rect | null {
  const x1 = markerToPixel(
    anchor?.from
      ? { column: anchor.from.column, columnOffsetEmu: anchor.from.columnOffsetEmu }
      : null,
    columnAxis,
  );
  const y1 = markerToPixel(
    anchor?.from
      ? { row: anchor.from.row, rowOffsetEmu: anchor.from.rowOffsetEmu }
      : null,
    rowAxis,
  );
  const x2 =
    markerToPixel(
      anchor?.to ? { column: anchor.to.column, columnOffsetEmu: anchor.to.columnOffsetEmu } : null,
      columnAxis,
    ) ?? (Number.isFinite(x1) && anchor?.cxEmu ? (x1 as number) + emuToPixels(anchor.cxEmu) : null);
  const y2 =
    markerToPixel(
      anchor?.to ? { row: anchor.to.row, rowOffsetEmu: anchor.to.rowOffsetEmu } : null,
      rowAxis,
    ) ?? (Number.isFinite(y1) && anchor?.cyEmu ? (y1 as number) + emuToPixels(anchor.cyEmu) : null);

  if (![x1, y1, x2, y2].every((value) => Number.isFinite(value))) return null;

  const ax = x1 as number;
  const ay = y1 as number;
  const bx = x2 as number;
  const by = y2 as number;

  return {
    height: Math.max(1, Math.abs(by - ay)),
    width: Math.max(1, Math.abs(bx - ax)),
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
  };
}

function intersectRect(a: Rect, b: Rect): Rect | null {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  if (x2 <= x1 || y2 <= y1) return null;
  return { height: y2 - y1, width: x2 - x1, x: x1, y: y1 };
}

function buildDrawingCellRects(
  pixelRect: Rect,
  clipRect: Rect,
  visibleRows: any[],
  visibleColumns: any[],
  rowAxis: any,
  columnAxis: any,
): Map<string, any> {
  const cellRects = new Map<string, any>();

  for (const column of visibleColumns) {
    const columnMetric = columnAxis.metrics.get(column.number);
    if (!columnMetric) continue;

    for (const row of visibleRows) {
      const rowMetric = rowAxis.metrics.get(row.number);
      if (!rowMetric) continue;

      const cellRect: Rect = {
        height: rowMetric.size,
        width: columnMetric.size,
        x: columnMetric.offset,
        y: rowMetric.offset,
      };
      const intersection = intersectRect(cellRect, clipRect);
      if (!intersection) continue;

      cellRects.set(`${column.number}:${row.number}`, {
        column: column.number,
        height: intersection.height,
        row: row.number,
        sourceOffsetX: intersection.x - pixelRect.x,
        sourceOffsetY: intersection.y - pixelRect.y,
        width: intersection.width,
        xOffset: intersection.x - cellRect.x,
        yOffset: intersection.y - cellRect.y,
      });
    }
  }

  return cellRects;
}

function buildDrawingRowRects(cellRects: Map<string, any>): Map<number, any> {
  const byRow = new Map<number, any>();

  for (const rect of cellRects.values()) {
    const current = byRow.get(rect.row);
    const startX = rect.sourceOffsetX;
    const endX = rect.sourceOffsetX + rect.width;

    if (!current) {
      byRow.set(rect.row, {
        column: rect.column,
        endColumn: rect.column,
        height: rect.height,
        row: rect.row,
        sourceEndX: endX,
        sourceOffsetX: startX,
        sourceOffsetY: rect.sourceOffsetY,
        startColumn: rect.column,
        width: rect.width,
        xOffset: rect.xOffset,
        yOffset: rect.yOffset,
      });
      continue;
    }

    current.endColumn = Math.max(current.endColumn, rect.column);
    current.height = Math.max(current.height, rect.height);
    current.sourceEndX = Math.max(current.sourceEndX, endX);
    current.sourceOffsetX = Math.min(current.sourceOffsetX, startX);
    current.sourceOffsetY = Math.min(current.sourceOffsetY, rect.sourceOffsetY);

    if (rect.column < current.column) {
      current.column = rect.column;
      current.startColumn = rect.column;
      current.xOffset = rect.xOffset;
      current.yOffset = rect.yOffset;
    }

    current.width = current.sourceEndX - current.sourceOffsetX;
  }

  for (const rect of byRow.values()) {
    delete rect.sourceEndX;
  }

  return byRow;
}

function clipDrawingObjectsToGrid(
  drawings: any[],
  visibleRows: any[],
  visibleColumns: any[],
  columnSizeForNumber: (column: number) => number,
  rowSizeForNumber: (row: number) => number,
): any[] {
  if (!visibleRows.length || !visibleColumns.length) return drawings;

  const columnAxis = buildVisibleAxis(visibleColumns, "number", "width", columnSizeForNumber);
  const rowAxis = buildVisibleAxis(visibleRows, "number", "height", rowSizeForNumber);

  return drawings
    .map((drawing) => {
      if (!drawing.bounds) return drawing;

      const pixelRect = anchorToPixelRect(drawing.anchor, columnAxis, rowAxis);
      if (!pixelRect) {
        return { ...drawing, cellRects: new Map(), clipBounds: null };
      }

      const clipRect = intersectRect(pixelRect, {
        height: rowAxis.total,
        width: columnAxis.total,
        x: 0,
        y: 0,
      });
      const cellRects = clipRect
        ? buildDrawingCellRects(pixelRect, clipRect, visibleRows, visibleColumns, rowAxis, columnAxis)
        : new Map<string, any>();
      const rowRects = buildDrawingRowRects(cellRects);
      const intersectingColumns = [...cellRects.values()].map((item) => item.column);
      const intersectingRows = [...cellRects.values()].map((item) => item.row);

      return {
        ...drawing,
        cellRects,
        clipBounds:
          intersectingColumns.length > 0 && intersectingRows.length > 0
            ? {
                endColumn: Math.max(...intersectingColumns),
                endRow: Math.max(...intersectingRows),
                startColumn: Math.min(...intersectingColumns),
                startRow: Math.min(...intersectingRows),
              }
            : null,
        pixelRect,
        rowRects,
        totalHeight: pixelRect.height,
        totalWidth: pixelRect.width,
      };
    })
    .filter((drawing) => !drawing.bounds || drawing.clipBounds);
}

function findDrawingInfos(drawings: any[], row: number, column: number): any[] {
  return drawings
    .map((drawing) => {
      const rowRect = drawing.rowRects?.get(row);
      const rect =
        rowRect && column === rowRect.column
          ? rowRect
          : rowRect && column >= rowRect.startColumn && column <= rowRect.endColumn
            ? null
            : drawing.cellRects?.get(`${column}:${row}`);

      if (!rect) return null;

      return {
        drawing,
        isBottom: rect.sourceOffsetY + rect.height >= drawing.totalHeight - 0.5,
        isLeft: rect.sourceOffsetX <= 0.5,
        isRight: rect.sourceOffsetX + rect.width >= drawing.totalWidth - 0.5,
        isTop: rect.sourceOffsetY <= 0.5,
        rect,
      };
    })
    .filter(Boolean);
}

function getDrawingVisibleSpan(
  drawings: any[],
  row: number,
  column: number,
  visibleColumnIndexByNumber: Map<number, number>,
): [number, number] | undefined {
  let bestSpan: [number, number] | undefined;

  for (const drawing of drawings) {
    const rowRect = drawing.rowRects?.get(row);
    if (
      !rowRect ||
      rowRect.height < minDrawingSpanRowHeight ||
      column < rowRect.startColumn ||
      column > rowRect.endColumn
    ) {
      continue;
    }

    const visibleIndexes: number[] = [];
    for (let item = rowRect.startColumn; item <= rowRect.endColumn; item += 1) {
      const index = visibleColumnIndexByNumber.get(item);
      if (index !== undefined) visibleIndexes.push(index + 1);
    }

    if (visibleIndexes.length < 2) continue;

    const span: [number, number] = [Math.min(...visibleIndexes), Math.max(...visibleIndexes)];
    if (!bestSpan || span[1] - span[0] > bestSpan[1] - bestSpan[0]) {
      bestSpan = span;
    }
  }

  return bestSpan;
}

function getVisibleSpan(
  merge: any,
  visibleColumnIndexByNumber: Map<number, number>,
): [number, number] | undefined {
  const visibleIndexes: number[] = [];

  for (let column = merge.startColumn; column <= merge.endColumn; column += 1) {
    const index = visibleColumnIndexByNumber.get(column);
    if (index !== undefined) visibleIndexes.push(index + 1);
  }

  if (visibleIndexes.length < 2) return undefined;
  return [Math.min(...visibleIndexes), Math.max(...visibleIndexes)];
}

function estimateTextWidth(
  cell: any,
  text: string,
  rowInfo: any,
  columnInfo: any,
  workbookStyles: any,
): number {
  const style = resolveEffectiveStyle(cell, rowInfo?.meta, columnInfo?.meta, workbookStyles);
  const { font } = resolveStyleParts(style, workbookStyles);
  const fontSize = font?.size || 13;
  const averageGlyphWidth = font?.bold ? 0.62 : 0.55;
  return text.length * fontSize * averageGlyphWidth + 20;
}

function buildTextOverflowSpans(
  sheet: any,
  visibleRows: any[],
  visibleColumns: any[],
  visibleColumnIndexByNumber: Map<number, number>,
  mergeByAddress: Map<string, any>,
  clippedDrawingObjects: any[],
  workbookStyles: any,
): Map<string, any> {
  const spans = new Map<string, any>();

  for (const rowInfo of visibleRows) {
    for (let columnIndex = 0; columnIndex < visibleColumns.length; columnIndex += 1) {
      const columnInfo = visibleColumns[columnIndex];
      const address = `${columnInfo.name}${rowInfo.number}`;
      if (spans.has(address) || mergeByAddress.has(address)) continue;

      const cell = sheet.cells?.[address];
      const text = getCellDisplayValue(cell);
      if (!text) continue;

      const style = resolveEffectiveStyle(cell, rowInfo.meta, columnInfo.meta, workbookStyles);
      if (hasWrapText(style)) continue;
      if (getContentAlign(cell, style, null) !== "left") continue;

      const requiredWidth = estimateTextWidth(cell, text, rowInfo, columnInfo, workbookStyles);
      let availableWidth = columnInfo.width;
      let endColumnIndex = columnIndex;

      while (availableWidth < requiredWidth && endColumnIndex + 1 < visibleColumns.length) {
        const nextColumnIndex = endColumnIndex + 1;
        const nextColumn = visibleColumns[nextColumnIndex];
        const nextAddress = `${nextColumn.name}${rowInfo.number}`;

        if (
          mergeByAddress.has(nextAddress) ||
          getCellDisplayValue(sheet.cells?.[nextAddress]) ||
          getDrawingVisibleSpan(
            clippedDrawingObjects,
            rowInfo.number,
            nextColumn.number,
            visibleColumnIndexByNumber,
          )
        ) {
          break;
        }

        availableWidth += nextColumn.width;
        endColumnIndex = nextColumnIndex;
      }

      if (endColumnIndex <= columnIndex) continue;

      const span: [number, number] = [columnIndex + 1, endColumnIndex + 1];
      for (let item = columnIndex; item <= endColumnIndex; item += 1) {
        const spanAddress = `${visibleColumns[item].name}${rowInfo.number}`;
        spans.set(spanAddress, {
          role: item === columnIndex ? "start" : "covered",
          sourceAddress: address,
          span,
        });
      }
    }
  }

  return spans;
}

// ── Grid data builder ───────────────────────────────────────────────────

function blankCell(): any {
  return {
    allowOverlay: false,
    data: "",
    displayData: "",
    kind: GridCellKind.Text,
    readonly: true,
  };
}

function buildGridData(sheet: any, workbookStyles: any): any {
  if (!sheet) {
    return {
      columns: [],
      getCellContent: () => blankCell(),
      getCellMeta: () => null,
      getCellPosition: () => null,
      drawingObjects: [],
      mergedCells: [],
      rows: [],
      tables: [],
    };
  }

  const bounds = getSheetBounds(sheet);
  const rowMetaByIndex = buildRowMetaByIndex(sheet);
  const mergeByAddress = buildMergeByAddress(sheet);
  const tables = normalizeTables(sheet);
  const drawingObjects = normalizeDrawingObjects(sheet, workbookStyles);
  const visibleColumnIndexByNumber = new Map<number, number>();
  const visibleRowIndexByNumber = new Map<number, number>();
  const visibleRows: any[] = [];
  const visibleColumns: any[] = [];

  for (let column = bounds.minColumn; column <= bounds.maxColumn; column += 1) {
    const columnMeta = findColumnMeta(sheet, column);
    if (columnMeta?.hidden) continue;

    visibleColumnIndexByNumber.set(column, visibleColumns.length);
    visibleColumns.push({
      meta: columnMeta,
      name: numberToColumnName(column),
      number: column,
      width: excelColumnWidthToPixels(columnMeta?.width),
    });
  }

  for (let row = bounds.minRow; row <= bounds.maxRow; row += 1) {
    const rowMeta = rowMetaByIndex.get(row);
    if (!rowMeta?.hidden) {
      visibleRowIndexByNumber.set(row, visibleRows.length);
      visibleRows.push({
        height: rowHeightToPixels(rowMeta?.height),
        meta: rowMeta,
        number: row,
      });
    }
  }

  const clippedDrawingObjects = clipDrawingObjectsToGrid(
    drawingObjects,
    visibleRows,
    visibleColumns,
    (column) => excelColumnWidthToPixels(findColumnMeta(sheet, column)?.width),
    (row) => rowHeightToPixels(rowMetaByIndex.get(row)?.height),
  );
  const textOverflowByAddress = buildTextOverflowSpans(
    sheet,
    visibleRows,
    visibleColumns,
    visibleColumnIndexByNumber,
    mergeByAddress,
    clippedDrawingObjects,
    workbookStyles,
  );

  const columns = [
    { id: "__rowNumber", title: "#", width: 64 },
    ...visibleColumns.map((column) => ({
      id: column.name,
      title: column.name,
      width: column.width,
    })),
  ];

  const getCellDetails = (col: number, row: number): any => {
    const rowInfo = visibleRows[row];
    if (!rowInfo) return null;

    if (col === 0) {
      return {
        address: String(rowInfo.number),
        cell: null,
        displayValue: String(rowInfo.number),
        isRowHeader: true,
        type: "row",
      };
    }

    const visibleColumn = visibleColumns[col - 1];
    if (!visibleColumn) return null;

    const address = `${visibleColumn.name}${rowInfo.number}`;
    const merge = mergeByAddress.get(address);
    const textOverflow = !merge ? textOverflowByAddress.get(address) : null;
    const table = findTableInfo(tables, rowInfo.number, visibleColumn.number);
    const drawings = findDrawingInfos(
      clippedDrawingObjects,
      rowInfo.number,
      visibleColumn.number,
    );
    const drawingSpan = !merge
      ? getDrawingVisibleSpan(
          clippedDrawingObjects,
          rowInfo.number,
          visibleColumn.number,
          visibleColumnIndexByNumber,
        )
      : undefined;
    const sourceAddress = merge?.startAddress || textOverflow?.sourceAddress || address;
    const sourceCell = sheet.cells?.[sourceAddress];
    const isTopMergeRow = !merge || rowInfo.number === merge.startRow;
    const displayValue = isTopMergeRow ? getCellDisplayValue(sourceCell) : "";
    const style = resolveEffectiveStyle(
      sourceCell,
      rowInfo.meta,
      visibleColumn.meta,
      workbookStyles,
    );
    const presentation = buildCellPresentation(sourceCell, style, workbookStyles, merge, table);
    const span = merge
      ? getVisibleSpan(merge, visibleColumnIndexByNumber)
      : drawingSpan || textOverflow?.span;
    const role = !merge ? null : address === merge.startAddress ? "start" : "covered";

    return {
      address,
      cell: sourceCell,
      displayValue,
      drawings,
      formula: getFormulaSummary(sourceCell),
      merge: merge ? { ...merge, role, sourceAddress: merge.startAddress } : null,
      presentation,
      sourceAddress,
      span,
      style,
      styleIndex: sourceCell?.styleIndex ?? style?.index,
      table,
      type: sourceCell?.type || "blank",
      value: displayValue,
    };
  };

  return {
    columns,
    drawingObjects: clippedDrawingObjects,
    getCellPosition: (address: string | null | undefined): readonly [number, number] | null => {
      if (!address) return null;
      const parsed = parseCellAddress(address);
      if (parsed === null) return null;
      const columnIndex = visibleColumnIndexByNumber.get(parsed.column);
      const rowIndex = visibleRowIndexByNumber.get(parsed.row);
      return columnIndex === undefined || rowIndex === undefined ? null : [columnIndex + 1, rowIndex];
    },
    getCellContent: (item: readonly [number, number]) => {
      const [col, row] = item;
      const details = getCellDetails(col, row);
      if (!details) return blankCell();

      if (details.isRowHeader) {
        return {
          allowOverlay: false,
          contentAlign: "right",
          data: details.displayValue,
          displayData: details.displayValue,
          kind: GridCellKind.Text,
          readonly: true,
          themeOverride: { bgCell: "#f5f7fa", textDark: "#536174" },
        };
      }

      return {
        allowOverlay: false,
        contentAlign: details.presentation.textAlign,
        copyData: details.displayValue,
        data: details.displayValue,
        displayData: details.displayValue,
        kind: GridCellKind.Text,
        readonly: true,
        allowWrapping: details.presentation.wrapText,
        span: details.span,
        themeOverride: details.presentation.themeOverride,
      };
    },
    getCellMeta: getCellDetails,
    mergedCells: sheet.mergedCells || [],
    rows: visibleRows,
    tables,
  };
}

// ── Cell decoration (borders, underline/strike, table outline) ──────────

function lineDashForBorder(style: string): number[] {
  if (style === "dotted") return [1, 3];
  if (style?.toLowerCase().includes("dash")) return [6, 4];
  return [];
}

function drawBorderLine(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  side: "top" | "right" | "bottom" | "left",
  border: { color: string; style: string; width: number } | null,
): void {
  if (!border) return;

  const half = border.width / 2;
  ctx.beginPath();
  ctx.lineWidth = border.width;
  ctx.strokeStyle = border.color;
  ctx.setLineDash(lineDashForBorder(border.style));

  if (side === "top") {
    ctx.moveTo(rect.x, rect.y + half);
    ctx.lineTo(rect.x + rect.width, rect.y + half);
  } else if (side === "right") {
    ctx.moveTo(rect.x + rect.width - half, rect.y);
    ctx.lineTo(rect.x + rect.width - half, rect.y + rect.height);
  } else if (side === "bottom") {
    ctx.moveTo(rect.x, rect.y + rect.height - half);
    ctx.lineTo(rect.x + rect.width, rect.y + rect.height - half);
  } else if (side === "left") {
    ctx.moveTo(rect.x + half, rect.y);
    ctx.lineTo(rect.x + half, rect.y + rect.height);
  }

  ctx.stroke();
}

function drawTextDecoration(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  details: any,
  theme: any,
): void {
  if (
    !details?.displayValue ||
    (!details.presentation.font.underline && !details.presentation.font.strike)
  ) {
    return;
  }

  const padding = theme.cellHorizontalPadding || 10;
  const textWidth = Math.min(
    ctx.measureText(details.displayValue).width,
    Math.max(0, rect.width - padding * 2),
  );
  let x = rect.x + padding;

  if (details.presentation.textAlign === "center") {
    x = rect.x + (rect.width - textWidth) / 2;
  } else if (details.presentation.textAlign === "right") {
    x = rect.x + rect.width - padding - textWidth;
  }

  ctx.save();
  ctx.strokeStyle = theme.textDark;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);

  if (details.presentation.font.underline) {
    const y = rect.y + rect.height / 2 + details.presentation.font.size / 2 - 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + textWidth, y);
    ctx.stroke();
  }

  if (details.presentation.font.strike) {
    const y = rect.y + rect.height / 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + textWidth, y);
    ctx.stroke();
  }

  ctx.restore();
}

function drawTableOutline(ctx: CanvasRenderingContext2D, rect: Rect, table: any): void {
  if (!table) return;

  ctx.save();
  ctx.strokeStyle = "#19736a";
  ctx.lineWidth = 2;
  ctx.setLineDash([]);

  if (table.isTop) {
    drawStraightLine(ctx, rect.x, rect.y + 1, rect.x + rect.width, rect.y + 1);
  }
  if (table.isRight) {
    drawStraightLine(
      ctx,
      rect.x + rect.width - 1,
      rect.y,
      rect.x + rect.width - 1,
      rect.y + rect.height,
    );
  }
  if (table.isBottom) {
    drawStraightLine(
      ctx,
      rect.x,
      rect.y + rect.height - 1,
      rect.x + rect.width,
      rect.y + rect.height - 1,
    );
  }
  if (table.isLeft) {
    drawStraightLine(ctx, rect.x + 1, rect.y, rect.x + 1, rect.y + rect.height);
  }

  if (table.isHeaderBottom || table.isTotalsTop) {
    ctx.strokeStyle = "#2b8f86";
    ctx.lineWidth = 1.5;
    const y = table.isHeaderBottom ? rect.y + rect.height - 1 : rect.y + 1;
    drawStraightLine(ctx, rect.x, y, rect.x + rect.width, y);
  }

  ctx.restore();
}

function drawStraightLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

// ── Drawing overlay (charts + images on top of the grid) ────────────────

function expandedClipRect(rect: Rect, target: any): Rect {
  const bleed = 1;
  return {
    height: Math.min(rect.height, target.height + bleed * 2),
    width: Math.min(rect.width, target.width + bleed * 2),
    x: rect.x + target.xOffset - bleed,
    y: rect.y + target.yOffset - bleed,
  };
}

function drawChartTile(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  drawingInfo: any,
  theme: any,
): void {
  const drawing = drawingInfo.drawing;
  const target = drawingInfo.rect;

  if (!target || !drawing.totalWidth || !drawing.totalHeight) {
    drawChart(ctx, drawing, rect.x, rect.y, rect.width, rect.height, theme);
    return;
  }

  ctx.save();
  const clip = expandedClipRect(rect, target);
  ctx.beginPath();
  ctx.rect(clip.x, clip.y, clip.width, clip.height);
  ctx.clip();
  ctx.translate(
    rect.x + target.xOffset - target.sourceOffsetX,
    rect.y + target.yOffset - target.sourceOffsetY,
  );
  drawChart(ctx, drawing, 0, 0, drawing.totalWidth, drawing.totalHeight, theme);
  ctx.restore();
}

function drawImageTile(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  drawingInfo: any,
  image: HTMLImageElement,
): void {
  const drawing = drawingInfo.drawing;
  const target = drawingInfo.rect;

  if (
    !target ||
    !drawing.totalWidth ||
    !drawing.totalHeight ||
    !image.naturalWidth ||
    !image.naturalHeight
  ) {
    ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height);
    return;
  }

  const sourceX = (target.sourceOffsetX / drawing.totalWidth) * image.naturalWidth;
  const sourceY = (target.sourceOffsetY / drawing.totalHeight) * image.naturalHeight;
  const sourceWidth = (target.width / drawing.totalWidth) * image.naturalWidth;
  const sourceHeight = (target.height / drawing.totalHeight) * image.naturalHeight;

  ctx.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    rect.x + target.xOffset,
    rect.y + target.yOffset,
    target.width,
    target.height,
  );
}

function getColumnOffset(columns: any[], index: number): number {
  let offset = 0;
  for (let item = 0; item < index && item < columns.length; item += 1) {
    offset += columns[item]?.width || 0;
  }
  return offset;
}

function getRowOffset(rows: any[], index: number): number {
  let offset = 0;
  for (let item = 0; item < index && item < rows.length; item += 1) {
    offset += rows[item]?.height || 0;
  }
  return offset;
}

function intersectsViewport(rect: Rect, width: number, height: number): boolean {
  return rect.x < width && rect.y < height && rect.x + rect.width > 0 && rect.y + rect.height > 0;
}

function drawFullDrawingOverlay(
  ctx: CanvasRenderingContext2D,
  drawing: any,
  rect: Rect,
  theme: any,
  imageCache: Record<string, any>,
): void {
  const colors = drawingColors[drawing.kind] || drawingColors.chart;
  const imageUrl = drawingImageUrl(drawing);
  const imageEntry = imageUrl ? imageCache[imageUrl] : null;
  const hasLoadedImage = imageEntry?.status === "loaded" && imageEntry.image;
  const hasRenderableChart =
    drawing.kind === "chart" && getRenderableSeries(drawing).length > 0;

  ctx.save();

  if (hasLoadedImage) {
    ctx.drawImage(imageEntry.image, rect.x, rect.y, rect.width, rect.height);
  } else if (hasRenderableChart) {
    drawChart(ctx, drawing, rect.x, rect.y, rect.width, rect.height, theme);
  } else {
    ctx.fillStyle = colors.bg;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    drawObjectLabel(ctx, rect, drawing, colors, theme);
  }

  ctx.restore();
}

function drawDrawingOverlayCanvas(
  canvas: HTMLCanvasElement | null,
  gridData: any,
  visibleRegion: any,
  theme: any,
  imageCache: Record<string, any>,
  headerHeight = 32,
): void {
  if (!canvas) return;

  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  const pixelWidth = Math.max(1, Math.round(width * dpr));
  const pixelHeight = Math.max(1, Math.round(height * dpr));

  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const drawings = gridData.drawingObjects || [];
  if (drawings.length === 0 || width <= 0 || height <= 0) return;

  const frozenWidth = gridData.columns[0]?.width || 0;
  const firstVisibleColumn = Math.max(1, visibleRegion?.x ?? 1);
  const firstVisibleRow = Math.max(0, visibleRegion?.y ?? 0);
  const tx = visibleRegion?.tx ?? 0;
  const ty = visibleRegion?.ty ?? 0;
  const scrollX = getColumnOffset(gridData.columns, firstVisibleColumn) - frozenWidth - tx;
  const scrollY = getRowOffset(gridData.rows, firstVisibleRow) - ty;

  ctx.save();
  ctx.beginPath();
  ctx.rect(
    frozenWidth,
    headerHeight,
    Math.max(0, width - frozenWidth),
    Math.max(0, height - headerHeight),
  );
  ctx.clip();

  for (const drawing of drawings) {
    if (!drawing.pixelRect) continue;

    const rect: Rect = {
      height: drawing.pixelRect.height,
      width: drawing.pixelRect.width,
      x: frozenWidth + drawing.pixelRect.x - scrollX,
      y: headerHeight + drawing.pixelRect.y - scrollY,
    };

    if (!intersectsViewport(rect, width, height)) continue;
    drawFullDrawingOverlay(ctx, drawing, rect, theme, imageCache);
  }

  ctx.restore();
}

function DrawingOverlay({
  gridData,
  imageCache,
  theme,
  visibleRegion,
}: {
  gridData: any;
  imageCache: Record<string, any>;
  theme: any;
  visibleRegion: any;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ height: 0, width: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!parent) return undefined;

    const resizeObserver = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setSize({ height: rect.height, width: rect.width });
    });

    resizeObserver.observe(parent);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const animationFrame = window.requestAnimationFrame(() => {
      drawDrawingOverlayCanvas(canvas, gridData, visibleRegion, theme, imageCache);
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [gridData, imageCache, size, theme, visibleRegion]);

  return <canvas aria-hidden="true" className="web-workbook-drawing-overlay" ref={canvasRef} />;
}

function WorkbookZoomPicker({
  onZoom,
  zoom,
}: {
  readonly onZoom: (zoom: number) => void;
  readonly zoom: number;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredLevel, setHoveredLevel] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  const selectedIndex = nearestWorkbookZoomIndex(zoom);
  const selectedZoom = workbookZoomLevels[selectedIndex] ?? 100;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) {
        return;
      }
      setIsOpen(false);
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    const handleWindowBlur = () => setIsOpen(false);

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [isOpen]);

  const openMenu = (focusIndex = selectedIndex) => {
    setIsOpen(true);
    window.requestAnimationFrame(() => itemRefs.current[focusIndex]?.focus());
  };

  const selectZoom = (nextZoom: number) => {
    onZoom(nextZoom);
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openMenu(selectedIndex);
    }
  };

  return (
    <div
      ref={rootRef}
      className="web-workbook-zoom-picker"
      title="Zoom level"
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && rootRef.current?.contains(nextTarget)) {
          return;
        }
        setIsOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label="Zoom level"
        aria-haspopup="listbox"
        aria-controls={isOpen ? menuId : undefined}
        aria-expanded={isOpen}
        className="web-workbook-zoom-trigger"
        onClick={() => setIsOpen((open) => !open)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span>{selectedZoom}%</span>
        <HugeiconsIcon icon={ArrowDown01Icon} size={12} color="currentColor" strokeWidth={2.1} />
      </button>

      {isOpen && (
        <div id={menuId} role="listbox" aria-label="Zoom level" className="web-workbook-zoom-menu">
          {workbookZoomLevels.map((level, index) => {
            const isSelected = level === selectedZoom;
            const isHovered = level === hoveredLevel;

            return (
              <button
                key={level}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={isHovered ? "hovered" : ""}
                onClick={() => selectZoom(level)}
                onFocus={() => setHoveredLevel(level)}
                onMouseEnter={() => setHoveredLevel(level)}
                onMouseLeave={() => setHoveredLevel(null)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    const direction = event.key === "ArrowDown" ? 1 : -1;
                    const nextIndex = (index + direction + workbookZoomLevels.length) % workbookZoomLevels.length;
                    itemRefs.current[nextIndex]?.focus();
                    setHoveredLevel(workbookZoomLevels[nextIndex] ?? null);
                  } else if (event.key === "Home") {
                    event.preventDefault();
                    itemRefs.current[0]?.focus();
                    setHoveredLevel(workbookZoomLevels[0] ?? null);
                  } else if (event.key === "End") {
                    event.preventDefault();
                    const lastIndex = workbookZoomLevels.length - 1;
                    itemRefs.current[lastIndex]?.focus();
                    setHoveredLevel(workbookZoomLevels[lastIndex] ?? null);
                  }
                }}
              >
                <span>{level}%</span>
                <span className="web-workbook-zoom-check" aria-hidden="true">
                  {isSelected ? (
                    <HugeiconsIcon icon={Tick02Icon} size={14} color="currentColor" strokeWidth={2.2} />
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Drawing overlay tile helpers used by drawCell — share the same canvas
// state as the cell-level renderer so charts/images line up exactly with
// the grid lines underneath them.
function drawDrawingOverlays(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  drawingInfos: any[],
  theme: any,
  imageCache: Record<string, any>,
): void {
  if (!drawingInfos?.length) return;

  for (const drawingInfo of drawingInfos) {
    const drawing = drawingInfo.drawing;
    const colors = drawingColors[drawing.kind] || drawingColors.chart;
    const imageUrl = drawingImageUrl(drawing);
    const imageEntry = imageUrl ? imageCache[imageUrl] : null;
    const hasLoadedImage = imageEntry?.status === "loaded" && imageEntry.image;
    const hasRenderableChart =
      drawing.kind === "chart" && getRenderableSeries(drawing).length > 0;

    ctx.save();

    if (hasLoadedImage) {
      drawImageTile(ctx, rect, drawingInfo, imageEntry.image);
    } else if (hasRenderableChart) {
      drawChartTile(ctx, rect, drawingInfo, theme);
    } else {
      ctx.fillStyle = colors.bg;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }

    if (!hasLoadedImage && !hasRenderableChart && drawingInfo.isTop && drawingInfo.isLeft) {
      drawObjectLabel(ctx, rect, drawing, colors, theme);
    }

    ctx.restore();
  }
}

// ── Chart rendering ─────────────────────────────────────────────────────

function getRenderableSeries(chart: any): any[] {
  return (chart.series || [])
    .map((series: any) => ({ ...series, cachedValues: series.cachedValues || [] }))
    .filter((series: any) => series.cachedValues.some(Number.isFinite));
}

function getChartCategories(series: any[]): string[] {
  const source = series.find((item) => item.cachedCategories?.length > 0);
  const categoryCount = Math.max(0, ...series.map((item) => item.cachedValues.length));
  return Array.from({ length: categoryCount }, (_, index) => {
    return source?.cachedCategories?.[index] || `Item ${index + 1}`;
  });
}

function chartSeriesColor(series: any, seriesIndex: number): string {
  return (
    colorToCss(series.color) ||
    series.seriesColor ||
    chartPalette[seriesIndex % chartPalette.length]
  );
}

function chartPointColor(series: any, pointIndex: number, seriesIndex: number): string {
  return series.pointColors?.[pointIndex] || chartSeriesColor(series, seriesIndex);
}

function chartBarDirection(chart: any): string {
  return chart.barDirection || chart.barDir || "col";
}

function chartBarGrouping(chart: any): string {
  return chart.barGrouping || chart.grouping || "clustered";
}

function drawChart(
  ctx: CanvasRenderingContext2D,
  chart: any,
  x: number,
  y: number,
  width: number,
  height: number,
  theme: any,
): void {
  if (width < 48 || height < 36) return;

  const series = getRenderableSeries(chart);
  if (series.length === 0) return;

  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = "rgba(92, 95, 190, 0.18)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);

  const titleHeight = chart.title ? 24 : 8;
  const legendHeight = height > 120 ? 24 : 0;
  const plot = {
    height: Math.max(20, height - titleHeight - legendHeight - 14),
    width: Math.max(24, width - 22),
    x: x + 12,
    y: y + titleHeight,
  };

  if (chart.title) {
    ctx.fillStyle = theme.textDark || "#172033";
    ctx.font = `700 13px ${theme.fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(chart.title, x + width / 2, y + 7, width - 18);
  }

  if (chart.type === "pie" || chart.type === "doughnut") {
    if (hasInvalidPieValues(series[0])) {
      drawChartError(ctx, plot, "Pie values must be non-negative numbers", theme);
      ctx.restore();
      return;
    }
    drawPieChart(ctx, series[0], plot, chart.type);
  } else if (chart.type === "line" || chart.type === "area" || chart.type === "scatter") {
    drawLineChart(ctx, series, plot, chart.type);
  } else if (
    chartBarGrouping(chart) === "percentStacked" ||
    chartBarGrouping(chart) === "stacked"
  ) {
    drawStackedBarChart(ctx, series, plot, theme, chartBarDirection(chart), chartBarGrouping(chart));
  } else if (chartBarDirection(chart) === "bar") {
    drawHorizontalBarChart(ctx, series, plot, theme);
  } else {
    drawBarChart(ctx, series, plot, theme);
  }

  if (legendHeight > 0) {
    drawLegend(ctx, series, x + 12, y + height - legendHeight, width - 24, legendHeight, theme);
  }

  ctx.restore();
}

function hasInvalidPieValues(series: any): boolean {
  const values = series?.cachedValues || [];
  return values.length === 0 || values.some((value: any) => !Number.isFinite(value) || value < 0);
}

function drawChartError(
  ctx: CanvasRenderingContext2D,
  plot: any,
  message: string,
  theme: any,
): void {
  const centerX = plot.x + plot.width / 2;
  const centerY = plot.y + plot.height / 2;
  const iconSize = Math.min(34, Math.max(18, Math.min(plot.width, plot.height) * 0.22));

  ctx.save();
  ctx.strokeStyle = "rgba(180, 70, 58, 0.25)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(plot.x, centerY);
  ctx.lineTo(plot.x + plot.width, centerY);
  ctx.stroke();

  ctx.fillStyle = "#d84a3a";
  ctx.beginPath();
  ctx.arc(centerX - Math.min(92, plot.width * 0.35), plot.y + 20, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 11px ${theme.fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("!", centerX - Math.min(92, plot.width * 0.35), plot.y + 20);

  ctx.fillStyle = "#d84a3a";
  ctx.font = `600 12px ${theme.fontFamily}`;
  ctx.textAlign = "left";
  ctx.fillText(message, centerX - Math.min(72, plot.width * 0.26), plot.y + 20, plot.width * 0.7);

  ctx.strokeStyle = "rgba(83, 97, 116, 0.18)";
  ctx.lineWidth = 5;
  ctx.strokeRect(centerX - iconSize / 2, centerY - iconSize / 2, iconSize, iconSize);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(centerX - iconSize * 0.22, centerY + iconSize * 0.22);
  ctx.lineTo(centerX - iconSize * 0.22, centerY);
  ctx.moveTo(centerX, centerY + iconSize * 0.22);
  ctx.lineTo(centerX, centerY - iconSize * 0.18);
  ctx.moveTo(centerX + iconSize * 0.22, centerY + iconSize * 0.22);
  ctx.lineTo(centerX + iconSize * 0.22, centerY - iconSize * 0.05);
  ctx.stroke();
  ctx.restore();
}

function drawPieChart(ctx: CanvasRenderingContext2D, series: any, plot: any, type: string): void {
  const values = series.cachedValues.map((value: number) => Math.max(0, value));
  const total = values.reduce((sum: number, value: number) => sum + value, 0);
  const radius = Math.max(8, Math.min(plot.width, plot.height) * 0.38);
  const cx = plot.x + plot.width / 2;
  const cy = plot.y + plot.height / 2;

  if (total <= 0) {
    drawEmptyPieChart(ctx, cx, cy, radius);
    return;
  }

  let angle = -Math.PI / 2;
  values.forEach((value: number, index: number) => {
    const slice = (value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, angle, angle + slice);
    ctx.closePath();
    ctx.fillStyle = chartPointColor(series, index, index);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    angle += slice;
  });

  if (type === "doughnut") {
    ctx.beginPath();
    ctx.fillStyle = "#ffffff";
    ctx.arc(cx, cy, radius * 0.52, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawEmptyPieChart(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
): void {
  const slice = (Math.PI * 2) / 3;
  let angle = -Math.PI / 2;

  for (let index = 0; index < 3; index += 1) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, angle, angle + slice);
    ctx.closePath();
    ctx.fillStyle = index % 2 === 0 ? "#eef2f7" : "#f8fafc";
    ctx.fill();
    ctx.strokeStyle = "#cfd6e2";
    ctx.lineWidth = 1;
    ctx.stroke();
    angle += slice;
  }

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = "#9aa7b8";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function chartValueExtent(series: any[]): { min: number; max: number } {
  const values = series.flatMap((item) => item.cachedValues).filter(Number.isFinite);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const padding = Math.max(1, (max - min) * 0.08);
  return { max: max + padding, min: min - padding };
}

function valueToY(value: number, plot: any, extent: any): number {
  const range = extent.max - extent.min || 1;
  return plot.y + plot.height - ((value - extent.min) / range) * plot.height;
}

function valueToX(value: number, plot: any, extent: any): number {
  const range = extent.max - extent.min || 1;
  return plot.x + ((value - extent.min) / range) * plot.width;
}

function drawAxes(ctx: CanvasRenderingContext2D, plot: any, extent: any): void {
  const zeroY = valueToY(0, plot, extent);

  ctx.save();
  ctx.strokeStyle = "rgba(83, 97, 116, 0.24)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(plot.x, plot.y);
  ctx.lineTo(plot.x, plot.y + plot.height);
  ctx.lineTo(plot.x + plot.width, plot.y + plot.height);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(plot.x, zeroY);
  ctx.lineTo(plot.x + plot.width, zeroY);
  ctx.stroke();
  ctx.restore();
}

function drawHorizontalAxes(ctx: CanvasRenderingContext2D, plot: any, extent: any): void {
  const zeroX = valueToX(0, plot, extent);

  ctx.save();
  ctx.strokeStyle = "rgba(83, 97, 116, 0.24)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(plot.x, plot.y);
  ctx.lineTo(plot.x, plot.y + plot.height);
  ctx.lineTo(plot.x + plot.width, plot.y + plot.height);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(zeroX, plot.y);
  ctx.lineTo(zeroX, plot.y + plot.height);
  ctx.stroke();
  ctx.restore();
}

function drawCategoryLabels(
  ctx: CanvasRenderingContext2D,
  categories: string[],
  plot: any,
  theme: any,
  orientation: "horizontal" | "vertical",
): void {
  ctx.save();
  ctx.fillStyle = theme.textMedium || "#536174";
  ctx.font = `600 9px ${theme.fontFamily}`;
  ctx.textBaseline = "middle";

  if (orientation === "horizontal") {
    const categoryHeight = plot.height / Math.max(1, categories.length);
    ctx.textAlign = "right";
    categories.forEach((category, index) => {
      ctx.fillText(
        category,
        plot.x - 5,
        plot.y + index * categoryHeight + categoryHeight / 2,
        Math.max(10, plot.labelWidth - 8),
      );
    });
  } else {
    const categoryWidth = plot.width / Math.max(1, categories.length);
    ctx.textAlign = "center";
    categories.forEach((category, index) => {
      ctx.fillText(
        category,
        plot.x + index * categoryWidth + categoryWidth / 2,
        plot.y + plot.height + plot.labelHeight / 2,
        Math.max(10, categoryWidth - 3),
      );
    });
  }

  ctx.restore();
}

function drawHorizontalBarChart(
  ctx: CanvasRenderingContext2D,
  series: any[],
  plot: any,
  theme: any,
): void {
  const categories = getChartCategories(series);
  const labelWidth = plot.width > 82 ? clamp(plot.width * 0.32, 38, 96) : 0;
  const innerPlot = {
    ...plot,
    labelWidth,
    width: Math.max(12, plot.width - labelWidth),
    x: plot.x + labelWidth,
  };
  const extent = chartValueExtent(series);
  const zeroX = valueToX(0, innerPlot, extent);
  const categoryHeight = innerPlot.height / Math.max(1, categories.length);
  const groupHeight = Math.max(4, categoryHeight * 0.72);
  const barHeight = Math.max(2, groupHeight / Math.max(1, series.length));

  if (labelWidth > 0) drawCategoryLabels(ctx, categories, innerPlot, theme, "horizontal");
  drawHorizontalAxes(ctx, innerPlot, extent);

  categories.forEach((_, categoryIndex) => {
    const groupStart =
      innerPlot.y + categoryIndex * categoryHeight + (categoryHeight - groupHeight) / 2;

    series.forEach((item, seriesIndex) => {
      const value = item.cachedValues[categoryIndex];
      if (!Number.isFinite(value)) return;

      const valueX = valueToX(value, innerPlot, extent);
      const barX = Math.min(valueX, zeroX);
      const barY = groupStart + seriesIndex * barHeight;
      const barWidth = Math.max(1, Math.abs(valueX - zeroX));

      ctx.fillStyle =
        series.length === 1
          ? chartPointColor(item, categoryIndex, seriesIndex)
          : chartSeriesColor(item, seriesIndex);
      ctx.fillRect(barX, barY, barWidth, Math.max(1, barHeight - 1));
    });
  });
}

function stackTotal(series: any[], categoryIndex: number): number {
  return series.reduce((sum, item) => {
    const value = item.cachedValues[categoryIndex];
    return sum + (Number.isFinite(value) && value > 0 ? value : 0);
  }, 0);
}

function formatChartValue(value: number): string {
  if (!Number.isFinite(value)) return "";
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function drawStackedBarChart(
  ctx: CanvasRenderingContext2D,
  series: any[],
  plot: any,
  theme: any,
  direction: string,
  grouping: string,
): void {
  const categories = getChartCategories(series);

  if (direction === "bar") {
    drawHorizontalStackedBarChart(ctx, series, categories, plot, theme, grouping);
    return;
  }

  drawVerticalStackedBarChart(ctx, series, categories, plot, theme, grouping);
}

function drawVerticalStackedBarChart(
  ctx: CanvasRenderingContext2D,
  series: any[],
  categories: string[],
  plot: any,
  theme: any,
  grouping: string,
): void {
  const labelHeight = plot.height > 48 ? clamp(plot.height * 0.16, 14, 24) : 0;
  const innerPlot = {
    ...plot,
    height: Math.max(12, plot.height - labelHeight),
    labelHeight,
  };
  const categoryWidth = innerPlot.width / Math.max(1, categories.length);
  const barWidth = Math.max(5, categoryWidth * 0.58);
  const maxTotal = Math.max(1, ...categories.map((_, index) => stackTotal(series, index)));

  drawAxes(ctx, innerPlot, {
    max: grouping === "percentStacked" ? 1 : maxTotal,
    min: 0,
  });

  if (labelHeight > 0) drawCategoryLabels(ctx, categories, innerPlot, theme, "vertical");

  categories.forEach((_, categoryIndex) => {
    const total = stackTotal(series, categoryIndex);
    let yCursor = innerPlot.y + innerPlot.height;
    const barX = innerPlot.x + categoryIndex * categoryWidth + (categoryWidth - barWidth) / 2;

    series.forEach((item, seriesIndex) => {
      const value = item.cachedValues[categoryIndex];
      if (!Number.isFinite(value) || value <= 0 || total <= 0) return;

      const ratio = grouping === "percentStacked" ? value / total : value / maxTotal;
      const segmentHeight = Math.max(1, innerPlot.height * ratio);
      yCursor -= segmentHeight;

      ctx.fillStyle = chartSeriesColor(item, seriesIndex);
      ctx.fillRect(barX, yCursor, barWidth, segmentHeight);

      if (segmentHeight > 16 && barWidth > 34) {
        ctx.fillStyle = "#ffffff";
        ctx.font = `600 10px ${theme.fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(
          formatChartValue(value),
          barX + barWidth / 2,
          yCursor + segmentHeight / 2,
          barWidth - 4,
        );
      }
    });
  });
}

function drawHorizontalStackedBarChart(
  ctx: CanvasRenderingContext2D,
  series: any[],
  categories: string[],
  plot: any,
  theme: any,
  grouping: string,
): void {
  const labelWidth = plot.width > 82 ? clamp(plot.width * 0.32, 38, 96) : 0;
  const innerPlot = {
    ...plot,
    labelWidth,
    width: Math.max(12, plot.width - labelWidth),
    x: plot.x + labelWidth,
  };
  const categoryHeight = innerPlot.height / Math.max(1, categories.length);
  const barHeight = Math.max(5, categoryHeight * 0.58);
  const maxTotal = Math.max(1, ...categories.map((_, index) => stackTotal(series, index)));

  drawHorizontalAxes(ctx, innerPlot, {
    max: grouping === "percentStacked" ? 1 : maxTotal,
    min: 0,
  });

  if (labelWidth > 0) drawCategoryLabels(ctx, categories, innerPlot, theme, "horizontal");

  categories.forEach((_, categoryIndex) => {
    const total = stackTotal(series, categoryIndex);
    let xCursor = innerPlot.x;
    const barY = innerPlot.y + categoryIndex * categoryHeight + (categoryHeight - barHeight) / 2;

    series.forEach((item, seriesIndex) => {
      const value = item.cachedValues[categoryIndex];
      if (!Number.isFinite(value) || value <= 0 || total <= 0) return;

      const ratio = grouping === "percentStacked" ? value / total : value / maxTotal;
      const segmentWidth = Math.max(1, innerPlot.width * ratio);

      ctx.fillStyle = chartSeriesColor(item, seriesIndex);
      ctx.fillRect(xCursor, barY, segmentWidth, barHeight);

      if (segmentWidth > 42 && barHeight > 13) {
        ctx.fillStyle = "#ffffff";
        ctx.font = `600 10px ${theme.fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(
          formatChartValue(value),
          xCursor + segmentWidth / 2,
          barY + barHeight / 2,
          segmentWidth - 4,
        );
      }

      xCursor += segmentWidth;
    });
  });
}

function drawBarChart(
  ctx: CanvasRenderingContext2D,
  series: any[],
  plot: any,
  theme: any,
): void {
  const categories = getChartCategories(series);
  const labelHeight = plot.height > 48 ? clamp(plot.height * 0.16, 14, 24) : 0;
  const innerPlot = {
    ...plot,
    height: Math.max(12, plot.height - labelHeight),
    labelHeight,
  };
  const extent = chartValueExtent(series);
  const zeroY = valueToY(0, innerPlot, extent);
  const categoryWidth = innerPlot.width / Math.max(1, categories.length);
  const groupWidth = Math.max(4, categoryWidth * 0.72);
  const barWidth = Math.max(2, groupWidth / Math.max(1, series.length));

  drawAxes(ctx, innerPlot, extent);

  if (labelHeight > 0) drawCategoryLabels(ctx, categories, innerPlot, theme, "vertical");

  categories.forEach((_, categoryIndex) => {
    const groupStart =
      innerPlot.x + categoryIndex * categoryWidth + (categoryWidth - groupWidth) / 2;

    series.forEach((item, seriesIndex) => {
      const value = item.cachedValues[categoryIndex];
      if (!Number.isFinite(value)) return;

      const valueY = valueToY(value, innerPlot, extent);
      const barX = groupStart + seriesIndex * barWidth;
      const barY = Math.min(valueY, zeroY);
      const barHeight = Math.max(1, Math.abs(zeroY - valueY));

      ctx.fillStyle =
        series.length === 1
          ? chartPointColor(item, categoryIndex, seriesIndex)
          : chartSeriesColor(item, seriesIndex);
      ctx.fillRect(barX, barY, Math.max(1, barWidth - 1), barHeight);
    });
  });
}

function drawLineChart(
  ctx: CanvasRenderingContext2D,
  series: any[],
  plot: any,
  type: string,
): void {
  const categories = getChartCategories(series);
  const extent = chartValueExtent(series);
  const step = categories.length > 1 ? plot.width / (categories.length - 1) : plot.width;

  drawAxes(ctx, plot, extent);

  series.forEach((item, seriesIndex) => {
    const points = item.cachedValues
      .map((value: number, index: number) => ({
        x: plot.x + index * step,
        y: valueToY(value, plot, extent),
      }))
      .filter((point: any) => Number.isFinite(point.y));

    if (points.length === 0) return;

    ctx.strokeStyle = chartSeriesColor(item, seriesIndex);
    ctx.fillStyle = chartSeriesColor(item, seriesIndex);
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((point: any, index: number) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();

    if (type === "area") {
      const tail = points[points.length - 1];
      ctx.lineTo(tail.x, plot.y + plot.height);
      ctx.lineTo(points[0].x, plot.y + plot.height);
      ctx.closePath();
      ctx.globalAlpha = 0.18;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    for (const point of points) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, type === "scatter" ? 3 : 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function drawLegend(
  ctx: CanvasRenderingContext2D,
  series: any[],
  x: number,
  y: number,
  width: number,
  height: number,
  theme: any,
): void {
  const itemWidth = width / Math.min(series.length, 3);

  ctx.save();
  ctx.font = `600 10px ${theme.fontFamily}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  series.slice(0, 3).forEach((item, index) => {
    const itemX = x + index * itemWidth;
    ctx.fillStyle = chartSeriesColor(item, index);
    ctx.fillRect(itemX, y + height / 2 - 4, 8, 8);
    ctx.fillStyle = theme.textMedium || "#536174";
    ctx.fillText(item.name || `Series ${index + 1}`, itemX + 12, y + height / 2, itemWidth - 16);
  });

  ctx.restore();
}

function drawObjectLabel(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  drawing: any,
  colors: { labelBg: string; border: string; labelText: string },
  theme: any,
): void {
  const label = `${drawing.kind === "chart" ? "Chart" : "Image"}: ${drawing.label}`;
  const maxWidth = Math.max(0, rect.width - 12);
  if (!label || maxWidth < 24) return;

  ctx.save();
  ctx.font = `700 11px ${theme.fontFamily}`;
  const text = label.length > 34 ? `${label.slice(0, 31)}...` : label;
  const textWidth = Math.min(ctx.measureText(text).width, maxWidth - 12);
  const chipWidth = clamp(textWidth + 12, 24, maxWidth);
  const chipHeight = 22;
  const x = rect.x + 6;
  const y = rect.y + 6;

  ctx.fillStyle = colors.labelBg;
  ctx.fillRect(x, y, chipWidth, chipHeight);
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.strokeRect(x + 0.5, y + 0.5, chipWidth - 1, chipHeight - 1);
  ctx.fillStyle = colors.labelText;
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + 6, y + chipHeight / 2, chipWidth - 12);
  ctx.restore();
}

// ── WebWorkbook component ───────────────────────────────────────────────

/**
 * Props for {@link WebWorkbook}. Mirrors the upstream contract exactly —
 * every prop has the same name and default as the reference component so
 * consumers porting code don't have to relearn the API. The `workbook` prop
 * accepts whatever JSON the openxml parser server emits.
 */
export interface WebWorkbookProps {
  /** Page background painted under the workbook when `.theme-dark` is active. */
  darkBgColor?: string;
  /** Initial value displayed in the formula bar when nothing is selected. */
  formulaValue?: string;
  /** Styles merged onto the toolbar icon buttons on hover (also drives a CSS var). */
  iconButtonHoverStyle?: CSSProperties;
  /** Styles merged onto the resting state of toolbar icon buttons. */
  iconButtonStyle?: CSSProperties;
  /** Page background painted under the workbook by default. */
  lightBgColor?: string;
  /** Default selection label shown until the user clicks a cell. */
  selectedRange?: string;
  /** Workbook title displayed at the top-left of the toolbar. */
  title?: string;
  /** Styles merged onto the title element. */
  titleStyle?: CSSProperties;
  /** Parsed workbook JSON (sheets/cells/styles/charts/images/tables/merges). */
  workbook?: any | null;
  /** Original workbook bytes used by the toolbar download button. */
  downloadFile?: Blob | ArrayBuffer | Uint8Array | null;
  /** URL for downloading the latest workbook from the preview server. */
  downloadUrl?: string | null;
  /** Filename used when `downloadFile` is provided. */
  downloadFileName?: string;
  /** MIME type used when `downloadFile` is provided. */
  downloadMime?: string;
  /** Whether to export the parsed workbook JSON when no original file is available. */
  allowJsonDownloadFallback?: boolean;
  /** Called after the workbook grid has rendered enough to be shown. */
  onReady?: () => void;
  /** Metadata describing how the current workbook changed. */
  workbookChange?: PreviewWorkbookChange;
  /**
   * Optional override for the download action. When omitted, the viewer
   * downloads the workbook JSON serialized as a `.json` file.
   */
  onDownload?:
    | ((info: {
        selectedSheet: any;
        selectedSheetIndex: number;
        title: string;
        workbook: any;
      }) => void)
    | null;
  /** Styles merged onto the zoom percentage text. */
  zoomTextStyle?: CSSProperties;
}

/**
 * Read-only workbook renderer powered by glide-data-grid, with a HugeIcons
 * toolbar, a formula bar, and a bottom sheet strip. Mirrors the upstream
 * openxml-demo-client `WebWorkbook` one-to-one: same defaults, same CSS
 * class names, same internal grid theme, same chart palette.
 */
export function WebWorkbook({
  darkBgColor = "#0F0F11",
  formulaValue = "",
  iconButtonHoverStyle = {},
  iconButtonStyle = {},
  lightBgColor = "#FFFFFF",
  selectedRange = "A1",
  title = "Workbook.xlsx",
  titleStyle = {},
  workbook = null,
  downloadFile = null,
  downloadUrl = null,
  downloadFileName,
  downloadMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  allowJsonDownloadFallback = true,
  onReady,
  workbookChange,
  onDownload = null,
  zoomTextStyle = {},
}: WebWorkbookProps) {
  const [zoom, setZoom] = useState(getStoredWorkbookZoom);
  const [selectedSheetIndex, setSelectedSheetIndex] = useState(0);
  const [selectedCell, setSelectedCell] = useState<any>(null);
  const [gridSelection, setGridSelection] = useState<any>(createEmptyGridSelection);
  const [visibleRegion, setVisibleRegion] = useState<any>(null);
  const [imageCache, setImageCache] = useState<Record<string, any>>({});
  const dataEditorRef = useRef<DataEditorRef | null>(null);
  const selectedSheetIndexRef = useRef(selectedSheetIndex);
  const activeSheetKeyRef = useRef<string | null>(null);
  const selectionSnapshotRef = useRef<SelectionSnapshot | null>(null);
  const visibleAddressRef = useRef<string | null>(null);
  const workbookChangeVersionRef = useRef<number | null>(null);
  const imageLoadRef = useRef<Set<string>>(new Set<string>());
  const skipNextSheetHashWriteRef = useRef(false);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  selectedSheetIndexRef.current = selectedSheetIndex;
  const sheets = getWorkbookSheets(workbook);
  const workbookStyles = workbook?.workbook?.styles || workbook?.styles || {};
  const selectedSheet = sheets[selectedSheetIndex] || sheets[0];
  const gridData = useMemo(
    () => buildGridData(selectedSheet, workbookStyles),
    [selectedSheet, workbookStyles],
  );
  const zoomScale = zoom / 100;
  const gridTheme = useMemo(
    () => ({
      ...defaultGridTheme,
      accentColor: "#0285FF",
      accentLight: "rgba(2, 133, 255, 0)",
      fontFamily: defaultGridTheme.fontFamily,
      headerFontStyle: defaultGridTheme.headerFontStyle,
    }),
    [],
  );
  const imageUrlsKey = useMemo(
    () =>
      gridData.drawingObjects
        .map(drawingImageUrl)
        .filter(Boolean)
        .sort()
        .join("|"),
    [gridData],
  );
  const sheetsKey = useMemo(
    () => sheets.map((sheet: any, index: number) => sheetStateKey(sheet, index)).join("\u0000"),
    [sheets],
  );
  const workbookTitle = getWorkbookTitle(workbook, title);
  const formulaBarValue = selectedCell ? getFormulaBarText(selectedCell) : formulaValue;
  const selectionLabel = getSelectionLabel(gridSelection, gridData, selectedRange);
  const canDownload = Boolean(
    workbook && (downloadUrl || downloadFile || typeof onDownload === "function" || allowJsonDownloadFallback),
  );
  const highlightRegions = useMemo(
    () => selectionFillRegions(gridSelection),
    [gridSelection],
  );

  const handleDownload = useCallback(() => {
    if (downloadUrl) {
      downloadWorkbookUrl(downloadUrl, downloadFileName ?? workbookTitle);
      return;
    }

    if (downloadFile) {
      downloadWorkbookFile(downloadFile, downloadFileName ?? workbookTitle, downloadMime);
      return;
    }

    if (typeof onDownload === "function") {
      onDownload({
        selectedSheet,
        selectedSheetIndex,
        title: workbookTitle,
        workbook,
      });
      return;
    }

    if (!allowJsonDownloadFallback) {
      return;
    }

    downloadWorkbookJson(workbook, workbookTitle);
  }, [
    allowJsonDownloadFallback,
    downloadFile,
    downloadFileName,
    downloadMime,
    downloadUrl,
    onDownload,
    selectedSheet,
    selectedSheetIndex,
    workbook,
    workbookTitle,
  ]);

  useEffect(() => {
    try {
      window.localStorage.setItem(workbookZoomStorageKey, String(zoom));
    } catch {
      // Ignore storage failures; zoom still works for the current session.
    }
  }, [zoom]);

  useEffect(() => {
    if (sheets.length === 0) {
      activeSheetKeyRef.current = null;
      setSelectedSheetIndex(0);
      return;
    }

    const previousKey = activeSheetKeyRef.current;
    const previousIndex = selectedSheetIndexRef.current;
    const preservedIndex = previousKey === null
      ? -1
      : sheets.findIndex((sheet: any, index: number) => sheetStateKey(sheet, index) === previousKey);
    const nextIndex = previousKey === null
      ? resolveSheetIndexFromHash(sheets)
      : preservedIndex !== -1
        ? preservedIndex
        : Math.min(previousIndex, sheets.length - 1);
    const sheet = sheets[nextIndex];

    activeSheetKeyRef.current = sheetStateKey(sheet, nextIndex);
    skipNextSheetHashWriteRef.current = true;
    setSelectedSheetIndex(nextIndex);

    if (sheet !== undefined) {
      writeHashParam(sheetHashParam, sheetHashName(sheet, nextIndex));
    }
  }, [sheets, sheetsKey]);

  useEffect(() => {
    if (skipNextSheetHashWriteRef.current) {
      skipNextSheetHashWriteRef.current = false;
      return;
    }

    if (selectedSheet === undefined) {
      return;
    }

    activeSheetKeyRef.current = sheetStateKey(selectedSheet, selectedSheetIndex);
    writeHashParam(sheetHashParam, sheetHashName(selectedSheet, selectedSheetIndex));
  }, [selectedSheet, selectedSheetIndex]);

  useEffect(() => {
    const urls = imageUrlsKey ? imageUrlsKey.split("|").filter(Boolean) : [];

    for (const url of urls) {
      if (imageLoadRef.current.has(url)) continue;
      imageLoadRef.current.add(url);
      setImageCache((current) => ({ ...current, [url]: { status: "loading" } }));

      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => {
        setImageCache((current) => ({
          ...current,
          [url]: { image, status: "loaded" },
        }));
      };
      image.onerror = () => {
        setImageCache((current) => ({ ...current, [url]: { status: "error" } }));
      };
      image.src = url;
    }
  }, [imageUrlsKey]);

  useEffect(() => {
    if (!workbook) {
      return;
    }

    const urls = imageUrlsKey ? imageUrlsKey.split("|").filter(Boolean) : [];
    const imagesSettled = urls.every((url: string) => {
      const status = imageCache[url]?.status;
      return status === "loaded" || status === "error";
    });

    if (!imagesSettled) {
      return;
    }

    const frame = window.requestAnimationFrame(() => onReadyRef.current?.());
    return () => window.cancelAnimationFrame(frame);
  }, [workbook, sheets.length, imageUrlsKey, imageCache]);

  const updateSelectedCellFromSelection = useCallback(
    (selection: any) => {
      const current = selection?.current;
      const activeCell = current?.cell;
      const range = current?.range;
      const col = activeCell?.[0] ?? Math.max(1, range?.x ?? 1);
      const row = activeCell?.[1] ?? range?.y ?? 0;

      if (col === 0) {
        setSelectedCell(null);
        return;
      }

      setSelectedCell(selectedCellFromDetails(gridData.getCellMeta(col, row)));
    },
    [gridData],
  );

  useEffect(() => {
    const restoredSelection = restoreSelectionSnapshot(selectionSnapshotRef.current, gridData);

    if (restoredSelection !== null) {
      setGridSelection(restoredSelection);
      updateSelectedCellFromSelection(restoredSelection);
    } else {
      setSelectedCell(null);
      setGridSelection(createEmptyGridSelection());
    }

    const visibleAddress = visibleAddressRef.current;
    const visiblePosition = gridData.getCellPosition(visibleAddress);

    if (visiblePosition !== null) {
      const frame = window.requestAnimationFrame(() => {
        dataEditorRef.current?.scrollTo(visiblePosition[0], visiblePosition[1]);
      });
      return () => window.cancelAnimationFrame(frame);
    }

    return undefined;
  }, [gridData, updateSelectedCellFromSelection]);

  const handleGridSelectionChange = useCallback(
    (newSelection: any) => {
      selectionSnapshotRef.current = captureSelectionSnapshot(newSelection, gridData);
      setGridSelection(newSelection);
      updateSelectedCellFromSelection(newSelection);
    },
    [gridData, updateSelectedCellFromSelection],
  );

  const handleCellClicked = useCallback(
    (item: readonly [number, number]) => {
      const [col, row] = item;
      if (col === 0) {
        setSelectedCell(null);
        return;
      }
      setSelectedCell(selectedCellFromDetails(gridData.getCellMeta(col, row)));
    },
    [gridData],
  );

  const handleVisibleRegionChanged = useCallback(
    (region: any, tx = 0, ty = 0) => {
      visibleAddressRef.current = gridData.getCellMeta(Math.max(1, region?.x ?? 1), Math.max(0, region?.y ?? 0))?.address ?? null;
      setVisibleRegion({ ...region, tx, ty });
    },
    [gridData],
  );

  useEffect(() => {
    if (workbookChange === undefined || workbookChange.version === workbookChangeVersionRef.current) {
      return;
    }

    workbookChangeVersionRef.current = workbookChange.version;

    if (workbookChange.type !== "patch" || workbookChange.changedCells === undefined) {
      return;
    }

    const selectedSheetKey = selectedSheet === undefined
      ? null
      : sheetStateKey(selectedSheet, selectedSheetIndex);
    const activeChange = workbookChange.changedCells.find(
      (change) => change.sheetKey === selectedSheetKey || change.sheetIndex === selectedSheetIndex,
    );

    if (activeChange === undefined) {
      return;
    }

    const changedCells = activeChange.addresses
      .map((address) => gridData.getCellPosition(address))
      .filter((cell): cell is readonly [number, number] => cell !== null)
      .map((cell) => ({ cell }));

    if (changedCells.length > 0) {
      dataEditorRef.current?.updateCells(changedCells);
    }
  }, [gridData, selectedSheet, selectedSheetIndex, workbookChange]);

  const drawCell = useCallback(
    (args: any, drawContent: () => void) => {
      const details = gridData.getCellMeta(args.col, args.row);

      drawContent();

      if (!details || details.isRowHeader) return;

      drawTextDecoration(args.ctx, args.rect, details, args.theme);

      const border = details.presentation.border;
      args.ctx.save();
      drawBorderLine(args.ctx, args.rect, "top", border.top);
      drawBorderLine(args.ctx, args.rect, "right", border.right);
      drawBorderLine(args.ctx, args.rect, "bottom", border.bottom);
      drawBorderLine(args.ctx, args.rect, "left", border.left);
      args.ctx.restore();

      drawTableOutline(args.ctx, args.rect, details.table);
      drawSelectionOutline(args.ctx, args.rect, args.col, args.row, gridSelection);

      // Inline drawings (charts/images) painted into individual cells.
      // Kept identical to upstream: the per-tile renderer ensures charts
      // and images line up with the cell grid underneath them.
      if (details.drawings?.length) {
        drawDrawingOverlays(args.ctx, args.rect, details.drawings, args.theme, imageCache);
      }
    },
    [gridData, gridSelection, imageCache],
  );

  return (
    <section
      aria-label="Web workbook"
      className="web-workbook"
      style={
        {
          "--web-workbook-dark-bg": darkBgColor,
          "--web-workbook-icon-hover-bg":
            iconButtonHoverStyle.backgroundColor || iconButtonHoverStyle.background,
          "--web-workbook-icon-hover-color": iconButtonHoverStyle.color,
          "--web-workbook-light-bg": lightBgColor,
        } as CSSProperties
      }
    >
      <header className="web-workbook-header">
        <div className="web-workbook-header-group web-workbook-header-group-left">
          <button
            aria-label="Reload preview"
            title="Reload preview"
            className="web-workbook-icon-button"
            onClick={reloadWorkbookPreview}
            style={iconButtonStyle}
            type="button"
          >
            <HugeiconsIcon
              icon={Refresh01Icon}
              size={16}
              color="currentColor"
              strokeWidth={2}
            />
          </button>
        </div>

        <div className="web-workbook-header-group web-workbook-header-group-right" aria-label="Workbook controls">
          <WorkbookZoomPicker zoom={zoom} onZoom={(nextZoom) => setZoom(clamp(nextZoom, 50, 200))} />

          <button
            aria-label="Download workbook"
            className="web-workbook-icon-button"
            disabled={!canDownload}
            onClick={handleDownload}
            style={iconButtonStyle}
            type="button"
          >
            <HugeiconsIcon
              icon={Download01Icon}
              size={17}
              color="currentColor"
              strokeWidth={1.8}
            />
          </button>
        </div>
      </header>

      <div className="web-workbook-formula-bar" aria-label="Formula bar">
        <div className="web-workbook-selection" title={selectionLabel}>
          {selectionLabel}
        </div>
        <div className="web-workbook-function-icon" aria-hidden="true">
          <HugeiconsIcon
            icon={FunctionOfXIcon}
            size={16}
            color="currentColor"
            strokeWidth={1.7}
          />
        </div>
        <div className="web-workbook-formula-value" title={formulaBarValue}>
          {formulaBarValue}
        </div>
      </div>

      <div className="web-workbook-body">
        {sheets.length > 0 ? (
          <div
            className="web-workbook-grid-shell"
            data-testid="web-workbook-grid"
            style={{ zoom: zoomScale } as CSSProperties}
          >
            <DataEditor
              columns={gridData.columns}
              ref={dataEditorRef}
              drawFocusRing={false}
              drawCell={drawCell}
              freezeColumns={1}
              getCellContent={gridData.getCellContent}
              getCellsForSelection
              gridSelection={gridSelection}
              headerHeight={32}
              height="100%"
              highlightRegions={highlightRegions}
              key={`${selectedSheet?.id}-${selectedSheet?.name}`}
              onCellClicked={handleCellClicked}
              onGridSelectionChange={handleGridSelectionChange}
              onVisibleRegionChanged={handleVisibleRegionChanged}
              rowHeight={(row: number) => gridData.rows[row]?.height || 32}
              rowMarkers="none"
              rows={gridData.rows.length}
              smoothScrollX
              smoothScrollY
              spanRangeBehavior="allowPartial"
              theme={gridTheme}
              width="100%"
            />
            <DrawingOverlay
              gridData={gridData}
              imageCache={imageCache}
              theme={gridTheme}
              visibleRegion={visibleRegion}
            />
          </div>
        ) : null}
      </div>

      <footer className="web-workbook-footer" aria-label="Workbook sheets">
        <div className="web-workbook-footer-label">Sheets</div>
        <div className="web-workbook-sheet-strip">
          {sheets.map((sheet: any, index: number) => (
            <button
              className={index === selectedSheetIndex ? "active" : ""}
              key={`${sheet.id || index}-${sheet.name || "sheet"}`}
              onClick={() => {
                activeSheetKeyRef.current = sheetStateKey(sheet, index);
                selectionSnapshotRef.current = null;
                visibleAddressRef.current = null;
                setVisibleRegion(null);
                setSelectedSheetIndex(index);
              }}
              title={sheet.name || `Sheet ${index + 1}`}
              type="button"
            >
              {sheet.name || `Sheet ${index + 1}`}
            </button>
          ))}
        </div>
      </footer>
    </section>
  );
}
