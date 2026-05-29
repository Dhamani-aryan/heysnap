import type { CSSProperties, ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { CodeIcon, Download01Icon, ViewIcon } from "@hugeicons/core-free-icons";

import { IconButton } from "../../_internal/IconButton";
import {
  ViewerHeaderGroup,
  ViewerHeaderShell,
  ViewerReloadButton,
  ViewerValuePicker,
} from "../../_internal/ViewerToolbar";
import type { ResolvedMarkdownSource } from "./useResolvedMarkdownSource";

/**
 * The two display modes of the markdown viewer.
 *
 *  - `"preview"` renders the markdown via Streamdown (formatted, images,
 *    syntax-highlighted code blocks, …).
 *  - `"code"` renders the raw markdown source via {@link HeySnapCodeViewer}
 *    with the `markdown` language id.
 */
export type MarkdownViewMode = "preview" | "code";
const MARKDOWN_ZOOM_PRESETS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0] as const;

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
  // Slightly tighter gap than the other viewers — the mode toggle lives next
  // to the title rather than on the right edge, so we don't want the two
  // clusters to feel separated by an ocean of empty space.
  gap: 12,
  height: 40,
  flexShrink: 0,
  padding: "0 8px",
  // Single hairline under the bar. `currentColor` follows `foreground`.
  boxShadow: "inset 0 -1px 0 color-mix(in srgb, currentColor 10%, transparent)",
};

/**
 * Stateless visual shell. Renders before the source has resolved so the
 * chrome is identical across loading / error / ready states.
 */
export function MarkdownHeaderShell({
  background,
  foreground,
  style,
  children,
}: HeaderShellProps) {
  return (
    <ViewerHeaderShell background={background} foreground={foreground} style={style}>
      {children}
    </ViewerHeaderShell>
  );
}

export const MarkdownHeaderGroup = ViewerHeaderGroup;
export const MarkdownReloadButton = ViewerReloadButton;

interface MarkdownTitleProps {
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

/** Filename slot on the left of the toolbar. */
export function MarkdownTitle({ name, style }: MarkdownTitleProps) {
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

interface MarkdownModeToggleProps {
  /** Active mode. */
  mode: MarkdownViewMode;
  /** Switch mode. Called with the *next* mode. */
  onChange: (next: MarkdownViewMode) => void;
  /** True during loading / error states; disables both buttons. */
  disabled?: boolean;
}

/**
 * Preview / Code mode toggle, sat right next to the filename so the user
 * always sees both "what am I looking at" and "what view am I in" in the
 * same eye-line. Internally it's two {@link IconButton}s sharing an
 * `aria-pressed`-based active state, which matches how the PDF viewer's
 * cursor/pan tools advertise their selection.
 */
export function MarkdownModeToggle({
  mode,
  onChange,
  disabled = false,
}: MarkdownModeToggleProps) {
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}
      role="group"
      aria-label="Markdown view mode"
    >
      <IconButton
        aria-label="Preview"
        isActive={mode === "preview"}
        disabled={disabled}
        onClick={() => onChange("preview")}
      >
        <HugeiconsIcon icon={ViewIcon} size={16} strokeWidth={2} />
      </IconButton>
      <IconButton
        aria-label="View source"
        isActive={mode === "code"}
        disabled={disabled}
        onClick={() => onChange("code")}
      >
        <HugeiconsIcon icon={CodeIcon} size={16} strokeWidth={2} />
      </IconButton>
    </div>
  );
}

interface MarkdownDownloadButtonProps {
  resolved: ResolvedMarkdownSource;
}

interface MarkdownZoomPickerProps {
  background: string;
  disabled?: boolean;
  foreground: string;
  onZoom: (next: number) => void;
  zoom: number;
}

export function MarkdownZoomPicker({
  background,
  disabled = false,
  foreground,
  onZoom,
  zoom,
}: MarkdownZoomPickerProps) {
  return (
    <ViewerValuePicker
      background={background}
      disabled={disabled}
      foreground={foreground}
      formatValue={(value) => `${String(Math.round(value * 100))}%`}
      label="Zoom level"
      onChange={onZoom}
      options={MARKDOWN_ZOOM_PRESETS}
      value={zoom}
    />
  );
}

/**
 * Downloads the markdown source as a `.md` text file under its resolved
 * name. We synthesize a fresh Blob each click so the download works whether
 * the source originally came from a URL, a File, or a buffer.
 */
export function MarkdownDownloadButton({ resolved }: MarkdownDownloadButtonProps) {
  return (
    <IconButton aria-label="Download" title="Download" onClick={() => downloadMarkdown(resolved)}>
      <HugeiconsIcon icon={Download01Icon} size={17} strokeWidth={1.8} />
    </IconButton>
  );
}

function downloadMarkdown(resolved: ResolvedMarkdownSource) {
  const blob = new Blob([resolved.text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = resolved.name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next macrotask — Safari needs the URL alive for the click
  // to be honored, but we don't want to leak it for the session.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
