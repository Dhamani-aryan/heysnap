import { useEffect, useId, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { createPluginRegistration } from "@embedpdf/core";
import { EmbedPDF } from "@embedpdf/core/react";
import { usePdfiumEngine } from "@embedpdf/engines/react";
import { Viewport, ViewportPluginPackage } from "@embedpdf/plugin-viewport/react";
import { Scroller, ScrollPluginPackage } from "@embedpdf/plugin-scroll/react";
import {
  DocumentContent,
  DocumentManagerPluginPackage,
} from "@embedpdf/plugin-document-manager/react";
import { RenderPluginPackage } from "@embedpdf/plugin-render/react";
import { ZoomPluginPackage } from "@embedpdf/plugin-zoom/react";
import {
  GlobalPointerProvider,
  InteractionManagerPluginPackage,
} from "@embedpdf/plugin-interaction-manager/react";
import { ThumbnailPluginPackage } from "@embedpdf/plugin-thumbnail/react";
import { PanPluginPackage } from "@embedpdf/plugin-pan/react";

import type { BaseViewerProps } from "../../types";
import { ReadyAfterPaint } from "../../_internal/previewReady";
import { useResolvedPdfSource, type HeySnapPdfSrc } from "./useResolvedPdfSource";
import {
  PdfDownloadButton,
  PdfHeaderGroup,
  PdfHeaderShell,
  PdfInteractionTools,
  PdfReloadButton,
  PdfSidebarButton,
  PdfZoomPicker,
} from "./PdfViewerHeader";
import { PdfSidebar } from "./PdfSidebar";
import { PdfPageBox } from "./PdfPageBox";

export type { HeySnapPdfSrc } from "./useResolvedPdfSource";

export interface HeySnapPdfViewerProps extends Omit<BaseViewerProps, "src"> {
  /**
   * The PDF to display. Accepts a URL string, a `File` from a file input,
   * a raw `Blob`, or an `ArrayBuffer`/`Uint8Array` of PDF bytes.
   */
  src: HeySnapPdfSrc;

  // ── Header / toolbar ─────────────────────────────────────────────────
  /** Hide the toolbar entirely. @default true */
  showHeader?: boolean;
  /** Toolbar background. @default "#fafafa" */
  headerBackground?: string;
  /** Toolbar foreground; also drives hover/active tints. @default "#1f1f1f" */
  headerForeground?: string;
  /** Escape hatch — styles merged onto the toolbar `<header>`. */
  headerStyle?: CSSProperties;
  /** @deprecated The PDF toolbar no longer renders a filename. */
  headerTitleStyle?: CSSProperties;

  // ── Body / page gutter ───────────────────────────────────────────────
  /** Background behind/around the rendered pages. @default "#e9eaed" */
  bodyBackground?: string;
  /** Escape hatch — styles merged onto the scrollable viewport. */
  bodyStyle?: CSSProperties;

  // ── Sidebar (page thumbnails) ────────────────────────────────────────
  /** Whether the thumbnail sidebar starts open. @default false */
  defaultSidebarOpen?: boolean;
  /** Sidebar background. @default "#f5f5f7" */
  sidebarBackground?: string;
  /** Sidebar width in px when open. @default 180 */
  sidebarWidth?: number;
  /** Escape hatch — styles merged onto the sidebar `<aside>`. */
  sidebarStyle?: CSSProperties;
}

const rootClass = (extra?: string) =>
  ["heysnap-viewer", "heysnap-viewer--pdf", extra].filter(Boolean).join(" ");

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
  sidebarBackground: "#f5f5f7",
  sidebarWidth: 180,
} as const;

/**
 * Renders a PDF document using the EmbedPDF headless React engine.
 *
 * The viewer remounts cleanly whenever `src` changes, so feeding a new
 * `File` from a file picker (or swapping URLs) just works.
 */
export function HeySnapPdfViewer({
  src,
  className,
  style,
  onReady,
  onError,

  showHeader = true,
  headerBackground = DEFAULTS.headerBackground,
  headerForeground = DEFAULTS.headerForeground,
  headerStyle,

  bodyBackground = DEFAULTS.bodyBackground,
  bodyStyle,

  defaultSidebarOpen = false,
  sidebarBackground = DEFAULTS.sidebarBackground,
  sidebarWidth = DEFAULTS.sidebarWidth,
  sidebarStyle,
}: HeySnapPdfViewerProps) {
  const { resolved, error, version } = useResolvedPdfSource(src);
  const { engine, isLoading: engineLoading } = usePdfiumEngine();

  const sidebarId = useId();
  const [sidebarOpen, setSidebarOpen] = useState(defaultSidebarOpen);

  const plugins = useMemo(() => {
    if (!resolved) return null;
    const initialDocuments =
      resolved.kind === "url"
        ? [{ url: resolved.url }]
        : [{ buffer: resolved.buffer, name: resolved.name }];

    return [
      createPluginRegistration(DocumentManagerPluginPackage, { initialDocuments }),
      createPluginRegistration(InteractionManagerPluginPackage),
      createPluginRegistration(ZoomPluginPackage),
      createPluginRegistration(ViewportPluginPackage),
      createPluginRegistration(ScrollPluginPackage),
      createPluginRegistration(RenderPluginPackage),
      createPluginRegistration(ThumbnailPluginPackage, { width: 120, gap: 12, labelHeight: 18 }),
      // Cursor is the implicit default — pan only engages when the user
      // explicitly clicks the hand tool, so we set `defaultMode: 'never'`.
      createPluginRegistration(PanPluginPackage, { defaultMode: "never" }),
    ];
  }, [resolved]);

  useEffect(() => {
    if (error) onError?.(error);
  }, [error, onError]);

  const reloadPreview = () => window.location.reload();

  // Wraps every render branch so the toolbar is visually consistent across
  // loading / error / ready states. Header contents vary; the chrome doesn't.
  const renderShell = (
    state: "loading" | "error" | "ready",
    body: ReactNode,
    header?: ReactNode,
  ) => (
    <div
      className={rootClass(className)}
      data-format="pdf"
      data-state={state}
      style={{ ...baseStyle, ...style }}
    >
      {showHeader && (
        <PdfHeaderShell
          background={headerBackground}
          foreground={headerForeground}
          style={headerStyle}
        >
          {header ?? (
            <>
              <PdfHeaderGroup align="left">
                <PdfReloadButton onReload={reloadPreview} />
              </PdfHeaderGroup>
              <PdfHeaderGroup align="right" />
            </>
          )}
        </PdfHeaderShell>
      )}
      {body}
    </div>
  );

  if (error) {
    return renderShell(
      "error",
      <p style={{ padding: 16, color: "#b00020" }}>Failed to load PDF: {error.message}</p>,
    );
  }

  if (engineLoading || !engine || !plugins || !resolved) {
    return renderShell("loading", <p style={{ padding: 16, color: "#666" }}>Loading PDF…</p>);
  }

  return (
    <div
      className={rootClass(className)}
      data-format="pdf"
      data-state="ready"
      style={{ ...baseStyle, ...style }}
    >
      <EmbedPDF key={version} engine={engine} plugins={plugins}>
        {({ activeDocumentId }) => (
          <>
            {showHeader && (
              <PdfHeaderShell
                background={headerBackground}
                foreground={headerForeground}
                style={headerStyle}
              >
                <PdfHeaderGroup align="left">
                  <PdfReloadButton onReload={reloadPreview} />
                  <PdfSidebarButton
                    isSidebarOpen={sidebarOpen}
                    onToggleSidebar={() => setSidebarOpen((o) => !o)}
                    sidebarId={sidebarId}
                  />
                </PdfHeaderGroup>
                <PdfHeaderGroup align="right">
                  {activeDocumentId && <PdfInteractionTools documentId={activeDocumentId} />}
                  {activeDocumentId && (
                    <PdfZoomPicker
                      background={headerBackground}
                      foreground={headerForeground}
                      documentId={activeDocumentId}
                    />
                  )}
                  <PdfDownloadButton resolved={resolved} />
                </PdfHeaderGroup>
              </PdfHeaderShell>
            )}

            {activeDocumentId && (
              // GlobalPointerProvider renders a real <div>, so we treat it
              // as our body flex-row directly — that keeps the height chain
              // intact (it's a flex child of the viewer root and must grow
              // to fill remaining space).
              <GlobalPointerProvider
                documentId={activeDocumentId}
                style={{
                  display: "flex",
                  flex: 1,
                  minHeight: 0,
                  color: headerForeground,
                  // Clip the sliding aside so its negative margin doesn't
                  // visibly poke out of the viewer's left edge.
                  overflow: "hidden",
                }}
              >
                <PdfSidebar
                  documentId={activeDocumentId}
                  id={sidebarId}
                  open={sidebarOpen}
                  background={sidebarBackground}
                  width={sidebarWidth}
                  style={sidebarStyle}
                />

                <DocumentContent documentId={activeDocumentId}>
                  {({ isLoaded }) =>
                    isLoaded && (
                      <Viewport
                        documentId={activeDocumentId}
                        style={{
                          flex: 1,
                          minHeight: 0,
                          minWidth: 0,
                          width: "100%",
                          background: bodyBackground,
                          ...bodyStyle,
                        }}
                      >
                        <Scroller
                          documentId={activeDocumentId}
                          renderPage={({ width, height, pageIndex }) => (
                            <PdfPageBox
                              documentId={activeDocumentId}
                              pageIndex={pageIndex}
                              width={width}
                              height={height}
                            />
                          )}
                        />
                      </Viewport>
                    )
                  }
                </DocumentContent>
              </GlobalPointerProvider>
            )}
            {activeDocumentId ? (
              <ReadyAfterPaint
                onReady={onReady}
                readyKey={`${String(version)}:${activeDocumentId}`}
              />
            ) : null}
          </>
        )}
      </EmbedPDF>
    </div>
  );
}
