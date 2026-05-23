import type { CSSProperties, ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Download01Icon, MinusSignIcon, PlusSignIcon } from "@hugeicons/core-free-icons";

import { IconButton } from "../../_internal/IconButton";
import type { ResolvedAudioSource } from "./useResolvedAudioSource";

export const MIN_AUDIO_ZOOM = 0.5;
export const MAX_AUDIO_ZOOM = 2.0;
const AUDIO_ZOOM_PRESETS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0] as const;

export function clampAudioZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.max(MIN_AUDIO_ZOOM, Math.min(MAX_AUDIO_ZOOM, z));
}

function getPreviousZoomPreset(current: number): number {
  for (let i = AUDIO_ZOOM_PRESETS.length - 1; i >= 0; i--) {
    if (AUDIO_ZOOM_PRESETS[i] < current - 1e-3) return AUDIO_ZOOM_PRESETS[i];
  }
  return MIN_AUDIO_ZOOM;
}

function getNextZoomPreset(current: number): number {
  for (const p of AUDIO_ZOOM_PRESETS) {
    if (p > current + 1e-3) return p;
  }
  return MAX_AUDIO_ZOOM;
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
  // image / video / PDF / DOCX / XLSX headers — one toolbar idiom.
  gap: 28,
  height: 40,
  flexShrink: 0,
  padding: "0 8px",
  // Single hairline under the bar. `currentColor` follows `foreground`.
  boxShadow: "inset 0 -1px 0 color-mix(in srgb, currentColor 10%, transparent)",
};

/**
 * Stateless visual shell. Renders before the audio has loaded so the
 * chrome is identical across loading / error / ready states.
 */
export function AudioHeaderShell({ background, foreground, style, children }: HeaderShellProps) {
  return (
    <header style={{ ...headerBaseStyle, background, color: foreground, ...style }}>
      {children}
    </header>
  );
}

interface AudioTitleProps {
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
  paddingLeft: 6,
};

/**
 * Title on the left side of the toolbar. The truncation only fires when the
 * outer flex slot allows shrinking — `minWidth: 0` + `flex: 0 1 auto` on the
 * wrapper provides that.
 */
export function AudioTitle({ name, style }: AudioTitleProps) {
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

interface AudioZoomControlsProps {
  zoom: number;
  onZoom: (next: number) => void;
  disabled?: boolean;
}

export function AudioZoomControls({ zoom, onZoom, disabled = false }: AudioZoomControlsProps) {
  const percent = Math.round(zoom * 100);
  const canZoomOut = !disabled && zoom > MIN_AUDIO_ZOOM + 1e-3;
  const canZoomIn = !disabled && zoom < MAX_AUDIO_ZOOM - 1e-3;

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

interface AudioDownloadButtonProps {
  resolved: ResolvedAudioSource;
}

/**
 * Downloads the displayed audio. Object-URL sources (File / Blob / buffer)
 * are written straight back to disk under their resolved name; remote URLs
 * are handed to the browser's native download attribute. The `download` hint
 * is best-effort on cross-origin URLs — that's a server-side limitation we
 * can't paper over.
 */
export function AudioDownloadButton({ resolved }: AudioDownloadButtonProps) {
  return (
    <IconButton aria-label="Download" onClick={() => downloadAudio(resolved)}>
      <HugeiconsIcon icon={Download01Icon} size={17} strokeWidth={1.8} />
    </IconButton>
  );
}

function downloadAudio(resolved: ResolvedAudioSource) {
  const a = document.createElement("a");
  a.href = resolved.url;
  a.download = resolved.name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
