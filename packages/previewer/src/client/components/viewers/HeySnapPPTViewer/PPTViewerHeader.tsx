import type { CSSProperties, ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Download01Icon,
  Menu01Icon,
  MinusSignIcon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";

import { IconButton } from "../../_internal/IconButton";
import {
  ViewerHeaderGroup,
  ViewerHeaderShell,
  ViewerReloadButton,
  ViewerValuePicker,
} from "../../_internal/ViewerToolbar";
import type { ResolvedPPTSource } from "./useResolvedPPTSource";

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 1.0;
const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1.0] as const;

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

export function getPreviousZoomPreset(current: number): number {
  for (let i = ZOOM_PRESETS.length - 1; i >= 0; i--) {
    if (ZOOM_PRESETS[i] < current - 1e-3) return ZOOM_PRESETS[i];
  }
  return MIN_ZOOM;
}

export function getNextZoomPreset(current: number): number {
  for (const p of ZOOM_PRESETS) {
    if (p > current + 1e-3) return p;
  }
  return MAX_ZOOM;
}

// ── Shell ───────────────────────────────────────────────────────────────
interface HeaderShellProps {
  background: string;
  foreground: string;
  style?: CSSProperties;
  children?: ReactNode;
}

const headerBaseStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  // 28 px between functional clusters — same rhythm as the PDF / DOCX /
  // XLSX headers so the four viewers feel like a family.
  gap: 28,
  height: 40,
  flexShrink: 0,
  padding: "0 8px",
  boxShadow: "inset 0 -1px 0 color-mix(in srgb, currentColor 10%, transparent)",
};

export function PPTHeaderShell({ background, foreground, style, children }: HeaderShellProps) {
  return (
    <ViewerHeaderShell background={background} foreground={foreground} style={style}>
      {children}
    </ViewerHeaderShell>
  );
}

export const PPTHeaderGroup = ViewerHeaderGroup;
export const PPTReloadButton = ViewerReloadButton;

// ── Left cluster: menu toggle + filename ────────────────────────────────
interface PPTHeaderLeftProps {
  /** Presentation filename. */
  title: string;
  /** Current sidebar open state — drives the icon's `aria-expanded`. */
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  /** Id of the sidebar `<aside>` — wires up `aria-controls`. */
  sidebarId: string;
  /** When false, the menu icon hides (sidebar is hidden by the parent too). */
  showSidebarToggle?: boolean;
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
  paddingLeft: 6,
};

export function PPTHeaderLeft({
  title,
  isSidebarOpen,
  onToggleSidebar,
  sidebarId,
  showSidebarToggle = true,
  titleStyle,
}: PPTHeaderLeftProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        // `minWidth: 0` lets the title ellipsis-truncate when the toolbar
        // is narrow; `flex: 0 1 auto` lets it shrink without growing.
        minWidth: 0,
        flex: "0 1 auto",
      }}
    >
      {showSidebarToggle && (
        <IconButton
          aria-label={isSidebarOpen ? "Hide slides" : "Show slides"}
          aria-expanded={isSidebarOpen}
          aria-controls={sidebarId}
          onClick={onToggleSidebar}
        >
          <HugeiconsIcon icon={Menu01Icon} size={16} strokeWidth={2} />
        </IconButton>
      )}

      <span title={title} style={{ ...defaultTitleStyle, ...titleStyle }}>
        {title}
      </span>
    </div>
  );
}

export function PPTSidebarButton({
  isSidebarOpen,
  onToggleSidebar,
  sidebarId,
}: Pick<PPTHeaderLeftProps, "isSidebarOpen" | "onToggleSidebar" | "sidebarId">) {
  return (
    <IconButton
      aria-label={isSidebarOpen ? "Hide slides" : "Show slides"}
      aria-expanded={isSidebarOpen}
      aria-controls={sidebarId}
      onClick={onToggleSidebar}
    >
      <HugeiconsIcon icon={Menu01Icon} size={16} strokeWidth={2} />
    </IconButton>
  );
}

// ── Zoom controls (identical visual to XLSX) ────────────────────────────
interface PPTZoomControlsProps {
  zoom: number;
  onZoom: (next: number) => void;
  disabled?: boolean;
}

export function PPTZoomControls({ zoom, onZoom, disabled = false }: PPTZoomControlsProps) {
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

export function PPTZoomPicker({
  background,
  disabled = false,
  foreground,
  onZoom,
  zoom,
}: PPTZoomControlsProps & {
  background: string;
  foreground: string;
}) {
  return (
    <ViewerValuePicker
      background={background}
      disabled={disabled}
      foreground={foreground}
      formatValue={(value) => `${String(Math.round(value * 100))}%`}
      label="Zoom level"
      onChange={(next) => onZoom(clampZoom(next))}
      options={ZOOM_PRESETS}
      value={zoom}
    />
  );
}

// ── Download button ─────────────────────────────────────────────────────
interface PPTDownloadButtonProps {
  resolved: ResolvedPPTSource;
}

/**
 * Downloads the original PPTX bytes (the same File we uploaded). Like the
 * XLSX viewer, we never round-trip through the server to download — the
 * original buffer is bit-identical to what the user picked.
 */
export function PPTDownloadButton({ resolved }: PPTDownloadButtonProps) {
  return (
    <IconButton aria-label="Download" title="Download" onClick={() => downloadPPTX(resolved)}>
      <HugeiconsIcon icon={Download01Icon} size={17} strokeWidth={1.8} />
    </IconButton>
  );
}

function downloadPPTX(resolved: ResolvedPPTSource) {
  const url = URL.createObjectURL(resolved.file);
  const a = document.createElement("a");
  a.href = url;
  a.download = resolved.name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next macrotask — Safari needs the URL alive for the click.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
