import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type SyntheticEvent,
} from "react";

import type { BaseViewerProps } from "../../types";
import { useResolvedImageSource, type HeySnapImageSrc } from "./useResolvedImageSource";
import {
  clampZoom,
  ImageDownloadButton,
  ImageHeaderGroup,
  ImageHeaderShell,
  ImageReloadButton,
  ImageZoomPicker,
} from "./ImageViewerHeader";

export type { HeySnapImageSrc } from "./useResolvedImageSource";

/**
 * Props for {@link HeySnapImageViewer}. Every visual property has a sane
 * default — in practice only `src` is required.
 */
export interface HeySnapImageViewerProps extends Omit<BaseViewerProps, "src"> {
  /**
   * The image to display. Accepts a URL string, a `File` from a file input,
   * a `Blob`, an `ArrayBuffer`, or a `Uint8Array` of image bytes.
   */
  src: HeySnapImageSrc;

  // ── Header / toolbar ─────────────────────────────────────────────────
  /** Hide the toolbar entirely. @default true */
  showHeader?: boolean;
  /** Toolbar background. @default "#fafafa" */
  headerBackground?: string;
  /** Toolbar foreground; also drives hover/active tints. @default "#1f1f1f" */
  headerForeground?: string;
  /** Escape hatch — styles merged onto the toolbar `<header>`. */
  headerStyle?: CSSProperties;
  /** @deprecated The image toolbar no longer renders a filename. */
  headerTitleStyle?: CSSProperties;

  /** @deprecated The image toolbar no longer renders a filename. */
  showTitle?: boolean;
  /** Show the zoom level picker on the right side of the toolbar. @default true */
  showZoomControls?: boolean;
  /** Show the download button on the right side of the toolbar. @default true */
  showDownloadButton?: boolean;

  // ── Body ────────────────────────────────────────────────────────────
  /** Background painted around the image. @default "#e9eaed" */
  bodyBackground?: string;
  /** Escape hatch — styles merged onto the scrollable body. */
  bodyStyle?: CSSProperties;
  /** Styles merged onto the rendered `<img>` element. */
  imageStyle?: CSSProperties;
  /** `alt` text for the rendered image. Defaults to the resolved filename. */
  alt?: string;

  // ── Misc ────────────────────────────────────────────────────────────
  /** Override the document name used for default alt text. */
  documentName?: string;
  /** Slot for a custom loading indicator while the image decodes. */
  loadingIndicator?: ReactNode;
  /**
   * Called when the image fails to load (404, decoding error, unsupported
   * format, unreadable buffer). The viewer surfaces a default error UI on
   * its own; use this for analytics / toasts.
   */
  onError?: (error: Error) => void;
}

const rootClass = (extra?: string) =>
  ["heysnap-viewer", "heysnap-viewer--image", extra].filter(Boolean).join(" ");

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
 * Read-only image viewer with a fit-to-window default and explicit zoom
 * controls. Renders the file via the platform's native `<img>` so format
 * support tracks whatever the browser supports (PNG / JPEG / GIF / WebP /
 * AVIF / SVG / …). Loads, decode, and CORS all delegate to the browser.
 *
 * Zoom is layout-based: the rendered `<img>` is sized to `natural × scale`
 * (rather than using `transform: scale()`) so the `overflow: auto` body
 * produces accurate scrollbars when the scaled image exceeds the viewport.
 * Below the fit threshold the image is centered inside an explicit scroll
 * canvas. A `data-src` attribute is stamped on the root for string sources
 * so consumers can identify the source without poking at refs.
 */
export function HeySnapImageViewer({
  src,
  className,
  style,

  showHeader = true,
  headerBackground = DEFAULTS.headerBackground,
  headerForeground = DEFAULTS.headerForeground,
  headerStyle,

  showZoomControls = true,
  showDownloadButton = true,

  bodyBackground = DEFAULTS.bodyBackground,
  bodyStyle,
  imageStyle,
  alt,

  documentName,
  loadingIndicator,
  onReady,
  onError,
}: HeySnapImageViewerProps) {
  const { resolved, error: resolveError, version } = useResolvedImageSource(src);

  // Decode errors are reported by the `<img>` element itself and are
  // separate from `src` resolution failures (which already include things
  // like "unsupported src shape"). Both feed into the same shell branch but
  // we keep them apart so a fresh `src` clears the decode error cleanly.
  const [decodeError, setDecodeError] = useState<Error | null>(null);
  const error = resolveError ?? decodeError;

  // Stable ref so the effect can call the latest `onError` without
  // depending on it (avoids re-firing on every parent rerender).
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const readyVersionRef = useRef<number | null>(null);

  useEffect(() => {
    setDecodeError(null);
  }, [version]);

  useEffect(() => {
    if (resolveError) onErrorRef.current?.(resolveError);
  }, [resolveError]);

  // Zoom state. 1.0 means "image at the size determined by fit-to-window";
  // the actual pixel scale therefore depends on `naturalSize` + container
  // size, computed in the body below. Resetting to 1 on every `src` change
  // matches the way every other document viewer in the library behaves.
  const [zoom, setZoom] = useState<number>(1);

  // Natural image size, captured from the `<img>` once it decodes. Drives
  // both the wrapper's footprint and the fit-to-window math. We reset it
  // alongside `zoom` so a new `src` doesn't briefly render at the previous
  // image's dimensions while the next decode is still in flight.
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    setZoom(1);
    setNaturalSize(null);
    setBodySize(null);
  }, [version]);

  const applyZoom = (next: number) => setZoom(clampZoom(next));
  const reloadPreview = () => window.location.reload();

  const handleLoad = (e: SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    }
  };

  const handleError = () => {
    const err = new Error("Image failed to load.");
    setDecodeError(err);
    onErrorRef.current?.(err);
  };

  // Track the scrollable body size so we can compute a "fit-to-window" base
  // scale and keep the image centered when it's smaller than the viewport.
  // ResizeObserver gives us a single subscription that fires on container
  // resizes without us needing window resize listeners (which would miss
  // flex/grid reflow when only the viewer's column changes).
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [bodySize, setBodySize] = useState<{ w: number; h: number } | null>(null);

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    setBodySize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const cr = entry.contentRect;
      setBodySize({ w: cr.width, h: cr.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [resolved?.url]);

  useEffect(() => {
    if (error || !naturalSize || !bodySize || readyVersionRef.current === version) return;
    readyVersionRef.current = version;
    const frame = window.requestAnimationFrame(() => onReadyRef.current?.());
    return () => window.cancelAnimationFrame(frame);
  }, [bodySize, error, naturalSize, version]);

  // Effective scale at zoom=1: fit the natural-size image entirely inside
  // the body, never up-scaling past 1× so a tiny icon doesn't get blown up
  // to fill a giant pane. Falls back to 1 until we have measurements.
  const fitScale = (() => {
    if (!naturalSize || !bodySize || bodySize.w === 0 || bodySize.h === 0) return 1;
    const sx = bodySize.w / naturalSize.w;
    const sy = bodySize.h / naturalSize.h;
    return Math.min(sx, sy, 1);
  })();

  // Final pixel scale: fit-scale × user zoom. Both factors are non-zero in
  // practice but clamp via clampZoom() in case a bad value sneaks in.
  const renderScale = fitScale * zoom;

  // ── Render ──────────────────────────────────────────────────────────
  const title = documentName || resolved?.name || "";

  const renderShell = (state: "loading" | "error" | "ready", body: ReactNode) => (
    <div
      className={rootClass(className)}
      data-format="image"
      // Preserve the original `src` on the root only when it's a string —
      // binary sources don't have a stable identifier to stamp here, and
      // an object URL would expose an internal detail. The scaffold test
      // exercises the string path, so this also keeps that test happy.
      {...(typeof src === "string" ? { "data-src": src } : {})}
      data-state={state}
      style={{ ...baseStyle, ...style }}
    >
      {showHeader && (
        <ImageHeaderShell
          background={headerBackground}
          foreground={headerForeground}
          style={headerStyle}
        >
          <ImageHeaderGroup align="left">
            <ImageReloadButton onReload={reloadPreview} />
          </ImageHeaderGroup>
          <ImageHeaderGroup align="right">
            {showZoomControls && (
              <ImageZoomPicker
                background={headerBackground}
                foreground={headerForeground}
                zoom={zoom}
                onZoom={applyZoom}
                disabled={state !== "ready"}
              />
            )}
            {showDownloadButton && resolved && <ImageDownloadButton resolved={resolved} />}
          </ImageHeaderGroup>
        </ImageHeaderShell>
      )}
      {body}
    </div>
  );

  if (error) {
    return renderShell(
      "error",
      <p style={{ padding: 16, color: "#b00020" }}>Failed to load image: {error.message}</p>,
    );
  }

  if (!resolved) {
    return renderShell(
      "loading",
      loadingIndicator ?? <p style={{ padding: 16, color: "#666" }}>Loading image…</p>,
    );
  }

  // The body acts as the scroll container. The inner wrapper is sized to the
  // larger of the viewport and the displayed image so scrollbars always start
  // at the true top-left edge while smaller images remain centered.
  const displayW = naturalSize ? naturalSize.w * renderScale : undefined;
  const displayH = naturalSize ? naturalSize.h * renderScale : undefined;
  const hasDisplaySize = displayW !== undefined && displayH !== undefined;
  const bodyW = bodySize?.w ?? 0;
  const bodyH = bodySize?.h ?? 0;
  const measuredDisplayW = displayW ?? 0;
  const measuredDisplayH = displayH ?? 0;
  const contentW = hasDisplaySize ? Math.max(measuredDisplayW, bodyW) : "100%";
  const contentH = hasDisplaySize ? Math.max(measuredDisplayH, bodyH) : "100%";
  const imageOffsetX = hasDisplaySize ? Math.max((bodyW - measuredDisplayW) / 2, 0) : 0;
  const imageOffsetY = hasDisplaySize ? Math.max((bodyH - measuredDisplayH) / 2, 0) : 0;

  // `data-state="ready"` is set as soon as the source resolves; the image
  // itself may still be decoding. Listeners read `onLoad` / `onError` for
  // the finer-grained state.
  const state: "loading" | "error" | "ready" = decodeError
    ? "error"
    : naturalSize
      ? "ready"
      : "loading";

  return renderShell(
    state,
    <div
      ref={bodyRef}
      style={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        background: bodyBackground,
        overflow: "auto",
        display: "block",
        ...bodyStyle,
      }}
    >
      <div
        // The wrapper is an explicit scrollable canvas. Flex-centering inside
        // an overflow container can hide the start edge of oversized images,
        // especially tall screenshots at high zoom.
        style={{
          position: "relative",
          width: contentW,
          height: contentH,
          minWidth: "100%",
          minHeight: "100%",
        }}
      >
        <img
          key={resolved.url}
          src={resolved.url}
          alt={alt ?? title}
          onLoad={handleLoad}
          onError={handleError}
          // `draggable=false` blocks the native drag-to-save ghost that
          // otherwise interferes with click-to-pan UX in scaled views.
          draggable={false}
          // Width/height drive the scale rather than `transform`, so the
          // scrollbar accurately reflects the scaled content's footprint.
          // Browsers pick a sensible filter automatically; SVGs ignore the
          // hint entirely, which is the right behavior for vector content.
          style={{
            display: "block",
            position: hasDisplaySize ? "absolute" : "static",
            left: hasDisplaySize ? imageOffsetX : undefined,
            top: hasDisplaySize ? imageOffsetY : undefined,
            width: displayW,
            height: displayH,
            maxWidth: "none",
            maxHeight: "none",
            userSelect: "none",
            ...imageStyle,
          }}
        />
      </div>
    </div>,
  );
}
