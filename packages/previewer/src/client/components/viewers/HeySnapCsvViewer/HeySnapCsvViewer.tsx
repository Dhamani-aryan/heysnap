import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import {
  CompactSelection,
  DataEditor,
  GridCellKind,
  type GridCell,
  type GridColumn,
  type GridSelection,
  type Item,
  type Theme,
} from "@glideapps/glide-data-grid";
import * as Papa from "papaparse";

import "@glideapps/glide-data-grid/dist/index.css";

import type { BaseViewerProps } from "../../types";
import {
  CsvDownloadButton,
  CsvHeaderGroup,
  CsvHeaderShell,
  CsvReloadButton,
  CsvStatusBadge,
} from "./CsvViewerHeader";
import { useResolvedCsvSource, type HeySnapCsvSrc } from "./useResolvedCsvSource";
import "./csvViewer.css";

export type { HeySnapCsvSrc } from "./useResolvedCsvSource";

export type CsvDelimiter = "auto" | "," | ";" | "\t" | "|";

export interface HeySnapCsvViewerProps extends Omit<BaseViewerProps, "src"> {
  readonly src: HeySnapCsvSrc;
  /** Delimiter override. Defaults to auto-detect, with .tsv pinned to tabs. */
  readonly delimiter?: CsvDelimiter;

  readonly showHeader?: boolean;
  readonly headerBackground?: string;
  readonly headerForeground?: string;
  readonly headerStyle?: CSSProperties;
  readonly showDownloadButton?: boolean;

  readonly bodyBackground?: string;
  readonly bodyStyle?: CSSProperties;
  readonly colorScheme?: "dark" | "light";

  readonly documentName?: string;
  readonly loadingIndicator?: ReactNode;
  readonly onError?: (error: Error) => void;
}

type ParsedCsv = {
  readonly delimiter: string;
  readonly errors: readonly string[];
  readonly rows: readonly (readonly string[])[];
};

type CsvGridModel = {
  readonly columnCount: number;
  readonly columns: readonly GridColumn[];
  readonly rowStartIndex: number;
  readonly rows: readonly (readonly string[])[];
};

const rootClass = (extra?: string) =>
  ["heysnap-viewer", "heysnap-viewer--csv", extra].filter(Boolean).join(" ");

const baseStyle: CSSProperties = {
  position: "relative",
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  width: "100%",
  height: "100%",
};

const DEFAULTS = {
  bodyBackground: "#ffffff",
  colorScheme: "light" as const,
  delimiter: "auto" as CsvDelimiter,
  headerBackground: "#ffffff",
  headerForeground: "#15171c",
} as const;

const EMPTY_SELECTION: GridSelection = {
  columns: CompactSelection.empty(),
  rows: CompactSelection.empty(),
};

const LIGHT_GRID_THEME: Partial<Theme> = {
  accentColor: "#0285ff",
  accentFg: "#ffffff",
  accentLight: "rgba(2, 133, 255, 0.12)",
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

const DARK_GRID_THEME: Partial<Theme> = {
  ...LIGHT_GRID_THEME,
  accentColor: "#64b5ff",
  accentFg: "#07111d",
  accentLight: "rgba(100, 181, 255, 0.18)",
  bgCell: "#0f0f11",
  bgHeader: "#161b22",
  borderColor: "#252a34",
  textDark: "#f4f6fb",
  textHeader: "#aeb6c4",
  textMedium: "#9aa3b2",
};

export function HeySnapCsvViewer({
  src,
  className,
  style,

  delimiter = DEFAULTS.delimiter,

  showHeader = true,
  headerBackground = DEFAULTS.headerBackground,
  headerForeground = DEFAULTS.headerForeground,
  headerStyle,
  showDownloadButton = true,

  bodyBackground = DEFAULTS.bodyBackground,
  bodyStyle,
  colorScheme = DEFAULTS.colorScheme,

  documentName,
  loadingIndicator,
  onReady,
  onError,
}: HeySnapCsvViewerProps) {
  const { resolved, error: resolveError, version } = useResolvedCsvSource(src);
  const resolvedName = documentName ?? resolved?.name ?? "data.csv";
  const parsedState = useMemo(() => {
    if (resolved === null) {
      return { parsed: null, error: null };
    }

    try {
      return {
        parsed: parseCsvText(resolved.text, delimiter, resolvedName),
        error: null,
      };
    } catch (err) {
      return {
        parsed: null,
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }, [delimiter, resolved, resolvedName]);
  const downloadSource = resolved === null ? null : { ...resolved, name: resolvedName };

  const error = resolveError ?? parsedState.error;
  const parsed = parsedState.parsed;
  const onErrorRef = useRef(onError);
  const onReadyRef = useRef(onReady);
  const readyVersionRef = useRef<number | null>(null);
  onErrorRef.current = onError;
  onReadyRef.current = onReady;

  useEffect(() => {
    if (error) onErrorRef.current?.(error);
  }, [error]);

  const gridModel = useMemo(
    () => createCsvGridModel(parsed?.rows ?? []),
    [parsed],
  );
  const [gridSelection, setGridSelection] = useState<GridSelection>(EMPTY_SELECTION);

  useEffect(() => {
    setGridSelection(EMPTY_SELECTION);
  }, [version]);

  useEffect(() => {
    if (error || parsed === null || readyVersionRef.current === version) {
      return;
    }

    readyVersionRef.current = version;
    const frame = window.requestAnimationFrame(() => onReadyRef.current?.());
    return () => window.cancelAnimationFrame(frame);
  }, [error, parsed, version]);

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const value = gridModel.rows[row]?.[col] ?? "";

      return {
        allowOverlay: true,
        contentAlign: isNumericLike(value) ? "right" : "left",
        copyData: value,
        data: value,
        displayData: value,
        kind: GridCellKind.Text,
        readonly: true,
      };
    },
    [gridModel.rows],
  );

  const selectedCell = useMemo(
    () => getSelectedCellInfo(gridSelection, gridModel) ?? getInitialCellInfo(gridModel),
    [gridModel, gridSelection],
  );
  const gridTheme = colorScheme === "dark" ? DARK_GRID_THEME : LIGHT_GRID_THEME;
  const parseWarning = parsed?.errors[0];
  const state: "loading" | "error" | "ready" =
    error !== null ? "error" : parsed === null ? "loading" : "ready";
  const reloadPreview = () => window.location.reload();

  const renderShell = (body: ReactNode) => (
    <div
      className={rootClass(className)}
      data-format="csv"
      {...(typeof src === "string" ? { "data-src": src } : {})}
      data-state={state}
      style={
        {
          ...baseStyle,
          "--heysnap-csv-bar-bg": headerBackground,
          "--heysnap-csv-body-bg": bodyBackground,
          "--heysnap-csv-text": headerForeground,
          ...style,
        } as CSSProperties
      }
    >
      {showHeader && (
        <CsvHeaderShell
          background={headerBackground}
          foreground={headerForeground}
          style={headerStyle}
        >
          <CsvHeaderGroup align="left">
            <CsvReloadButton onReload={reloadPreview} />
          </CsvHeaderGroup>
          <CsvHeaderGroup align="right">
            {parsed !== null && (
              <CsvStatusBadge
                rows={gridModel.rows.length}
                columns={gridModel.columnCount}
                delimiter={parsed.delimiter}
                warning={parseWarning}
              />
            )}
            {showDownloadButton && downloadSource && <CsvDownloadButton resolved={downloadSource} />}
          </CsvHeaderGroup>
        </CsvHeaderShell>
      )}
      {body}
    </div>
  );

  if (error) {
    return renderShell(
      <p style={{ padding: 16, color: "#b00020" }}>Failed to load CSV: {error.message}</p>,
    );
  }

  if (parsed === null) {
    return renderShell(
      loadingIndicator ?? <p style={{ padding: 16, color: "#666" }}>Loading CSV...</p>,
    );
  }

  return renderShell(
    <>
      <div className="heysnap-csv-cell-bar" aria-label="Selected cell">
        <div className="heysnap-csv-cell-address">{selectedCell?.address ?? ""}</div>
        <div className="heysnap-csv-cell-value" title={selectedCell?.value ?? ""}>
          {selectedCell?.value ?? ""}
        </div>
      </div>
      <div className="heysnap-csv-body" style={bodyStyle}>
        {gridModel.columnCount === 0 ? (
          <div className="heysnap-csv-empty">Empty CSV</div>
        ) : (
          <DataEditor
            className="heysnap-csv-grid"
            columns={gridModel.columns}
            drawFocusRing={false}
            freezeColumns={0}
            getCellContent={getCellContent}
            getCellsForSelection
            gridSelection={gridSelection}
            headerHeight={32}
            height="100%"
            onGridSelectionChange={setGridSelection}
            rowHeight={32}
            rowMarkers={{
              kind: "number",
              startIndex: gridModel.rowStartIndex,
              width: rowMarkerWidth(gridModel.rowStartIndex + gridModel.rows.length - 1),
            }}
            rows={gridModel.rows.length}
            smoothScrollX
            smoothScrollY
            theme={gridTheme}
            width="100%"
          />
        )}
      </div>
    </>,
  );
}

function parseCsvText(text: string, delimiter: CsvDelimiter, name: string): ParsedCsv {
  const requestedDelimiter = delimiter === "auto" ? delimiterFromName(name) : delimiter;
  const result = Papa.parse<string[]>(stripByteOrderMark(text), {
    ...(requestedDelimiter === undefined ? {} : { delimiter: requestedDelimiter }),
    skipEmptyLines: false,
  });

  return {
    delimiter: result.meta.delimiter || requestedDelimiter || "",
    errors: result.errors.map((error) => error.message),
    rows: trimTrailingEmptyRows(
      result.data.map((row) => row.map((cell) => (cell == null ? "" : String(cell)))),
    ),
  };
}

function stripByteOrderMark(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function delimiterFromName(name: string): "\t" | undefined {
  return name.toLowerCase().endsWith(".tsv") ? "\t" : undefined;
}

function trimTrailingEmptyRows(rows: readonly (readonly string[])[]): readonly (readonly string[])[] {
  let end = rows.length;
  while (end > 0 && isEmptyRow(rows[end - 1] ?? [])) {
    end -= 1;
  }
  return rows.slice(0, end);
}

function isEmptyRow(row: readonly string[]): boolean {
  return row.every((cell) => cell.trim().length === 0);
}

function createCsvGridModel(rawRows: readonly (readonly string[])[]): CsvGridModel {
  const columnCount = maxColumnCount(rawRows);
  const headerRow = rawRows[0] ?? [];
  const rows = rawRows.slice(1);
  const columns = Array.from({ length: columnCount }, (_, index) => {
    const title = cleanHeaderTitle(headerRow[index], index);

    return {
      id: String(index),
      title,
      width: estimateColumnWidth(index, title, rows),
    } satisfies GridColumn;
  });

  return {
    columnCount,
    columns,
    rowStartIndex: 2,
    rows,
  };
}

function maxColumnCount(rows: readonly (readonly string[])[]): number {
  return rows.reduce((max, row) => Math.max(max, row.length), 0);
}

function cleanHeaderTitle(value: string | undefined, index: number): string {
  const trimmed = (value ?? "").trim().replace(/\s+/gu, " ");
  return trimmed.length > 0 ? trimmed : columnName(index);
}

function estimateColumnWidth(
  columnIndex: number,
  title: string,
  rows: readonly (readonly string[])[],
): number {
  const maxChars = rows.slice(0, 120).reduce((max, row) => {
    const value = row[columnIndex] ?? "";
    return Math.max(max, value.length);
  }, title.length);

  return Math.max(88, Math.min(360, Math.round(maxChars * 7.4 + 32)));
}

function columnName(index: number): string {
  let dividend = index + 1;
  let name = "";

  while (dividend > 0) {
    const modulo = (dividend - 1) % 26;
    name = String.fromCharCode(65 + modulo) + name;
    dividend = Math.floor((dividend - modulo) / 26);
  }

  return name;
}

function isNumericLike(value: string): boolean {
  const normalized = value.trim().replaceAll(",", "");
  return (
    normalized.length > 0 &&
    /^[-+]?(?:\d+|\d*\.\d+)(?:e[-+]?\d+)?%?$/iu.test(normalized)
  );
}

function getSelectedCellInfo(selection: GridSelection, gridModel: CsvGridModel) {
  const cell = selection.current?.cell;
  if (cell === undefined) {
    return null;
  }

  const [col, row] = cell;
  const value = gridModel.rows[row]?.[col] ?? "";

  return {
    address: `${columnName(col)}${String(row + gridModel.rowStartIndex)}`,
    value,
  };
}

function getInitialCellInfo(gridModel: CsvGridModel) {
  if (gridModel.columnCount === 0 || gridModel.rows.length === 0) {
    return null;
  }

  return {
    address: `${columnName(0)}${String(gridModel.rowStartIndex)}`,
    value: gridModel.rows[0]?.[0] ?? "",
  };
}

function rowMarkerWidth(maxRowNumber: number): number {
  const digits = String(Math.max(1, maxRowNumber)).length;
  return Math.max(46, Math.min(82, 24 + digits * 8));
}
