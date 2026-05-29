import type { CSSProperties, ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cursor01Icon,
  Download01Icon,
  HandGrabIcon,
  Menu01Icon,
  MinusSignIcon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { useZoom } from "@embedpdf/plugin-zoom/react";
import { usePan } from "@embedpdf/plugin-pan/react";

import { IconButton } from "../../_internal/IconButton";
import {
  ViewerHeaderGroup,
  ViewerHeaderShell,
  ViewerReloadButton,
  ViewerValuePicker,
} from "../../_internal/ViewerToolbar";
import type { ResolvedPdfSource } from "./useResolvedPdfSource";

/** Match the zoom plugin defaults so the buttons disable at the real bounds. */
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 60;
const PDF_ZOOM_PRESETS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0] as const;

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
  // 28px between functional clusters (filename / tools / zoom / download).
  // Generous spacing reads as "these are distinct toolsets" rather than
  // "these are related controls." Override via `headerStyle.gap`.
  gap: 28,
  height: 40,
  flexShrink: 0,
  padding: "0 8px",
  // A single hairline under the bar gives the chrome definition without
  // adding a heavy border. Adapts to the configured foreground.
  boxShadow: "inset 0 -1px 0 color-mix(in srgb, currentColor 10%, transparent)",
};

/**
 * Visual shell for the header bar. Stateless and hook-free so it can render
 * before the document has loaded (engine still warming up, source still
 * resolving, etc.).
 */
export function PdfHeaderShell({ background, foreground, style, children }: HeaderShellProps) {
  return (
    <ViewerHeaderShell background={background} foreground={foreground} style={style}>
      {children}
    </ViewerHeaderShell>
  );
}

export const PdfHeaderGroup = ViewerHeaderGroup;
export const PdfReloadButton = ViewerReloadButton;

interface PdfHeaderLeftProps {
  title: string;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  sidebarId: string;
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
  // Subtle dimming makes the filename feel secondary to the document itself.
  opacity: 0.92,
};

/**
 * Left half of the toolbar: a menu button that toggles the thumbnail sidebar
 * and the (truncated) document name beside it. `aria-expanded` + `aria-controls`
 * link the button to the sidebar element for screen readers.
 */
export function PdfHeaderLeft({
  title,
  isSidebarOpen,
  onToggleSidebar,
  sidebarId,
  titleStyle,
}: PdfHeaderLeftProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        // `minWidth: 0` lets the title actually shrink and ellipsis-truncate
        // when the toolbar is narrow — otherwise flex children refuse to
        // shrink past their content width. `flex: 0 1 auto` means: don't
        // grow into the spacer slot, but do shrink if siblings need room.
        minWidth: 0,
        flex: "0 1 auto",
      }}
    >
      <IconButton
        aria-label={isSidebarOpen ? "Hide pages" : "Show pages"}
        aria-expanded={isSidebarOpen}
        aria-controls={sidebarId}
        onClick={onToggleSidebar}
      >
        <HugeiconsIcon icon={Menu01Icon} size={16} strokeWidth={2} />
      </IconButton>

      <span title={title} style={{ ...defaultTitleStyle, ...titleStyle }}>
        {title}
      </span>
    </div>
  );
}

export function PdfSidebarButton({
  isSidebarOpen,
  onToggleSidebar,
  sidebarId,
}: Pick<PdfHeaderLeftProps, "isSidebarOpen" | "onToggleSidebar" | "sidebarId">) {
  return (
    <IconButton
      aria-label={isSidebarOpen ? "Hide pages" : "Show pages"}
      aria-expanded={isSidebarOpen}
      aria-controls={sidebarId}
      onClick={onToggleSidebar}
    >
      <HugeiconsIcon icon={Menu01Icon} size={16} strokeWidth={2} />
    </IconButton>
  );
}

interface PdfInteractionToolsProps {
  documentId: string;
}

/**
 * Cursor / hand toggle. Cursor is the default (selection / text); switching
 * to the hand activates EmbedPDF's pan plugin so drag-scroll works without
 * holding a modifier key. Exactly one of the two is active at any time.
 */
export function PdfInteractionTools({ documentId }: PdfInteractionToolsProps) {
  const { isPanning, provides } = usePan(documentId);

  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}
      role="group"
      aria-label="Interaction tools"
    >
      <IconButton
        aria-label="Selection tool"
        isActive={!isPanning}
        disabled={!provides}
        onClick={() => provides?.disablePan()}
      >
        <HugeiconsIcon icon={Cursor01Icon} size={16} strokeWidth={2} />
      </IconButton>
      <IconButton
        aria-label="Pan / hand tool"
        isActive={isPanning}
        disabled={!provides}
        onClick={() => provides?.enablePan()}
      >
        <HugeiconsIcon icon={HandGrabIcon} size={16} strokeWidth={2} />
      </IconButton>
    </div>
  );
}

interface PdfDownloadButtonProps {
  resolved: ResolvedPdfSource;
}

/**
 * Downloads the current PDF. Buffer sources go through an object URL;
 * remote URLs are linked directly (the `download` attribute is best-effort
 * — same-origin or CORS-friendly servers honor the filename, others may
 * navigate, which is a server-side limitation we can't paper over).
 */
export function PdfDownloadButton({ resolved }: PdfDownloadButtonProps) {
  return (
    <IconButton aria-label="Download" title="Download" onClick={() => downloadPdf(resolved)}>
      <HugeiconsIcon icon={Download01Icon} size={17} strokeWidth={1.8} />
    </IconButton>
  );
}

function downloadPdf(resolved: ResolvedPdfSource) {
  if (resolved.kind === "buffer") {
    const blob = new Blob([resolved.buffer], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, resolved.name);
    // Revoke on the next macrotask — Safari needs the URL alive for the
    // click to be honored, but we don't want to leak it for the session.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } else {
    triggerDownload(resolved.url, resolved.name);
  }
}

function triggerDownload(href: string, filename: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

interface ZoomControlsProps {
  documentId: string;
}

/**
 * Zoom percentage + plus/minus controls. Reads zoom state via the EmbedPDF
 * zoom plugin, so this must render inside an `<EmbedPDF>` provider tree
 * that registered `ZoomPluginPackage` and has an active document.
 */
export function PdfZoomControls({ documentId }: ZoomControlsProps) {
  const { state, provides } = useZoom(documentId);

  const zoom = state?.currentZoomLevel ?? 1;
  const percent = Math.round(zoom * 100);
  const canZoomOut = !!provides && zoom > MIN_ZOOM + Number.EPSILON;
  const canZoomIn = !!provides && zoom < MAX_ZOOM - Number.EPSILON;

  return (
    <div
      style={{
        // Don't compress when the filename next to us is long — the zoom
        // controls are critical chrome and need their full footprint.
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 2,
      }}
    >
      <IconButton aria-label="Zoom out" disabled={!canZoomOut} onClick={() => provides?.zoomOut()}>
        <HugeiconsIcon icon={MinusSignIcon} size={16} strokeWidth={2} />
      </IconButton>

      <span
        // Min-width + tabular numerals keep the toolbar from twitching as
        // digits change (e.g. 95% → 100% → 115%).
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

      <IconButton aria-label="Zoom in" disabled={!canZoomIn} onClick={() => provides?.zoomIn()}>
        <HugeiconsIcon icon={PlusSignIcon} size={16} strokeWidth={2} />
      </IconButton>
    </div>
  );
}

export function PdfZoomPicker({
  background,
  documentId,
  foreground,
}: ZoomControlsProps & {
  background: string;
  foreground: string;
}) {
  const { state, provides } = useZoom(documentId);
  const zoom = state?.currentZoomLevel ?? 1;

  return (
    <ViewerValuePicker
      background={background}
      disabled={!provides}
      foreground={foreground}
      formatValue={(value) => `${String(Math.round(value * 100))}%`}
      label="Zoom level"
      onChange={(next) => provides?.requestZoom(next)}
      options={PDF_ZOOM_PRESETS}
      value={Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom))}
    />
  );
}
