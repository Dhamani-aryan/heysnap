import type { CSSProperties, ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Download01Icon,
  MinusSignIcon,
  PlusSignIcon,
  TextWrapIcon,
} from "@hugeicons/core-free-icons";

import { IconButton } from "../../_internal/IconButton";
import type { ResolvedCodeSource } from "./useResolvedCodeSource";

// Font-size ladder matched to the other viewers' zoom envelopes. Monaco
// allows arbitrary float values but a curated preset list keeps the UI
// predictable and the badge legible at every step.
export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 48;
const FONT_SIZE_PRESETS = [10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 40, 48] as const;

export function clampFontSize(value: number): number {
  if (!Number.isFinite(value)) return 14;
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.round(value)));
}

/** Largest preset strictly less than `current`. */
export function getPreviousFontSize(current: number): number {
  for (let i = FONT_SIZE_PRESETS.length - 1; i >= 0; i--) {
    if (FONT_SIZE_PRESETS[i] < current) return FONT_SIZE_PRESETS[i];
  }
  return MIN_FONT_SIZE;
}

/** Smallest preset strictly greater than `current`. */
export function getNextFontSize(current: number): number {
  for (const p of FONT_SIZE_PRESETS) {
    if (p > current) return p;
  }
  return MAX_FONT_SIZE;
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
  // PDF / DOCX / XLSX / Image headers — five viewers, one toolbar idiom.
  gap: 28,
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
export function CodeHeaderShell({ background, foreground, style, children }: HeaderShellProps) {
  return (
    <header style={{ ...headerBaseStyle, background, color: foreground, ...style }}>
      {children}
    </header>
  );
}

interface CodeTitleProps {
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
  // precedes it.
  paddingLeft: 6,
};

/**
 * Title on the left side of the toolbar. Truncation only fires when the
 * outer flex slot allows shrinking — `minWidth: 0` + `flex: 0 1 auto`
 * provides that.
 */
export function CodeTitle({ name, style }: CodeTitleProps) {
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

interface CodeFontSizeControlsProps {
  /** Current font size in px. */
  fontSize: number;
  /** Called with the *next* clamped size. */
  onChange: (next: number) => void;
  /** True when no document is mounted yet (loading / error states). */
  disabled?: boolean;
}

/**
 * Font-size cluster: minus / "14 px" badge / plus. Tabular numerals keep
 * the badge from twitching as digits change; buttons disable at the bounds
 * so the user gets a clear "this is the limit" signal.
 */
export function CodeFontSizeControls({
  fontSize,
  onChange,
  disabled = false,
}: CodeFontSizeControlsProps) {
  const canDecrease = !disabled && fontSize > MIN_FONT_SIZE;
  const canIncrease = !disabled && fontSize < MAX_FONT_SIZE;

  return (
    <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 2 }}>
      <IconButton
        aria-label="Decrease font size"
        disabled={!canDecrease}
        onClick={() => onChange(getPreviousFontSize(fontSize))}
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
        {fontSize}px
      </span>

      <IconButton
        aria-label="Increase font size"
        disabled={!canIncrease}
        onClick={() => onChange(getNextFontSize(fontSize))}
      >
        <HugeiconsIcon icon={PlusSignIcon} size={16} strokeWidth={2} />
      </IconButton>
    </div>
  );
}

interface CodeDownloadButtonProps {
  resolved: ResolvedCodeSource;
}

/**
 * Downloads the displayed source as a text file under its resolved name.
 * Uses an object URL on a synthesized Blob so the download works regardless
 * of where the original bytes came from (URL fetch / File picker / raw buffer).
 */
export function CodeDownloadButton({ resolved }: CodeDownloadButtonProps) {
  return (
    <IconButton aria-label="Download" onClick={() => downloadCode(resolved)}>
      <HugeiconsIcon icon={Download01Icon} size={17} strokeWidth={1.8} />
    </IconButton>
  );
}

interface CodeWordWrapButtonProps {
  /** True when soft-wrap is currently enabled in the editor. */
  wrapped: boolean;
  /** Toggle handler — called with the *next* wrapped value. */
  onChange: (next: boolean) => void;
  /** Inert while the source is loading / errored. */
  disabled?: boolean;
}

/**
 * Soft-wrap toggle. Mirrors the cursor / pan pattern from the PDF
 * viewer — a single icon whose `aria-pressed` state advertises whether
 * the editor is currently soft-wrapping. We expose this as its own
 * component (rather than wiring the button inline) so the outer
 * markdown / html viewers can render an identical control on their own
 * toolbars when they're showing the embedded code editor in code mode.
 */
export function CodeWordWrapButton({
  wrapped,
  onChange,
  disabled = false,
}: CodeWordWrapButtonProps) {
  return (
    <IconButton
      aria-label={wrapped ? "Disable word wrap" : "Enable word wrap"}
      isActive={wrapped}
      disabled={disabled}
      onClick={() => onChange(!wrapped)}
    >
      <HugeiconsIcon icon={TextWrapIcon} size={16} strokeWidth={2} />
    </IconButton>
  );
}

function downloadCode(resolved: ResolvedCodeSource) {
  const blob = new Blob([resolved.text], { type: "text/plain;charset=utf-8" });
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
