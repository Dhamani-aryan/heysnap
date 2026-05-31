import type { CSSProperties, ReactNode } from "react";

import { Download01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { IconButton } from "../../_internal/IconButton";
import {
  ViewerHeaderGroup,
  ViewerHeaderShell,
  ViewerReloadButton,
} from "../../_internal/ViewerToolbar";
import type { ResolvedCsvSource } from "./useResolvedCsvSource";

interface HeaderShellProps {
  readonly background: string;
  readonly foreground: string;
  readonly style?: CSSProperties;
  readonly children?: ReactNode;
}

export function CsvHeaderShell({ background, foreground, style, children }: HeaderShellProps) {
  return (
    <ViewerHeaderShell background={background} foreground={foreground} style={style}>
      {children}
    </ViewerHeaderShell>
  );
}

export const CsvHeaderGroup = ViewerHeaderGroup;
export const CsvReloadButton = ViewerReloadButton;

export function CsvStatusBadge({
  columns,
  delimiter,
  rows,
  warning,
}: {
  readonly columns: number;
  readonly delimiter: string;
  readonly rows: number;
  readonly warning?: string;
}) {
  const title = [
    `${formatCount(rows, "row")}, ${formatCount(columns, "column")}`,
    `Delimiter: ${formatDelimiter(delimiter)}`,
    warning ? `Parser warning: ${warning}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <span
      title={title}
      style={{
        alignItems: "center",
        display: "inline-flex",
        flexShrink: 0,
        fontSize: 12,
        fontVariantNumeric: "tabular-nums",
        height: 28,
        opacity: warning ? 0.95 : 0.78,
        padding: "0 8px",
        whiteSpace: "nowrap",
      }}
    >
      {formatCount(rows, "row")} x {formatCount(columns, "column")}
    </span>
  );
}

export function CsvDownloadButton({ resolved }: { readonly resolved: ResolvedCsvSource }) {
  return (
    <IconButton aria-label="Download" title="Download" onClick={() => downloadCsv(resolved)}>
      <HugeiconsIcon icon={Download01Icon} size={17} strokeWidth={1.8} />
    </IconButton>
  );
}

function downloadCsv(resolved: ResolvedCsvSource) {
  const mime = resolved.mime.includes(";") ? resolved.mime : `${resolved.mime};charset=utf-8`;
  const blob = new Blob([resolved.text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = resolved.name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatCount(value: number, singular: string): string {
  const label = value === 1 ? singular : `${singular}s`;
  return `${value.toLocaleString()} ${label}`;
}

function formatDelimiter(delimiter: string): string {
  if (delimiter === "\t") return "tab";
  if (delimiter === "") return "auto";
  return delimiter;
}
