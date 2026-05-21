/**
 * Custom Monaco themes that ship with `HeySnapCodeViewer`.
 *
 * Palette (kept deliberately tight — 3 token colors per mode):
 *
 *                       light                dark
 *   background          #FFFFFF              #0F0F11
 *   main text           #000000              #E6E9EF
 *   highlight 1         #D43538 (red)        #8C97FF (purple)
 *   highlight 2         #008809 (green)      #7AD9C0 (teal)
 *
 *   highlight 1  → keywords (import / const / function / return / …)
 *   highlight 2  → literals (strings + numbers + regex)
 *   main text    → identifiers, operators, punctuation
 *   comments     → dimmed main text, italic
 *   line numbers → dimmed main text (the gutter only)
 *
 * Indent guides, bracket-pair colorization, and the active-line highlight
 * are also stripped so the editor stays a clean three-color surface — the
 * `HeySnapCodeViewer` toggles the Monaco options that draw those, but we
 * also map their theme colors to the background as a belt-and-suspenders
 * guard against any feature we forget to turn off via options.
 */

import type { editor } from "monaco-editor";
import type { Monaco } from "@monaco-editor/react";

/** Theme id for the light variant. Pass this string to Monaco's `theme` option. */
export const HEYSNAP_LIGHT_ID = "heysnap-light";
/** Theme id for the dark variant. */
export const HEYSNAP_DARK_ID = "heysnap-dark";

// ── Palette ─────────────────────────────────────────────────────────────

/**
 * Per-mode color set. The three headline colors (`text` / `keyword` /
 * `literal`) come straight from the design; the rest are tuned per mode so
 * the secondary surfaces (selection, scrollbar) read consistently against
 * their respective backgrounds.
 */
interface Palette {
  /** Editor background, with leading `#` (used in `colors` map). */
  bg: string;
  /** Editor foreground (default text), with leading `#`. */
  text: string;
  /**
   * Keyword color (highlight 1). Hex *without* leading `#` — Monaco's
   * `ITokenThemeRule.foreground` strips it.
   */
  keyword: string;
  /** Literal color (highlight 2) — strings, numbers, regex. No `#`. */
  literal: string;
  /** Dimmed text — comments, line numbers. No `#`. */
  muted: string;
  /** Selection background (with `#`). */
  selectionBg: string;
  /** Selection bg when the editor isn't focused. */
  inactiveSelectionBg: string;
  /** Background for the "same as my selection" word highlights. */
  selectionHighlightBg: string;
  /** Scrollbar slider at rest. */
  scrollbarBg: string;
  /** Scrollbar slider on hover. */
  scrollbarHoverBg: string;
  /** Scrollbar slider while being dragged. */
  scrollbarActiveBg: string;
}

const LIGHT: Palette = {
  bg: "#FFFFFF",
  text: "#000000",
  keyword: "D43538", // red
  literal: "008809", // green
  muted: "8C8C8C",
  selectionBg: "#DDE8FA",
  inactiveSelectionBg: "#E8ECF3",
  selectionHighlightBg: "#EAF0FB",
  scrollbarBg: "#E5E7EB",
  scrollbarHoverBg: "#D1D5DB",
  scrollbarActiveBg: "#9CA3AF",
};

const DARK: Palette = {
  bg: "#0F0F11",
  text: "#E6E9EF",
  keyword: "8C97FF", // purple
  literal: "7AD9C0", // teal
  muted: "5A5E6B",
  selectionBg: "#2D3043",
  inactiveSelectionBg: "#1F212E",
  selectionHighlightBg: "#1A1C28",
  scrollbarBg: "#2D3043",
  scrollbarHoverBg: "#3A3E55",
  scrollbarActiveBg: "#4A4F6C",
};

// ── Token rules ────────────────────────────────────────────────────────

/**
 * Token rules in the order Monaco prefers — most-general first, more-specific
 * scopes layered on top. Monaco resolves by longest-prefix match, so listing
 * `"string"` covers `string.ts`, `string.js`, `string.escape.python`, etc.
 *
 * Rule strings use hex *without* the leading `#` — that's Monaco's contract
 * for `ITokenThemeRule`. (The `colors` map below uses `#` — yes, the two
 * differ, and yes, it's a Monaco quirk.)
 */
function buildRules(c: Palette): editor.ITokenThemeRule[] {
  return [
    // Catch-all: identifiers, operators, delimiters, punctuation, type
    // names, JSX attribute names, etc. fall through to this row when the
    // tokenizer didn't tag them more specifically.
    { token: "", foreground: c.text.replace("#", "") },

    // Keywords — `import`, `from`, `const`, `let`, `var`, `function`,
    // `return`, `if`, `else`, `class`, etc. Monarch tokenizers also emit
    // `keyword.flow`, `keyword.operator`, etc. — the bare prefix covers them.
    { token: "keyword", foreground: c.keyword },

    // Literals — strings, numbers, regex. Grouped as "value-y things" so
    // the eye reads them as one color in the editor.
    { token: "string", foreground: c.literal },
    { token: "number", foreground: c.literal },
    { token: "regexp", foreground: c.literal },

    // Comments — dimmed main text, italic. Italics on comments is a
    // long-standing IDE convention and helps them visually retreat without
    // adding a fourth color to the palette.
    { token: "comment", foreground: c.muted, fontStyle: "italic" },
  ];
}

// ── Editor colors ──────────────────────────────────────────────────────

/**
 * Painted-surface colors. Anything not listed inherits from the base theme
 * (`vs` / `vs-dark`) thanks to `inherit: true` below.
 *
 * The repeated mapping of indent / bracket / line-highlight keys to the
 * background color is intentional: it's redundant with the options the
 * viewer flips off (`guides.indentation: false`, etc.), but if a future
 * caller turns those options back on without realizing they need theme
 * overrides too, the lines still won't draw because their color matches
 * the canvas.
 */
function buildColors(c: Palette): Record<string, string> {
  return {
    "editor.background": c.bg,
    "editor.foreground": c.text,

    // Gutter — match the editor bg so the line-number column reads as
    // part of the same surface rather than a stripe down the side.
    "editorGutter.background": c.bg,
    "editorLineNumber.foreground": `#${c.muted}`,
    "editorLineNumber.activeForeground": c.text,

    // Active-line highlight off (background painted to canvas color).
    "editor.lineHighlightBackground": c.bg,
    "editor.lineHighlightBorder": c.bg,

    // Cursor takes the main text color.
    "editorCursor.foreground": c.text,

    // Selection — tinted overlays. Per-mode values live on the palette so
    // each mode picks a tint that doesn't fight either highlight color.
    "editor.selectionBackground": c.selectionBg,
    "editor.inactiveSelectionBackground": c.inactiveSelectionBg,
    "editor.selectionHighlightBackground": c.selectionHighlightBg,

    // Indent guides — painted to bg so even if `guides.indentation` flips on,
    // they remain invisible.
    "editorIndentGuide.background": c.bg,
    "editorIndentGuide.background1": c.bg,
    "editorIndentGuide.activeBackground": c.bg,
    "editorIndentGuide.activeBackground1": c.bg,

    // Bracket pair guides + match highlights — same trick.
    "editorBracketMatch.background": c.bg,
    "editorBracketMatch.border": c.bg,
    "editorBracketPairGuide.background1": c.bg,
    "editorBracketPairGuide.background2": c.bg,
    "editorBracketPairGuide.background3": c.bg,
    "editorBracketPairGuide.background4": c.bg,
    "editorBracketPairGuide.background5": c.bg,
    "editorBracketPairGuide.background6": c.bg,
    "editorBracketPairGuide.activeBackground1": c.bg,
    "editorBracketPairGuide.activeBackground2": c.bg,
    "editorBracketPairGuide.activeBackground3": c.bg,
    "editorBracketPairGuide.activeBackground4": c.bg,
    "editorBracketPairGuide.activeBackground5": c.bg,
    "editorBracketPairGuide.activeBackground6": c.bg,

    // Scrollbar — neutral per-mode shades sitting between the background
    // and the dimmed text color, with a step-up on hover and active drag.
    "scrollbarSlider.background": c.scrollbarBg,
    "scrollbarSlider.hoverBackground": c.scrollbarHoverBg,
    "scrollbarSlider.activeBackground": c.scrollbarActiveBg,

    // Overview ruler border (right-side strip in case minimap or scroll
    // markers ever get enabled).
    "editorOverviewRuler.border": c.bg,

    // Minimap — same surface, in case a consumer flips `minimap.enabled` on.
    "minimap.background": c.bg,
  };
}

// ── Theme data ─────────────────────────────────────────────────────────

const HEYSNAP_LIGHT: editor.IStandaloneThemeData = {
  base: "vs",
  // `inherit: true` keeps Monaco's sensible defaults for tokens we don't
  // touch (e.g. type names, JSX tags, embedded language scopes) — the
  // overrides above only need to cover what we want to recolor.
  inherit: true,
  rules: buildRules(LIGHT),
  colors: buildColors(LIGHT),
};

const HEYSNAP_DARK: editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: buildRules(DARK),
  colors: buildColors(DARK),
};

/**
 * Register the heysnap themes with the Monaco namespace. Idempotent — calling
 * it twice for the same theme id just overwrites the prior registration.
 * Pass this to `<Editor beforeMount={...} />` so the themes are available
 * by the time Monaco constructs the editor instance.
 */
export function defineHeysnapThemes(monaco: Monaco): void {
  monaco.editor.defineTheme(HEYSNAP_LIGHT_ID, HEYSNAP_LIGHT);
  monaco.editor.defineTheme(HEYSNAP_DARK_ID, HEYSNAP_DARK);
}
