import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { renderAsync } from "docx-preview";

import type { BaseViewerProps } from "../../types";
import { ReadyAfterPaint } from "../../_internal/previewReady";
import { useResolvedDocxSource, type HeySnapDocxSrc } from "./useResolvedDocxSource";
import {
  DocxDownloadButton,
  DocxHeaderShell,
  DocxHeaderTitle,
  DocxZoomControls,
  clampZoom,
} from "./DocxViewerHeader";
import { ensureDocxThemeStyles } from "./docxThemeStyles";

export type { HeySnapDocxSrc } from "./useResolvedDocxSource";

/**
 * Props for {@link HeySnapDocxViewer}. Every visual property has a sane
 * default — in practice only `src` is required.
 *
 * Color props (`headerBackground`, `headerForeground`, `bodyBackground`)
 * are exposed as CSS custom properties on the wrapper, which the injected
 * theme stylesheet maps onto `docx-preview`'s `.docx-wrapper` / `.docx`
 * surfaces (see {@link ensureDocxThemeStyles}).
 */
export interface HeySnapDocxViewerProps extends Omit<BaseViewerProps, "src"> {
  /**
   * The DOCX to display. Accepts a URL string (fetched on mount), a `File`
   * from a file input, a `Blob`, an `ArrayBuffer`, or a `Uint8Array`.
   */
  src: HeySnapDocxSrc;

  // ── Header / toolbar ─────────────────────────────────────────────────
  /** Hide the toolbar entirely. @default true */
  showHeader?: boolean;
  /** Toolbar background. @default "#ffffff" */
  headerBackground?: string;
  /** Toolbar foreground. @default "#15171c" */
  headerForeground?: string;
  /** Escape hatch — styles merged onto the toolbar `<header>`. */
  headerStyle?: CSSProperties;
  /** Styles merged onto the filename text in the toolbar. */
  headerTitleStyle?: CSSProperties;

  // ── Body / page gutter ───────────────────────────────────────────────
  /**
   * Background behind/around the rendered pages.
   * @default "#e9eaed"
   */
  bodyBackground?: string;
  /** Escape hatch — styles merged onto the rendered-document wrapper. */
  bodyStyle?: CSSProperties;

  // ── Page chrome ──────────────────────────────────────────────────────
  /**
   * Render headers/footers from the DOCX. @default true
   */
  renderHeadersFooters?: boolean;
  /**
   * Render footnotes/endnotes. @default true
   */
  renderNotes?: boolean;
  /**
   * Break the document into discrete pages (otherwise renders as a
   * continuous flow). @default true
   */
  breakPages?: boolean;
  /**
   * Draw a faint outline around the page-margin box. The underlying lib
   * doesn't expose a margin guide — we paint our own outline via CSS when
   * this is enabled.
   * @default false
   */
  showMarginGuides?: boolean;
  /** Color of the margin guides when shown. @default "#c0c0c0" */
  marginGuideColor?: string;
  /** Initial zoom level — `1.0` is 100%. @default 1.0 */
  initialZoom?: number;

  // ── Misc ─────────────────────────────────────────────────────────────
  /** Override the document name shown in the toolbar. Defaults to the resolved filename. */
  documentName?: string;
  /** Slot for a custom loading indicator while the buffer resolves. */
  loadingIndicator?: ReactNode;

  // ── Deprecated (kept for API compat with prior versions) ─────────────
  /**
   * @deprecated The new underlying renderer (`docx-preview`) has no ruler;
   * this prop is accepted for back-compat but has no effect.
   */
  showRuler?: boolean;
  /**
   * @deprecated See {@link showRuler}.
   */
  rulerUnit?: "inch" | "cm";
}

const rootClass = (extra?: string) =>
  ["heysnap-viewer", "heysnap-viewer--docx", extra].filter(Boolean).join(" ");

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
  bodyBackground: "#e9eaed",
} as const;

/**
 * Read-only DOCX viewer.
 *
 * Renders the document client-side via `docx-preview`
 * (https://github.com/VolodymyrBaydalka/docxjs) and layers a compact,
 * PDF-viewer-style toolbar on top (filename · zoom · download). Accepts
 * URLs, files, blobs, or raw buffers, and themes cleanly in both light
 * and dark modes via the `headerBackground` / `headerForeground` /
 * `bodyBackground` props.
 *
 * The viewer remounts cleanly whenever `src` changes — feeding a new file
 * from a picker or swapping URLs just works.
 *
 * @example
 * ```tsx
 * import { HeySnapDocxViewer } from "./components/viewers/HeySnapDocxViewer";
 *
 * <HeySnapDocxViewer src="/specs/release-notes.docx" />
 *
 * // Dark mode:
 * <HeySnapDocxViewer
 *   src={file}
 *   headerBackground="#1f242c"
 *   headerForeground="#e6e8eb"
 *   bodyBackground="#0b0e13"
 * />
 * ```
 */
export function HeySnapDocxViewer({
  src,
  className,
  style,
  onReady,
  onError,

  showHeader = true,
  headerBackground = DEFAULTS.headerBackground,
  headerForeground = DEFAULTS.headerForeground,
  headerStyle,
  headerTitleStyle,

  bodyBackground = DEFAULTS.bodyBackground,
  bodyStyle,

  renderHeadersFooters = true,
  renderNotes = true,
  breakPages = true,
  showMarginGuides = false,
  marginGuideColor = "#c0c0c0",
  initialZoom = 1.0,

  documentName,
  loadingIndicator,
}: HeySnapDocxViewerProps) {
  const { resolved, error, version } = useResolvedDocxSource(src);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(() => clampZoom(initialZoom));
  const [renderError, setRenderError] = useState<Error | null>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    if (error) onError?.(error);
  }, [error, onError]);

  useEffect(() => {
    if (renderError) onError?.(renderError);
  }, [renderError, onError]);

  // Inject the theme-override stylesheet once per page.
  useEffect(() => {
    ensureDocxThemeStyles();
  }, []);

  // Reset zoom whenever the source remounts (new file / URL).
  useEffect(() => {
    setZoom(clampZoom(initialZoom));
  }, [version, initialZoom]);

  // Drive `docx-preview` whenever the buffer is ready. We render into the
  // same container ref every time — `renderAsync` clears it for us before
  // emitting new nodes, but we also clear on cleanup so a re-render in the
  // middle of an async call never leaves dangling DOM behind.
  useEffect(() => {
    if (!resolved) return;
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    setRendered(false);
    setRenderError(null);

    // `renderAsync` accepts ArrayBuffer/Blob/Uint8Array. We feed it a
    // Blob so the lib can read it without an extra copy.
    const blob = new Blob([resolved.buffer], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    renderAsync(blob, container, undefined, {
      // Class root for our theme overrides (`.heysnap-docx-render`).
      className: "heysnap-docx-render",
      inWrapper: true,
      ignoreWidth: false,
      ignoreHeight: false,
      ignoreFonts: false,
      breakPages,
      ignoreLastRenderedPageBreak: true,
      experimental: true,
      trimXmlDeclaration: true,
      useBase64URL: false,
      renderHeaders: renderHeadersFooters,
      renderFooters: renderHeadersFooters,
      renderFootnotes: renderNotes,
      renderEndnotes: renderNotes,
      renderChanges: false,
      debug: false,
    })
      .then(() => {
        if (cancelled) return;
        setRendered(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setRenderError(err instanceof Error ? err : new Error(String(err)));
      });

    return () => {
      cancelled = true;
      // Clear the container so the next render starts from a clean slate
      // even if the previous `renderAsync` is still in flight.
      container.replaceChildren();
    };
  }, [resolved, version, breakPages, renderHeadersFooters, renderNotes]);

  // Custom properties consumed by the injected theme stylesheet.
  const themeVars = {
    "--hs-doc-bg": bodyBackground,
    "--hs-doc-text": headerForeground,
    "--hs-doc-margin-guide": showMarginGuides ? marginGuideColor : "transparent",
  } as CSSProperties;

  const renderShell = (
    state: "loading" | "error" | "ready",
    body: ReactNode,
    header?: ReactNode,
  ) => (
    <div
      className={rootClass(className)}
      data-format="docx"
      data-state={state}
      style={{ ...baseStyle, ...themeVars, ...style }}
    >
      {showHeader && (
        <DocxHeaderShell
          background={headerBackground}
          foreground={headerForeground}
          style={headerStyle}
        >
          {header}
        </DocxHeaderShell>
      )}
      {body}
    </div>
  );

  const onZoom = useCallback((next: number) => {
    setZoom(clampZoom(next));
  }, []);

  // Buffer fetch error.
  if (error) {
    return renderShell(
      "error",
      <p style={{ padding: 16, color: "#b00020" }}>Failed to load DOCX: {error.message}</p>,
    );
  }

  // Buffer still resolving.
  if (!resolved) {
    return renderShell(
      "loading",
      loadingIndicator ?? <p style={{ padding: 16, color: "#666" }}>Loading DOCX…</p>,
    );
  }

  const title = documentName ?? resolved.name;

  return (
    <div
      className={rootClass(className)}
      data-format="docx"
      data-state={renderError ? "error" : rendered ? "ready" : "loading"}
      style={{ ...baseStyle, ...themeVars, ...style }}
    >
      {showHeader && (
        <DocxHeaderShell
          background={headerBackground}
          foreground={headerForeground}
          style={headerStyle}
        >
          <DocxHeaderTitle title={title} titleStyle={headerTitleStyle} />
          {/* Icon cluster tinted to a softer `currentColor` shade — same
              treatment the XLSX/PDF viewers use to make the filename the
              focal element of the header. */}
          <div
            style={{
              display: "contents",
              color: "color-mix(in srgb, currentColor 65%, transparent)",
            }}
          >
            <div style={{ flex: 1 }} />
            <DocxZoomControls zoom={zoom} onZoom={onZoom} />
            <DocxDownloadButton resolved={resolved} />
          </div>
        </DocxHeaderShell>
      )}

      <div
        // Scroll container. We paint the gutter color here so the
        // background is correct even before `renderAsync` resolves.
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          background: bodyBackground,
          color: headerForeground,
          ...bodyStyle,
        }}
      >
        {rendered && renderError === null ? (
          <ReadyAfterPaint onReady={onReady} readyKey={version} />
        ) : null}
        {renderError && (
          <p style={{ padding: 16, color: "#b00020" }}>
            Failed to render DOCX: {renderError.message}
          </p>
        )}
        <div
          // The element `docx-preview` paints into. `renderAsync` injects
          // a `.docx-wrapper` child here; we scale the whole subtree via
          // the CSS `zoom` property — unlike `transform: scale()` it
          // re-flows the layout, so scrollbars stay accurate at every
          // magnification.
          ref={containerRef}
          data-testid="heysnap-docx-render-root"
          className="heysnap-docx-render-root"
          style={{ zoom }}
        />
      </div>
    </div>
  );
}
