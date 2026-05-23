import { HugeiconsIcon } from "@hugeicons/react";
import { MinusSignIcon, PlusSignIcon } from "@hugeicons/core-free-icons";

import { IconButton } from "./IconButton";

/**
 * Zoom utilities shared by the document-oriented viewers (markdown / html).
 * The ladder mirrors browser-page-zoom expectations — quarter-step
 * granularity, 100 % as the anchor, bounded to 0.5×–3× so the controls
 * always disable cleanly at the ends of a familiar range. The image
 * viewer keeps its own wider envelope (0.1–8×) for pixel-level inspection,
 * which is why we don't share with it.
 */

export const MIN_DOCUMENT_ZOOM = 0.5;
export const MAX_DOCUMENT_ZOOM = 3.0;
const PRESETS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0] as const;

/** Clamp + sanitize the value so an out-of-range or non-finite input never
 *  reaches the rendering math. The `Math.round(... * 100) / 100` normalizes
 *  away floating-point noise that creeps in across repeated steps. */
export function clampDocumentZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  const clamped = Math.max(MIN_DOCUMENT_ZOOM, Math.min(MAX_DOCUMENT_ZOOM, value));
  return Math.round(clamped * 100) / 100;
}

/** Largest preset strictly less than `current`. Epsilon nudges the
 *  comparison so a tiny FP residue doesn't park the zoom "in between"
 *  presets where the buttons would step in the wrong direction. */
export function getPreviousDocumentZoom(current: number): number {
  for (let i = PRESETS.length - 1; i >= 0; i--) {
    if (PRESETS[i] < current - 1e-3) return PRESETS[i];
  }
  return MIN_DOCUMENT_ZOOM;
}

/** Smallest preset strictly greater than `current`. */
export function getNextDocumentZoom(current: number): number {
  for (const p of PRESETS) {
    if (p > current + 1e-3) return p;
  }
  return MAX_DOCUMENT_ZOOM;
}

interface DocumentZoomControlsProps {
  /** Current zoom — `1.0` reads as 100 %. */
  zoom: number;
  /** Called with the *next* clamped value. */
  onZoom: (next: number) => void;
  /**
   * True when the viewer hasn't reached the ready state, or the zoom
   * surface (preview/iframe) isn't currently visible. Drives both buttons
   * and the badge to look inert so the user gets a clear "this is
   * unavailable" cue rather than feedback that looks broken.
   */
  disabled?: boolean;
}

/**
 * Minus / "100 %" badge / plus cluster. Identical visual language to the
 * image viewer's zoom cluster — tabular numerals keep the badge from
 * twitching as digits change; buttons disable at the bounds.
 */
export function DocumentZoomControls({
  zoom,
  onZoom,
  disabled = false,
}: DocumentZoomControlsProps) {
  const percent = Math.round(zoom * 100);
  const canZoomOut = !disabled && zoom > MIN_DOCUMENT_ZOOM + 1e-3;
  const canZoomIn = !disabled && zoom < MAX_DOCUMENT_ZOOM - 1e-3;

  return (
    <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 2 }}>
      <IconButton
        aria-label="Zoom out"
        disabled={!canZoomOut}
        onClick={() => onZoom(getPreviousDocumentZoom(zoom))}
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
          opacity: disabled ? 0.55 : 0.85,
        }}
        aria-live="polite"
        aria-atomic="true"
      >
        {percent}%
      </span>

      <IconButton
        aria-label="Zoom in"
        disabled={!canZoomIn}
        onClick={() => onZoom(getNextDocumentZoom(zoom))}
      >
        <HugeiconsIcon icon={PlusSignIcon} size={16} strokeWidth={2} />
      </IconButton>
    </div>
  );
}
