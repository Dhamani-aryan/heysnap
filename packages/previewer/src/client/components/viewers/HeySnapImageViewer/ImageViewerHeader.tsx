import type { CSSProperties, ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Download01Icon, MinusSignIcon, PlusSignIcon } from "@hugeicons/core-free-icons";

import { IconButton } from "../../_internal/IconButton";
import type { ResolvedImageSource } from "./useResolvedImageSource";

// Familiar zoom ladder — same shape as the XLSX viewer's so the three
// document-style viewers feel like a family. The bounds are slightly wider
// because images get inspected at high magnifications more often than
// spreadsheets do.
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8.0;
const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0, 6.0, 8.0] as const;

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

/** Largest preset strictly less than `current`. Tiny epsilon prevents the
 * UI from getting stuck at non-preset values picked by "fit to screen". */
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
  // 28 px between functional clusters keeps the rhythm consistent with the
  // PDF / DOCX / XLSX headers — three viewers, one toolbar idiom.
  gap: 28,
  height: 40,
  flexShrink: 0,
  padding: "0 8px",
  // Single hairline under the bar. `currentColor` follows `foreground`.
  boxShadow: "inset 0 -1px 0 color-mix(in srgb, currentColor 10%, transparent)",
};

/**
 * Stateless visual shell. Renders before the image has loaded so the
 * chrome is identical across loading / error / ready states.
 */
export function ImageHeaderShell({ background, foreground, style, children }: HeaderShellProps) {
  return (
    <header style={{ ...headerBaseStyle, background, color: foreground, ...style }}>
      {children}
    </header>
  );
}

interface ImageTitleProps {
  /** Filename / display name shown on the left side of the toolbar. */
  name: string;
  /** Styles merged onto the title span. */
  style?: CSSProperties;
}

const defaultTitleStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  letterSpacing: "-0.005em",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  opacity: 0.92,
  // Match the title indentation other viewers use when no leading icon
  // precedes it — keeps the text visually clear of the toolbar edge.
  paddingLeft: 6,
};

/**
 * Title on the left side of the toolbar. The truncation only fires when the
 * outer flex slot allows shrinking — `minWidth: 0` + `flex: 0 1 auto` on the
 * wrapper provides that.
 */
export function ImageTitle({ name, style }: ImageTitleProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        minWidth: 0,
        flex: "0 1 auto",
      }}
    >
      <span title={name} style={{ ...defaultTitleStyle, ...style }}>
        {name}
      </span>
    </div>
  );
}

interface ImageZoomControlsProps {
  /** Current zoom (1.0 == 100 %). */
  zoom: number;
  /** Called with the *next* clamped ratio. */
  onZoom: (next: number) => void;
  /** True when no image is mounted yet (loading / error states). */
  disabled?: boolean;
}

/**
 * Zoom cluster: minus / "100 %" badge / plus. Tabular numerals keep the
 * badge from twitching as digits change; buttons disable at the bounds so
 * the user gets a clear "this is the limit" signal.
 */
export function ImageZoomControls({ zoom, onZoom, disabled = false }: ImageZoomControlsProps) {
  const percent = Math.round(zoom * 100);
  const canZoomOut = !disabled && zoom > MIN_ZOOM + 1e-3;
  const canZoomIn = !disabled && zoom < MAX_ZOOM - 1e-3;

  return (
    <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 2 }}>
      <IconButton
        aria-label="Zoom out"
        disabled={!canZoomOut}
        onClick={() => onZoom(getPreviousZoomPreset(zoom))}
      >
        <HugeiconsIcon icon={MinusSignIcon} size={16} strokeWidth={2} />
      </IconButton>

      <span
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

interface ImageDownloadButtonProps {
  resolved: ResolvedImageSource;
}

/**
 * Downloads the displayed image. Object-URL sources (File / Blob / buffer)
 * are written straight back to disk under their resolved name; remote URLs
 * are handed to the browser's native download attribute. The `download` hint
 * is best-effort on cross-origin URLs — that's a server-side limitation we
 * can't paper over.
 */
export function ImageDownloadButton({ resolved }: ImageDownloadButtonProps) {
  return (
    <IconButton aria-label="Download" onClick={() => downloadImage(resolved)}>
      <HugeiconsIcon icon={Download01Icon} size={17} strokeWidth={1.8} />
    </IconButton>
  );
}

function downloadImage(resolved: ResolvedImageSource) {
  const a = document.createElement("a");
  a.href = resolved.url;
  a.download = resolved.name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
