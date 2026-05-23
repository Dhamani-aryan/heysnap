import type { CSSProperties, ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Download01Icon, MinusSignIcon, PlusSignIcon } from "@hugeicons/core-free-icons";

import { IconButton } from "../../_internal/IconButton";
import type { ResolvedDocxSource } from "./useResolvedDocxSource";

// Familiar zoom ladder — mirrors the image/XLSX viewers so the docx
// viewer feels like part of the same family. Bounds are kept identical
// to the previous (@eigenpal-driven) implementation so consumers don't
// see the zoom UX shift between versions.
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4.0;
const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0] as const;

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

/** Largest preset strictly less than `current`. */
export function getPreviousZoomPreset(current: number): number {
  for (let i = ZOOM_PRESETS.length - 1; i >= 0; i--) {
    if (ZOOM_PRESETS[i] < current - 1e-3) return ZOOM_PRESETS[i];
  }
  return MIN_ZOOM;
}

/** Smallest preset strictly greater than `current`. */
export function getNextZoomPreset(current: number): number {
  for (const p of ZOOM_PRESETS) {
    if (p > current + 1e-3) return p;
  }
  return MAX_ZOOM;
}

interface HeaderShellProps {
  background: string;
  foreground: string;
  /** Escape-hatch styles merged on top of the default chrome. */
  style?: CSSProperties;
  children?: ReactNode;
}

const headerBaseStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  // 28px between functional clusters (filename / zoom / download) — same
  // rhythm as the PDF header so the two viewers feel like a family.
  gap: 28,
  height: 40,
  flexShrink: 0,
  padding: "0 8px",
  // Single hairline under the bar. `currentColor` follows `foreground`.
  boxShadow: "inset 0 -1px 0 color-mix(in srgb, currentColor 10%, transparent)",
};

/**
 * Stateless visual shell. Renders before the document has loaded so the
 * chrome is identical across loading / error / ready states.
 */
export function DocxHeaderShell({ background, foreground, style, children }: HeaderShellProps) {
  return (
    <header style={{ ...headerBaseStyle, background, color: foreground, ...style }}>
      {children}
    </header>
  );
}

interface DocxHeaderTitleProps {
  title: string;
  /** Style merged onto the filename span. */
  titleStyle?: CSSProperties;
}

const defaultTitleStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  letterSpacing: "-0.005em",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  opacity: 0.92,
  // `paddingLeft: 6` keeps the title visually away from the toolbar's left
  // edge by roughly the same gap an icon button would have provided.
  paddingLeft: 6,
};

/**
 * Filename label rendered on the left of the toolbar.
 */
export function DocxHeaderTitle({ title, titleStyle }: DocxHeaderTitleProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        minWidth: 0,
        flex: "0 1 auto",
      }}
    >
      <span title={title} style={{ ...defaultTitleStyle, ...titleStyle }}>
        {title}
      </span>
    </div>
  );
}

interface DocxZoomControlsProps {
  /** Current zoom (1.0 == 100 %). */
  zoom: number;
  /** Setter — already clamped by the parent. */
  onZoom: (next: number) => void;
}

/**
 * Zoom percentage + plus/minus controls. `docx-preview` has no native
 * zoom hook, so the parent applies a CSS `transform: scale()` against
 * the rendered `.docx-wrapper` based on this state.
 */
export function DocxZoomControls({ zoom, onZoom }: DocxZoomControlsProps) {
  const percent = Math.round(zoom * 100);
  const canZoomOut = zoom > MIN_ZOOM + 1e-3;
  const canZoomIn = zoom < MAX_ZOOM - 1e-3;

  return (
    <div
      style={{
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 2,
      }}
    >
      <IconButton
        aria-label="Zoom out"
        disabled={!canZoomOut}
        onClick={() => onZoom(getPreviousZoomPreset(zoom))}
      >
        <HugeiconsIcon icon={MinusSignIcon} size={16} strokeWidth={2} />
      </IconButton>

      <span
        // Tabular numerals keep the toolbar from twitching as digits change.
        style={{
          minWidth: 48,
          textAlign: "center",
          fontSize: 12,
          fontFamily: "inherit",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "0.01em",
          userSelect: "none",
          opacity: 0.85,
        }}
        aria-live="polite"
        aria-atomic="true"
      >
        {percent}%
      </span>

      <IconButton
        aria-label="Zoom in"
        disabled={!canZoomIn}
        onClick={() => onZoom(getNextZoomPreset(zoom))}
      >
        <HugeiconsIcon icon={PlusSignIcon} size={16} strokeWidth={2} />
      </IconButton>
    </div>
  );
}

interface DocxDownloadButtonProps {
  resolved: ResolvedDocxSource;
}

/**
 * Downloads the original DOCX buffer (the same bytes we handed the
 * renderer). The viewer is read-only, so the buffer is bit-identical to
 * what the consumer passed in.
 */
export function DocxDownloadButton({ resolved }: DocxDownloadButtonProps) {
  return (
    <IconButton aria-label="Download" onClick={() => downloadDocx(resolved)}>
      <HugeiconsIcon icon={Download01Icon} size={17} strokeWidth={1.8} />
    </IconButton>
  );
}

function downloadDocx(resolved: ResolvedDocxSource) {
  const blob = new Blob([resolved.buffer], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = resolved.name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next macrotask — Safari needs the URL alive for the
  // click to be honored, but we don't want to leak it for the session.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
