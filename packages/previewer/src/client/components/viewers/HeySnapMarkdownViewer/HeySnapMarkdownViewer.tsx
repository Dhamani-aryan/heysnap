import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import type { BaseViewerProps } from "../../types";
import { clampDocumentZoom, DocumentZoomControls } from "../../_internal/documentZoom";
import { ReadyAfterPaint } from "../../_internal/previewReady";
import { HeySnapCodeViewer } from "../HeySnapCodeViewer";
import { CodeWordWrapButton } from "../HeySnapCodeViewer/CodeViewerHeader";
import {
  useResolvedMarkdownSource,
  type HeySnapMarkdownSrc,
} from "./useResolvedMarkdownSource";
import {
  MarkdownDownloadButton,
  MarkdownHeaderShell,
  MarkdownModeToggle,
  MarkdownTitle,
  type MarkdownViewMode,
} from "./MarkdownViewerHeader";
import {
  ensureMarkdownPreviewStyles,
  MARKDOWN_PREVIEW_CLASS,
} from "./markdownPreviewStyles";

export type { HeySnapMarkdownSrc, MarkdownContent } from "./useResolvedMarkdownSource";
export type { MarkdownViewMode } from "./MarkdownViewerHeader";

/**
 * Props for {@link HeySnapMarkdownViewer}. Every visual prop has a sane
 * default; in practice only `src` is required.
 */
export interface HeySnapMarkdownViewerProps extends Omit<BaseViewerProps, "src"> {
  /**
   * The markdown source to display. Accepts a URL string (fetched on mount),
   * a `File` from a file input, a `Blob`, an `ArrayBuffer`, a `Uint8Array`,
   * or a `{ text, name }` object when you already have the text in memory.
   */
  src: HeySnapMarkdownSrc;

  /**
   * Which view mode to start in. The header toggle flips this; the value is
   * also accepted as a controlled prop — pass `mode` + `onModeChange` to
   * own the state externally.
   *
   * @default "preview"
   */
  defaultMode?: MarkdownViewMode;
  /** Controlled mode. When set, `defaultMode` is ignored. */
  mode?: MarkdownViewMode;
  /** Called when the user clicks Preview / Code. */
  onModeChange?: (next: MarkdownViewMode) => void;

  // ── Header / toolbar ─────────────────────────────────────────────────
  /** Render the toolbar. @default true */
  showHeader?: boolean;
  /** Toolbar background. @default "#ffffff" */
  headerBackground?: string;
  /** Toolbar foreground (title color). @default "#15171c" */
  headerForeground?: string;
  /** Escape hatch — styles merged onto the toolbar `<header>`. */
  headerStyle?: CSSProperties;
  /** Styles merged onto the filename span. */
  headerTitleStyle?: CSSProperties;

  /** Show the filename on the left side of the toolbar. @default true */
  showTitle?: boolean;
  /** Show the Preview / Code toggle. @default true */
  showModeToggle?: boolean;
  /** Show the −/+ zoom cluster on the right side of the toolbar. @default true */
  showZoomControls?: boolean;
  /** Show the download button on the right. @default true */
  showDownloadButton?: boolean;

  /**
   * Initial zoom — `1.0` is 100 % (the default render scale). Subsequent
   * user clicks step through quarter presets between 0.5× and 3×. The
   * zoom only affects Preview mode (font-size scales the em-based
   * stylesheet); the embedded code viewer manages its own font size.
   *
   * @default 1.0
   */
  initialZoom?: number;

  /**
   * Monaco theme id used when the user switches to Code mode. Forwarded
   * verbatim to the embedded {@link HeySnapCodeViewer} so consumers can
   * track their app's color scheme (`"heysnap-light"` / `"heysnap-dark"` /
   * any custom theme registered via `monaco.editor.defineTheme`).
   *
   * @default "heysnap-light"
   */
  codeTheme?: string;

  // ── Body ────────────────────────────────────────────────────────────
  /**
   * Background painted around the rendered markdown / source code. Match
   * this to the embedded code viewer's Monaco `editor.background` so the
   * Preview / Code toggle reads as a content swap rather than a surface
   * swap. The heysnap themes ship `#FFFFFF` (light) and `#0F0F11` (dark).
   *
   * @default "#ffffff"
   */
  bodyBackground?: string;
  /** Escape hatch — styles merged onto the body wrapper. */
  bodyStyle?: CSSProperties;
  /**
   * Extra class names appended to the rendered preview root. Useful when
   * the consumer wants to scope custom typography / prose styles to the
   * preview surface without overriding the shipped defaults.
   */
  previewClassName?: string;
  /**
   * Base URL used to resolve relative image paths in rendered markdown.
   * Callers that load markdown from a filesystem can point this at an
   * authenticated asset route for files next to the document.
   */
  assetBaseUrl?: string;
  /**
   * Padding around the preview content. Pass `0` to align preview margins
   * with the code mode's gutter. @default 28
   */
  previewPadding?: number | string;
  /**
   * Custom react-markdown component overrides, merged on top of the
   * defaults. Use this to plug in syntax-highlighted code blocks, custom
   * link wrappers, etc. See react-markdown's `components` prop for the
   * full type — the merge is shallow, so passing `{ code: MyCode }`
   * keeps the rest of the defaults.
   */
  components?: Components;

  // ── Misc ────────────────────────────────────────────────────────────
  /** Override the filename shown in the toolbar. */
  documentName?: string;
  /** Slot for a custom loading indicator while the source resolves. */
  loadingIndicator?: ReactNode;
  /** Called when the source can't be fetched or decoded. */
  onError?: (error: Error) => void;
}

const rootClass = (extra?: string) =>
  ["heysnap-viewer", "heysnap-viewer--markdown", extra].filter(Boolean).join(" ");

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
  // White preview surface — same as the heysnap-light Monaco theme so the
  // Preview / Code toggle reads as a content swap, not a surface swap.
  // Dark callers should pass `#0F0F11` (matches heysnap-dark) to keep that
  // alignment.
  bodyBackground: "#ffffff",
  previewPadding: 28 as number | string,
} as const;

// remark-gfm is stable across renders — using a module-level array keeps
// react-markdown from re-running its plugin pipeline on every parent
// rerender.
const REMARK_PLUGINS = [remarkGfm];

/**
 * Default component overrides for the rendered markdown. The base styles
 * live in {@link markdownPreviewStyles} (scoped to `.heysnap-md-preview`);
 * the only thing we need here at the component layer is the table wrapper
 * — wide tables would otherwise blow out the body's horizontal flow, so we
 * wrap them in an overflow-x container that the stylesheet styles via
 * `.heysnap-md-table-wrap`.
 *
 * Anchor links open in a new tab when they look external — a common
 * affordance the GFM spec doesn't dictate but most preview surfaces ship.
 */
const createDefaultComponents = (assetBaseUrl?: string): Components => ({
  table: ({ children, ...rest }) => (
    <div className="heysnap-md-table-wrap">
      <table {...rest}>{children}</table>
    </div>
  ),
  a: ({ href, children, ...rest }) => {
    const isExternal = !!href && /^(https?:)?\/\//i.test(href);
    return (
      <a
        href={href}
        {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        {...rest}
      >
        {children}
      </a>
    );
  },
  img: ({ src, alt, ...rest }) => (
    <img src={resolveMarkdownAssetUrl(src, assetBaseUrl)} alt={alt ?? ""} {...rest} />
  ),
});

/**
 * Read-only markdown viewer with a Preview / Code toggle. Preview mode
 * renders the source through `react-markdown` + `remark-gfm` (paragraphs,
 * lists, GFM tables, task lists, strikethroughs, images, fenced code, …);
 * Code mode swaps in {@link HeySnapCodeViewer} on the same surface so the
 * raw source reads as native chrome rather than a separate viewer.
 *
 * `react-markdown` and `remark-gfm` are optional peer dependencies —
 * consumers that import this viewer must install them themselves.
 *
 * @example URL source
 * ```tsx
 * import { HeySnapMarkdownViewer } from "./components/viewers/HeySnapMarkdownViewer";
 *
 * <HeySnapMarkdownViewer src="/docs/README.md" />
 * ```
 *
 * @example In-memory text
 * ```tsx
 * <HeySnapMarkdownViewer src={{ text: "# Hello", name: "hello.md" }} />
 * ```
 */
export function HeySnapMarkdownViewer({
  src,
  className,
  style,

  defaultMode = "preview",
  mode: controlledMode,
  onModeChange,

  showHeader = true,
  headerBackground = DEFAULTS.headerBackground,
  headerForeground = DEFAULTS.headerForeground,
  headerStyle,
  headerTitleStyle,

  showTitle = true,
  showModeToggle = true,
  showZoomControls = true,
  showDownloadButton = true,

  initialZoom = 1,

  codeTheme,

  bodyBackground = DEFAULTS.bodyBackground,
  bodyStyle,
  previewClassName,
  assetBaseUrl,
  previewPadding = DEFAULTS.previewPadding,
  components,

  documentName,
  loadingIndicator,
  onReady,
  onError,
}: HeySnapMarkdownViewerProps) {
  const { resolved, error, version } = useResolvedMarkdownSource(src);

  // Inject the preview stylesheet on first mount of any viewer instance.
  // Idempotent — subsequent mounts hit the `id` guard and no-op.
  useEffect(() => {
    ensureMarkdownPreviewStyles();
  }, []);

  // Stable ref so the effect can call the latest `onError` without
  // depending on it (avoids re-firing on every parent rerender).
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (error) onErrorRef.current?.(error);
  }, [error]);

  // Uncontrolled fallback state for the mode toggle. When a `mode` prop is
  // supplied the consumer owns the value and `setUncontrolledMode` is never
  // used; we still call `onModeChange` so the consumer can react.
  const [uncontrolledMode, setUncontrolledMode] = useState<MarkdownViewMode>(defaultMode);
  const isControlled = controlledMode !== undefined;
  const currentMode: MarkdownViewMode = isControlled ? controlledMode : uncontrolledMode;

  const handleModeChange = (next: MarkdownViewMode) => {
    if (!isControlled) setUncontrolledMode(next);
    onModeChange?.(next);
  };

  // Preview zoom — scales the em-based stylesheet by driving the preview
  // wrapper's root font-size. We clamp initial values so an out-of-range
  // prop doesn't poison the badge or the bounds-checked buttons.
  const [zoom, setZoom] = useState<number>(() => clampDocumentZoom(initialZoom));
  const applyZoom = (next: number) => setZoom(clampDocumentZoom(next));

  // Soft-wrap state for the embedded code viewer. The toggle lives on our
  // outer header (so it's reachable while the inner code viewer's own
  // header is hidden) but the actual wrap behavior is owned by Monaco
  // inside HeySnapCodeViewer — we pass the value as a controlled prop.
  const [wordWrap, setWordWrap] = useState<"on" | "off">("off");

  // Merge consumer component overrides on top of the defaults. The merge is
  // shallow — consumers can replace individual tags without losing the
  // others. Memoized so react-markdown sees a stable reference between
  // renders when neither input changed.
  const mergedComponents = useMemo<Components>(
    () => ({ ...createDefaultComponents(assetBaseUrl), ...components }),
    [assetBaseUrl, components],
  );

  // ── Render ──────────────────────────────────────────────────────────
  const title = documentName || resolved?.name || "";

  const renderShell = (state: "loading" | "error" | "ready", body: ReactNode) => (
    <div
      className={rootClass(className)}
      data-format="markdown"
      data-mode={currentMode}
      // Mirror the image / code viewers: stamp `data-src` when the source is
      // a string so consumers can pick it out without poking at refs.
      {...(typeof src === "string" ? { "data-src": src } : {})}
      data-state={state}
      style={{ ...baseStyle, ...style }}
    >
      {showHeader && (
        <MarkdownHeaderShell
          background={headerBackground}
          foreground={headerForeground}
          style={headerStyle}
        >
          {showTitle && <MarkdownTitle name={title} style={headerTitleStyle} />}
          {/* The mode toggle lives directly to the right of the filename —
              the user requested this specifically. The action cluster on
              the far right (download) is muted via `display: contents` so
              it shares the toolbar rhythm with the other viewers. */}
          {showModeToggle && (
            <div
              style={{
                color: "color-mix(in srgb, currentColor 65%, transparent)",
              }}
            >
              <MarkdownModeToggle
                mode={currentMode}
                onChange={handleModeChange}
                disabled={state !== "ready"}
              />
            </div>
          )}
          <div
            style={{
              display: "contents",
              color: "color-mix(in srgb, currentColor 65%, transparent)",
            }}
          >
            <div style={{ flex: 1 }} />
            {showZoomControls && (
              <DocumentZoomControls
                zoom={zoom}
                onZoom={applyZoom}
                // Zoom only meaningfully applies to the rendered preview.
                // In code mode the embedded HeySnapCodeViewer owns its own
                // font-size cluster (currently hidden behind its header);
                // we disable here so the badge doesn't lie about a state
                // the user can't see.
                disabled={state !== "ready" || currentMode !== "preview"}
              />
            )}
            {/* Word-wrap toggle is meaningful only in code mode — the
                preview already wraps. We render it conditionally rather
                than disabled so the chrome reads as "no toggle exists
                here" rather than "broken toggle." */}
            {currentMode === "code" && (
              <CodeWordWrapButton
                wrapped={wordWrap === "on"}
                onChange={(next) => setWordWrap(next ? "on" : "off")}
                disabled={state !== "ready"}
              />
            )}
            {showDownloadButton && resolved && <MarkdownDownloadButton resolved={resolved} />}
          </div>
        </MarkdownHeaderShell>
      )}
      {body}
    </div>
  );

  if (error) {
    return renderShell(
      "error",
      <p style={{ padding: 16, color: "#b00020" }}>Failed to load markdown: {error.message}</p>,
    );
  }

  if (!resolved) {
    return renderShell(
      "loading",
      loadingIndicator ?? <p style={{ padding: 16, color: "#666" }}>Loading markdown…</p>,
    );
  }

  // Code mode: hand the resolved text to HeySnapCodeViewer with its header
  // hidden — our own header already shows the filename, mode toggle, and
  // download button, and we don't want two stacked toolbars. We wrap the
  // text in a synthetic .md File so the code viewer's language inference
  // picks up `markdown`.
  if (currentMode === "code") {
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
        <HeySnapCodeViewer
          // Bump on src changes so the editor starts fresh — matches the
          // remount behavior the code viewer applies internally.
          key={version}
          src={makeMarkdownFile(resolved.text, resolved.name)}
          language="markdown"
          showHeader={false}
          // Honour the consumer's body background here too so the inner
          // editor pane matches the surrounding preview surface.
          bodyBackground={bodyBackground}
          // Word-wrap is owned by our outer header's toggle. We pass it
          // controlled and listen for changes via `onWordWrapChange` —
          // this also covers the case where the embedded viewer ever
          // exposes wrap state internally (it doesn't, given we hide its
          // header, but the contract stays clean).
          wordWrap={wordWrap}
          onWordWrapChange={setWordWrap}
          onReady={onReady}
          onError={onError}
          // Forward the consumer's Monaco theme so dark mode plumbs through;
          // omitting `theme` lets HeySnapCodeViewer pick its own default
          // (currently `"heysnap-light"`).
          {...(codeTheme ? { theme: codeTheme } : {})}
        />
      </div>,
    );
  }

  // Preview mode: react-markdown rendering inside a scrollable surface.
  // The 72ch cap keeps long-line markdown readable on wide containers —
  // canonical "comfortable reading" measure.
  const previewClass = [MARKDOWN_PREVIEW_CLASS, previewClassName].filter(Boolean).join(" ");
  return renderShell(
    "ready",
    <div
      style={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        background: bodyBackground,
        overflow: "auto",
        ...bodyStyle,
      }}
    >
      <div
        className={previewClass}
        style={{
          maxWidth: "72ch",
          margin: "0 auto",
          padding: previewPadding,
          // Host font — the scoped stylesheet uses `inherit` so this
          // propagates into every element. System fonts read crisply on
          // both light and dark surfaces and we don't pull a font import.
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
          // Zoom drives the root font-size; the em-based stylesheet then
          // scales the entire prose ladder (headings, list indents,
          // tables, code blocks) in proportion. `maxWidth: 72ch` is also
          // font-size-relative, so the column widens to keep the same
          // measure at any zoom level.
          fontSize: 15 * zoom,
          lineHeight: 1.6,
          color: "inherit",
          // `min-width: 0` so wide preformatted blocks don't push the
          // container past its parent's width.
          minWidth: 0,
        }}
      >
        <ReadyAfterPaint onReady={onReady} readyKey={version} />
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={mergedComponents}>
          {resolved.text}
        </ReactMarkdown>
      </div>
    </div>,
  );
}

/**
 * Build a `File` from in-memory markdown text. We use it to plumb the
 * resolved markdown through `HeySnapCodeViewer`'s polymorphic `src` without
 * exposing the wrapper format publicly — the file's `.name` propagates to
 * the code viewer's title slot and (more importantly) drives its language
 * inference. Falling back to a Blob keeps things working in any future
 * environment where the `File` constructor isn't available.
 */
function makeMarkdownFile(text: string, name: string): File | Blob {
  const safeName = name.endsWith(".md") || name.endsWith(".markdown") ? name : `${name}.md`;
  try {
    if (typeof File !== "undefined") {
      return new File([text], safeName, { type: "text/markdown" });
    }
  } catch {
    // Older Safari versions throw on `new File()` with certain inputs —
    // fall through to the Blob path which the code viewer also accepts.
  }
  return new Blob([text], { type: "text/markdown" });
}

function resolveMarkdownAssetUrl(src: string | undefined, assetBaseUrl: string | undefined): string | undefined {
  if (src === undefined || assetBaseUrl === undefined || !isRelativeMarkdownAssetUrl(src)) {
    return src;
  }

  try {
    const documentBase = typeof window !== "undefined" && typeof window.location?.href === "string"
      ? window.location.href
      : "http://localhost/";
    const base = assetBaseUrl.endsWith("/") ? assetBaseUrl : `${assetBaseUrl}/`;
    return new URL(src, new URL(base, documentBase)).toString();
  } catch {
    return src;
  }
}

function isRelativeMarkdownAssetUrl(src: string): boolean {
  const trimmed = src.trim();

  return (
    trimmed.length > 0 &&
    !trimmed.startsWith("#") &&
    !trimmed.startsWith("/") &&
    !trimmed.startsWith("?") &&
    !trimmed.startsWith("//") &&
    !/^[a-z][a-z\d+.-]*:/iu.test(trimmed)
  );
}
