import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { Editor, type BeforeMount, type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";

import type { BaseViewerProps } from "../../types";
import {
  useResolvedCodeSource,
  languageFromName,
  type HeySnapCodeSrc,
} from "./useResolvedCodeSource";
import {
  clampFontSize,
  CodeDownloadButton,
  CodeFontSizePicker,
  CodeHeaderGroup,
  CodeHeaderShell,
  CodeReloadButton,
  CodeWordWrapButton,
} from "./CodeViewerHeader";
import { defineHeysnapThemes, HEYSNAP_LIGHT_ID } from "./heysnapMonacoThemes";

export { HEYSNAP_LIGHT_ID, HEYSNAP_DARK_ID } from "./heysnapMonacoThemes";

export type { HeySnapCodeSrc } from "./useResolvedCodeSource";

/**
 * Props for {@link HeySnapCodeViewer}. Every visual prop has a sane default;
 * in practice only `src` is required.
 */
export interface HeySnapCodeViewerProps extends Omit<BaseViewerProps, "src"> {
  /**
   * The source to display. Accepts a URL string (fetched on mount), a `File`
   * from a file input, a `Blob`, an `ArrayBuffer`, or a `Uint8Array`.
   * Buffers are decoded as UTF-8.
   */
  src: HeySnapCodeSrc;

  /**
   * Monaco language id (e.g. `"typescript"`, `"python"`). Overrides the
   * filename-extension-based inference. Pass `"plaintext"` to disable
   * syntax highlighting.
   */
  language?: string;

  /**
   * Monaco theme id. Built-ins: `"vs"`, `"vs-dark"`, `"hc-black"`,
   * `"hc-light"`. Custom themes can be defined via `monaco.editor.defineTheme`
   * and passed here — that's the integration point for the custom theme
   * we'll land next. @default `"vs"`
   */
  theme?: string;

  // ── Header / toolbar ─────────────────────────────────────────────────
  /** Render the toolbar. @default true */
  showHeader?: boolean;
  /** Toolbar background. @default "#ffffff" */
  headerBackground?: string;
  /** Toolbar foreground (title color). @default "#15171c" */
  headerForeground?: string;
  /** Escape hatch — styles merged onto the toolbar `<header>`. */
  headerStyle?: CSSProperties;
  /** @deprecated The code toolbar no longer renders a filename. */
  headerTitleStyle?: CSSProperties;

  /** @deprecated The code toolbar no longer renders a filename. */
  showTitle?: boolean;
  /** Show the font-size picker on the right. @default true */
  showFontSizeControls?: boolean;
  /** Show the word-wrap toggle on the right. @default true */
  showWordWrapButton?: boolean;
  /** Show the download button on the right. @default true */
  showDownloadButton?: boolean;

  /**
   * Initial soft-wrap setting. When uncontrolled, the in-header toggle
   * flips this; pass `wordWrap` to take control and own the state.
   *
   * @default "off"
   */
  defaultWordWrap?: "on" | "off";
  /** Controlled word-wrap state. When set, `defaultWordWrap` is ignored. */
  wordWrap?: "on" | "off";
  /** Called when the user toggles soft-wrap. */
  onWordWrapChange?: (next: "on" | "off") => void;

  // ── Body ────────────────────────────────────────────────────────────
  /** Background painted around the editor surface. @default "#ffffff" */
  bodyBackground?: string;
  /** Escape hatch — styles merged onto the body wrapper. */
  bodyStyle?: CSSProperties;

  // ── Editor behavior ─────────────────────────────────────────────────
  /** Initial font size in px. @default 14 */
  initialFontSize?: number;
  /** Controlled font size in px. When set, the parent owns the value. */
  fontSize?: number;
  /** Called when the viewer's font-size controls request a change. */
  onFontSizeChange?: (next: number) => void;
  /**
   * Escape hatch for the Monaco constructor options. Merged on top of the
   * read-only defaults — pass `wordWrap: "on"`, `minimap: { enabled: true }`,
   * etc. to override. Do not set `readOnly: false` here; the viewer always
   * mounts read-only.
   */
  options?: editor.IStandaloneEditorConstructionOptions;

  // ── Misc ────────────────────────────────────────────────────────────
  /** Override the filename used for language inference when needed. */
  documentName?: string;
  /** Slot for a custom loading indicator while the source resolves. */
  loadingIndicator?: ReactNode;
  /** Called when the source can't be fetched or decoded. */
  onError?: (error: Error) => void;
}

const rootClass = (extra?: string) =>
  ["heysnap-viewer", "heysnap-viewer--code", extra].filter(Boolean).join(" ");

const baseStyle: CSSProperties = {
  position: "relative",
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  width: "100%",
  height: "100%",
};

const DEFAULTS = {
  headerBackground: "#ffffff",
  headerForeground: "#15171c",
  bodyBackground: "#ffffff",
  initialFontSize: 12,
  // The heysnap light theme is registered automatically via `beforeMount`.
  // Consumers wanting Monaco's built-in look can pass `"vs"` / `"vs-dark"`
  // (or any other theme id they've registered themselves) on the `theme`
  // prop, but the default experience here is the heysnap palette.
  theme: HEYSNAP_LIGHT_ID,
} as const;

// localStorage key for the persisted font size. Scoped to "heysnap-code-viewer-"
// so it can't collide with whatever the consumer app may have stored.
const FONT_SIZE_STORAGE_KEY = "heysnap-code-viewer-font-size";

/**
 * Reads the persisted font size from localStorage. Returns `null` when:
 *   - we're on a server (no `window`),
 *   - the key was never written,
 *   - the stored value won't parse as a finite number,
 *   - localStorage threw (private mode, blocked by a CSP, quota check, …).
 *
 * The caller is responsible for clamping into the allowed range.
 */
function readStoredFontSize(): number | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(FONT_SIZE_STORAGE_KEY);
    if (raw == null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Persists the font size. Swallows storage errors silently — failing to
 * remember the preference shouldn't break the editor for the current
 * session.
 */
function writeStoredFontSize(value: number): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(value));
  } catch {
    // Storage may be disabled (private mode, quota exceeded, blocked by
    // a strict CSP); the in-memory value still drives the editor.
  }
}

// Monaco options we lock down for view-mode. Merged with the consumer's
// `options` prop (consumer wins), then `readOnly` is forced true on top so
// nothing can flip the editor into edit mode by accident.
const VIEW_MODE_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  readOnly: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  // The default 5-line top scroll padding feels awkward in a viewer where
  // we want the first line glued to the toolbar.
  padding: { top: 8, bottom: 8 },
  lineNumbers: "on",
  lineNumbersMinChars: 3,
  glyphMargin: false,
  folding: true,
  renderLineHighlight: "none",
  // Strip every guide line — indentation rails, the active-indent
  // highlight, and bracket-pair guides. The heysnap themes also map these
  // colors to the editor background as a fallback, but turning them off at
  // the option layer keeps Monaco from doing the geometry work at all.
  guides: {
    indentation: false,
    highlightActiveIndentation: false,
    bracketPairs: false,
    bracketPairsHorizontal: false,
    highlightActiveBracketPair: false,
  },
  // Disable bracket-pair colorization too. Monaco's default rainbow tints
  // would otherwise override our keyword/literal token rules whenever a
  // matched `{}` / `[]` / `()` pair lands on a non-default color.
  bracketPairColorization: { enabled: false },
  // Hide the context menu — view mode has nothing actionable in there
  // (copy/cut/paste etc. are still available via keyboard).
  contextmenu: false,
  // Automatic layout uses a ResizeObserver on the host element; we rely on
  // it so the viewer reflows when its parent resizes.
  automaticLayout: true,
  // Soft-wrap off matches the typical "read someone else's code" expectation;
  // horizontal scroll appears as needed. Consumer can flip this via `options`.
  wordWrap: "off",
  fontFamily:
    "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
  fontLigatures: true,
  smoothScrolling: true,
  cursorBlinking: "smooth",
  // Read-only mode still allows text selection; this just stops Monaco from
  // drawing the cursor at the first char on focus — distracting in a viewer.
  cursorStyle: "line-thin",
};

// Registers the heysnap themes with the Monaco namespace before the editor
// constructor runs. Defined module-level so the same function identity gets
// handed to every `<Editor>` instance — React skips re-registration when the
// prop reference doesn't change, and Monaco's `defineTheme` is idempotent if
// it does fire again on subsequent mounts.
const registerThemes: BeforeMount = (monaco) => {
  defineHeysnapThemes(monaco);
};

/**
 * Read-only code viewer powered by Monaco. Renders a source string (or
 * fetched URL / picked file / decoded buffer) with the language inferred
 * from the filename extension, plus a familiar header (filename · font-size ·
 * download).
 *
 * @example
 * ```tsx
 * import { HeySnapCodeViewer } from "./components/viewers/HeySnapCodeViewer";
 *
 * <HeySnapCodeViewer src="/snippets/example.ts" />
 * ```
 *
 * @example Picking a file
 * ```tsx
 * <HeySnapCodeViewer src={file} />
 * ```
 */
export function HeySnapCodeViewer({
  src,
  className,
  style,

  language,
  theme = DEFAULTS.theme,

  showHeader = true,
  headerBackground = DEFAULTS.headerBackground,
  headerForeground = DEFAULTS.headerForeground,
  headerStyle,

  showFontSizeControls = true,
  showWordWrapButton = true,
  showDownloadButton = true,

  defaultWordWrap = "off",
  wordWrap: controlledWordWrap,
  onWordWrapChange,

  bodyBackground = DEFAULTS.bodyBackground,
  bodyStyle,

  initialFontSize = DEFAULTS.initialFontSize,
  fontSize: controlledFontSize,
  onFontSizeChange,
  options,

  documentName,
  loadingIndicator,
  onReady,
  onError,
}: HeySnapCodeViewerProps) {
  const { resolved, error, version } = useResolvedCodeSource(src);

  // Stable ref so the effect can call the latest `onError` without depending
  // on it (avoids re-firing on every parent rerender).
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    if (error) onErrorRef.current?.(error);
  }, [error]);

  // Font size lives in local state so the −/+ cluster has somewhere to
  // increment. We also push the value into Monaco imperatively (below) so the
  // editor's font reflows on every change without remounting.
  //
  // Initial value preference: a persisted user pick (localStorage) trumps the
  // `initialFontSize` prop, which trumps the default. This way a user who
  // bumps the font size once keeps that size across page reloads *and* across
  // src swaps within a session — they only ever asked for "bigger" once.
  const [uncontrolledFontSize, setUncontrolledFontSize] = useState<number>(() =>
    clampFontSize(readStoredFontSize() ?? initialFontSize),
  );
  const isFontSizeControlled = controlledFontSize !== undefined;
  const fontSize = isFontSizeControlled
    ? clampFontSize(controlledFontSize)
    : uncontrolledFontSize;

  // Persist the chosen size whenever it changes. The first call also runs on
  // mount, which is fine — re-writing the same value is a no-op for the user
  // and a single sync write for localStorage.
  useEffect(() => {
    writeStoredFontSize(fontSize);
  }, [fontSize]);

  // Imperative handle on the Monaco editor. We use it to push live font-size
  // updates without re-creating the editor instance (which would lose the
  // user's scroll position, fold state, etc.).
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const handleMount: OnMount = (instance) => {
    editorRef.current = instance;
    window.requestAnimationFrame(() => onReadyRef.current?.());
  };

  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize });
  }, [fontSize]);

  const applyFontSize = (next: number) => {
    const clamped = clampFontSize(next);
    if (!isFontSizeControlled) setUncontrolledFontSize(clamped);
    onFontSizeChange?.(clamped);
  };

  // Soft-wrap state — supports both controlled and uncontrolled. When a
  // `wordWrap` prop is supplied the parent owns the value; otherwise we
  // hold our own state in `uncontrolledWrap`. Either way, the
  // `onWordWrapChange` callback fires so a parent can mirror the state
  // (the outer markdown / html viewers do this to surface the same
  // toggle on their own toolbars while keeping ours hidden).
  const [uncontrolledWrap, setUncontrolledWrap] = useState<"on" | "off">(defaultWordWrap);
  const isWrapControlled = controlledWordWrap !== undefined;
  const wordWrap = isWrapControlled ? controlledWordWrap : uncontrolledWrap;
  const applyWordWrap = (next: "on" | "off") => {
    if (!isWrapControlled) setUncontrolledWrap(next);
    onWordWrapChange?.(next);
  };

  useEffect(() => {
    // Push wrap changes imperatively too — `options` on the JSX path
    // already includes the live value, but `updateOptions` is what Monaco
    // listens to for between-renders updates without re-creating the
    // editor instance.
    editorRef.current?.updateOptions({ wordWrap });
  }, [wordWrap]);

  // Final language: explicit prop wins, otherwise inferred from the resolved
  // filename. Falls back to `"plaintext"` when nothing is resolved yet so
  // the editor doesn't briefly highlight as the wrong language.
  const resolvedLanguage =
    language ?? (resolved ? resolved.language : languageFromName(documentName ?? ""));

  // ── Render ──────────────────────────────────────────────────────────
  const reloadPreview = () => window.location.reload();

  const renderShell = (state: "loading" | "error" | "ready", body: ReactNode) => (
    <div
      className={rootClass(className)}
      data-format="code"
      // Mirror the image viewer: stamp `data-src` when the source is a string
      // so consumers can pick it out without poking at refs. Binary sources
      // have no stable identifier worth surfacing.
      {...(typeof src === "string" ? { "data-src": src } : {})}
      data-state={state}
      style={{ ...baseStyle, ...style }}
    >
      {showHeader && (
        <CodeHeaderShell
          background={headerBackground}
          foreground={headerForeground}
          style={headerStyle}
        >
          <CodeHeaderGroup align="left">
            <CodeReloadButton onReload={reloadPreview} />
          </CodeHeaderGroup>
          <CodeHeaderGroup align="right">
            {showFontSizeControls && (
              <CodeFontSizePicker
                background={headerBackground}
                foreground={headerForeground}
                fontSize={fontSize}
                onChange={applyFontSize}
                disabled={state !== "ready"}
              />
            )}
            {showWordWrapButton && (
              <CodeWordWrapButton
                wrapped={wordWrap === "on"}
                onChange={(next) => applyWordWrap(next ? "on" : "off")}
                disabled={state !== "ready"}
              />
            )}
            {showDownloadButton && resolved && <CodeDownloadButton resolved={resolved} />}
          </CodeHeaderGroup>
        </CodeHeaderShell>
      )}
      {body}
    </div>
  );

  if (error) {
    return renderShell(
      "error",
      <p style={{ padding: 16, color: "#b00020" }}>Failed to load source: {error.message}</p>,
    );
  }

  if (!resolved) {
    return renderShell(
      "loading",
      loadingIndicator ?? <p style={{ padding: 16, color: "#666" }}>Loading source…</p>,
    );
  }

  // Keep the Monaco instance mounted across live source updates. The parent
  // preview app remounts this viewer for a different document; within the
  // same document, preserving the editor keeps scroll, folds, and local UI
  // state stable while the value changes underneath.
  return renderShell(
    "ready",
    <div
      style={{
        flex: 1,
        minHeight: 0,
        background: bodyBackground,
        display: "flex",
        flexDirection: "column",
        ...bodyStyle,
      }}
    >
      <Editor
        value={resolved.text}
        language={resolvedLanguage}
        theme={theme}
        beforeMount={registerThemes}
        onMount={handleMount}
        options={{
          ...VIEW_MODE_OPTIONS,
          ...options,
          // Locked overrides — placed after the consumer's `options` spread
          // so nothing they pass can flip these:
          //   - `readOnly`: the viewer never enters edit mode
          //   - `fontSize`: the toolbar's −/+ cluster owns this value
          //   - `wordWrap`: the toolbar's wrap toggle owns this value
          readOnly: true,
          fontSize,
          wordWrap,
        }}
        loading={
          loadingIndicator ?? (
            <span style={{ color: "#666", fontSize: 13 }}>Loading editor…</span>
          )
        }
      />
    </div>,
  );
}
