import type { CSSProperties, ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { CodeIcon, Download01Icon, ViewIcon } from "@hugeicons/core-free-icons";

import { IconButton } from "../../_internal/IconButton";

/**
 * Display modes for the HTML viewer.
 *
 *  - `"preview"` mounts a sandboxed iframe with the markup applied via
 *    `srcdoc`, so styles, images, and layout render the way a browser
 *    would — but with scripts disabled (the iframe lacks `allow-scripts`).
 *  - `"code"` shows the raw HTML source through {@link HeySnapCodeViewer}
 *    with the `html` language id.
 */
export type HtmlViewMode = "preview" | "code";

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
  // Tight gap mirrors the markdown header — the mode toggle sits flush to
  // the title rather than across an ocean, so all clusters get the same
  // 12 px rhythm.
  gap: 12,
  height: 40,
  flexShrink: 0,
  padding: "0 8px",
  boxShadow: "inset 0 -1px 0 color-mix(in srgb, currentColor 10%, transparent)",
};

/** Stateless header bar — renders identically across loading / error /
 *  ready states. */
export function HtmlHeaderShell({ background, foreground, style, children }: HeaderShellProps) {
  return (
    <header style={{ ...headerBaseStyle, background, color: foreground, ...style }}>
      {children}
    </header>
  );
}

interface HtmlTitleProps {
  name: string;
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
export function HtmlTitle({ name, style }: HtmlTitleProps) {
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

interface HtmlModeToggleProps {
  mode: HtmlViewMode;
  onChange: (next: HtmlViewMode) => void;
  disabled?: boolean;
}

/** Preview / Code toggle — same idiom as the markdown header's so the two
 *  viewers feel like one family. */
export function HtmlModeToggle({ mode, onChange, disabled = false }: HtmlModeToggleProps) {
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}
      role="group"
      aria-label="HTML view mode"
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

interface HtmlDownloadButtonProps {
  name: string;
  url: string;
}

/** Downloads the current HTML document through the preview server URL. */
export function HtmlDownloadButton({ name, url }: HtmlDownloadButtonProps) {
  return (
    <IconButton aria-label="Download" onClick={() => downloadHtml(url, name)}>
      <HugeiconsIcon icon={Download01Icon} size={17} strokeWidth={1.8} />
    </IconButton>
  );
}

function downloadHtml(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
