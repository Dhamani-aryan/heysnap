import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import type { BaseViewerProps } from "../../types";
import { readHashParam, writeHashParam } from "../../_internal/urlHashState";
import {
  useResolvedPPTSource,
  type HeySnapPPTSrc,
} from "./useResolvedPPTSource";
import { usePPTConversion } from "./usePPTConversion";
import {
  clampZoom,
  PPTDownloadButton,
  PPTHeaderLeft,
  PPTHeaderShell,
  PPTZoomControls,
} from "./PPTViewerHeader";
import { PPTSidebar } from "./PPTSidebar";

export type { HeySnapPPTSrc } from "./useResolvedPPTSource";
export type { SlideManifest, SlideManifestEntry } from "./usePPTConversion";

/**
 * Props for {@link HeySnapPPTViewer}. Mirrors the shape of `HeySnapXlsxViewer`
 * and `HeySnapPdfViewer` so consumers can swap any of the three viewers in
 * with minimal prop changes.
 */
export interface HeySnapPPTViewerProps extends Omit<BaseViewerProps, "src"> {
  /**
   * The PPTX to display. Accepts a URL string (fetched on mount), a `File`
   * from a file input, a `Blob`, an `ArrayBuffer`, or a `Uint8Array`.
   */
  src: HeySnapPPTSrc;

  /**
   * Base URL of the PPTX-to-images conversion server. The viewer POSTs
   * `<serverUrl>/convert/stream` with the PPTX as multipart, parses the
   * NDJSON manifest the server streams back, and then loads the slide
   * PNGs via plain `<img>` tags against `<serverUrl>/static/<jobId>/…`.
   * The reference implementation lives under `server/` in this repo;
   * consumers can point this at any service that speaks the same protocol.
   */
  serverUrl: string;

  // ── Header / toolbar ─────────────────────────────────────────────────
  /** Hide the toolbar entirely. @default true */
  showHeader?: boolean;
  /** Toolbar background. @default "#fafafa" */
  headerBackground?: string;
  /** Toolbar foreground. @default "#1f1f1f" */
  headerForeground?: string;
  /** Escape hatch — styles merged onto the toolbar `<header>`. */
  headerStyle?: CSSProperties;
  /** Styles merged onto the title span. */
  headerTitleStyle?: CSSProperties;

  /** Show the menu icon that toggles the sidebar. @default true */
  showSidebarToggle?: boolean;
  /** Show the presentation filename. @default true */
  showTitle?: boolean;
  /** Show the −/+ zoom controls on the right. @default true */
  showZoomControls?: boolean;
  /** Show the download button on the right. @default true */
  showDownloadButton?: boolean;

  // ── Body ────────────────────────────────────────────────────────────
  /** Background painted around the slide images. @default "#e9eaed" */
  bodyBackground?: string;
  /** Escape hatch — styles merged onto the main scroll wrapper. */
  bodyStyle?: CSSProperties;

  // ── Sidebar ─────────────────────────────────────────────────────────
  /**
   * Controlled open flag for the sidebar. When provided, the viewer follows
   * this value and calls `onSidebarOpenChange` when the menu icon is clicked.
   */
  sidebarOpen?: boolean;
  /** Initial open state when `sidebarOpen` is uncontrolled. @default true */
  defaultSidebarOpen?: boolean;
  /** Fired when the menu icon is clicked. */
  onSidebarOpenChange?: (open: boolean) => void;
  /** Sidebar background. @default "#f5f5f7" */
  sidebarBackground?: string;
  /** Sidebar width. @default 200 */
  sidebarWidth?: number;

  // ── Misc ────────────────────────────────────────────────────────────
  /** Override the document name shown in the header. */
  documentName?: string;
  /** Custom loading indicator while the upload/conversion runs. */
  loadingIndicator?: ReactNode;
  /** Called when fetch / upload / conversion fails. */
  onError?: (error: Error) => void;
}

const rootClass = (extra?: string) =>
  ["heysnap-viewer", "heysnap-viewer--ppt", extra].filter(Boolean).join(" ");

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
  sidebarWidth: 200,
} as const;

const SLIDE_PADDING = 20;
const WHEEL_FLUSH_MS = 90;
const WHEEL_PIXELS_PER_SLIDE = 320;
const slideHashParam = "slide";

/**
 * Image-stack PPTX viewer.
 *
 * Pipeline:
 *   1. The polymorphic `src` is normalized into a `File` (URL strings are
 *      fetched, buffers are wrapped).
 *   2. The file is uploaded to `<serverUrl>/convert/stream`. The server
 *      responds with NDJSON: a single `meta` event with the deck's
 *      dimensions + total slide count, then one `slide` event per page as
 *      that page's PNG becomes available, then `done`.
 *   3. As soon as `meta` lands, the viewer renders `slideCount` placeholder
 *      slots sized to the deck's native page dimensions (so the scroll
 *      height is correct from the start). Each slot fills in with its
 *      `<img>` as the slide URL arrives.
 *   4. A PDF-style sidebar shows numbered thumbnails; clicking one scrolls
 *      the main pane to the matching slide. An `IntersectionObserver`
 *      keeps the active-thumbnail ring in sync as the user scrolls.
 *   5. Zooming preserves the visible slide's scroll anchor (capture
 *      relative offset within the active slide before the zoom, restore
 *      it in a `useLayoutEffect` after React commits the new dimensions).
 */
export function HeySnapPPTViewer({
  src,
  className,
  style,

  serverUrl,

  showHeader = true,
  headerBackground = DEFAULTS.headerBackground,
  headerForeground = DEFAULTS.headerForeground,
  headerStyle,
  headerTitleStyle,

  showSidebarToggle = true,
  showTitle = true,
  showZoomControls = true,
  showDownloadButton = true,

  bodyBackground = DEFAULTS.bodyBackground,
  bodyStyle,

  sidebarOpen,
  defaultSidebarOpen = true,
  onSidebarOpenChange,
  sidebarBackground = DEFAULTS.sidebarBackground,
  sidebarWidth = DEFAULTS.sidebarWidth,

  documentName,
  loadingIndicator,
  onReady,
  onError,
}: HeySnapPPTViewerProps) {
  // ── Source resolution + conversion ──────────────────────────────────
  const { resolved, error: resolveError } = useResolvedPPTSource(src);
  const {
    manifest,
    slideUrls,
    error: conversionError,
    loading,
    done,
  } = usePPTConversion(resolved, serverUrl);
  const error = resolveError ?? conversionError;

  // Forward both error channels through `onError` for consumers that want
  // to surface analytics / toasts. Ref-stashed so the effect doesn't fire
  // on every parent render that passed a fresh inline arrow.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  useEffect(() => {
    if (error) onErrorRef.current?.(error);
  }, [error]);

  useEffect(() => {
    if (!manifest || !done || slideUrls.size < manifest.slideCount) {
      return;
    }

    let cancelled = false;
    let frame = 0;
    const urls = Array.from({ length: manifest.slideCount }, (_, index) =>
      slideUrls.get(index + 1),
    ).filter((url): url is string => typeof url === "string" && url.length > 0);

    void Promise.allSettled(urls.map(preloadImage)).then(() => {
      if (cancelled) {
        return;
      }

      frame = window.requestAnimationFrame(() => onReadyRef.current?.());
    });

    return () => {
      cancelled = true;
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [done, manifest, slideUrls]);

  // ── Controlled / uncontrolled sidebar flag ─────────────────────────
  const isControlledSidebar = sidebarOpen !== undefined;
  const [internalSidebarOpen, setInternalSidebarOpen] = useState(defaultSidebarOpen);
  const effectiveSidebarOpen = isControlledSidebar ? sidebarOpen : internalSidebarOpen;
  const toggleSidebar = () => {
    const next = !effectiveSidebarOpen;
    if (!isControlledSidebar) setInternalSidebarOpen(next);
    onSidebarOpenChange?.(next);
  };

  // ── Fit-to-area sizing + active slide tracking ──────────────────────
  const [zoom, setZoom] = useState(1);
  const [activeIndex, setActiveIndex] = useState(1);
  const [viewportSize, setViewportSize] = useState<{ w: number; h: number } | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const wheelAccumulatorRef = useRef(0);
  const wheelTimerRef = useRef<number | null>(null);
  const skipNextSlideHashWriteRef = useRef(false);

  const applyZoom = (next: number) => {
    // This viewer uses wheel/arrow input for slide navigation, not panning.
    // Keep the slide within the viewport: 100% means "largest full-slide fit".
    const clamped = Math.min(1, clampZoom(next));
    if (Math.abs(clamped - zoom) < 1e-3) return;
    setZoom(clamped);
  };

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    setViewportSize({ w: el.clientWidth, h: el.clientHeight });
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const rect = entry.contentRect;
      setViewportSize({ w: rect.width, h: rect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [manifest]);

  // Stable id so the sidebar's <aside id> and the header's aria-controls
  // line up across re-renders. Built off useId so multiple viewers on the
  // same page don't collide.
  const reactId = useId();
  const sidebarId = `heysnap-ppt-sidebar-${reactId.replace(/[^a-zA-Z0-9-]/g, "-")}`;

  const navigateSlides = useCallback(
    (delta: number) => {
      if (!manifest || delta === 0) return;
      setActiveIndex((current) => Math.max(1, Math.min(manifest.slideCount, current + delta)));
    },
    [manifest],
  );

  useEffect(() => {
    if (!manifest) return;
    const nextIndex = resolveSlideIndexFromHash(manifest.slideCount);
    skipNextSlideHashWriteRef.current = true;
    setActiveIndex(nextIndex);
    writeHashParam(slideHashParam, String(nextIndex));
    setZoom(1);
    wheelAccumulatorRef.current = 0;
  }, [manifest]);

  useEffect(() => {
    if (!manifest) {
      return;
    }

    if (skipNextSlideHashWriteRef.current) {
      skipNextSlideHashWriteRef.current = false;
      return;
    }

    writeHashParam(slideHashParam, String(activeIndex));
  }, [activeIndex, manifest]);

  useEffect(() => {
    return () => {
      if (wheelTimerRef.current !== null) {
        window.clearTimeout(wheelTimerRef.current);
      }
    };
  }, []);

  const scrollToSlide = useCallback((index: number) => {
    if (!manifest) return;
    setActiveIndex(Math.max(1, Math.min(manifest.slideCount, index)));
    viewportRef.current?.focus({ preventScroll: true });
  }, [manifest]);

  const handleWheelDelta = useCallback(
    (deltaX: number, deltaY: number, deltaMode: number) => {
      if (!manifest) return;
      const rawDelta =
        Math.abs(deltaY) >= Math.abs(deltaX) ? deltaY : deltaX;
      const modeMultiplier = deltaMode === 1 ? 16 : deltaMode === 2 ? 480 : 1;
      const delta = rawDelta * modeMultiplier;
      if (Math.abs(delta) < 8) return;

      wheelAccumulatorRef.current += delta;

      if (wheelTimerRef.current !== null) {
        window.clearTimeout(wheelTimerRef.current);
      }

      wheelTimerRef.current = window.setTimeout(() => {
        const accumulated = wheelAccumulatorRef.current;
        wheelAccumulatorRef.current = 0;
        wheelTimerRef.current = null;

        const magnitude = Math.abs(accumulated);
        if (magnitude < 24) return;
        const direction = accumulated > 0 ? 1 : -1;
        const steps = Math.max(1, Math.min(8, Math.floor(magnitude / WHEEL_PIXELS_PER_SLIDE)));
        navigateSlides(direction * steps);
      }, WHEEL_FLUSH_MS);
    },
    [manifest, navigateSlides],
  );

  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !manifest) return;

    const handleNativeWheel = (event: WheelEvent) => {
      const rawDelta =
        Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      if (Math.abs(rawDelta) < 8) return;

      event.preventDefault();
      handleWheelDelta(event.deltaX, event.deltaY, event.deltaMode);
    };

    el.addEventListener("wheel", handleNativeWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleNativeWheel);
  }, [handleWheelDelta, manifest]);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!manifest || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

      if (event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === "PageDown") {
        event.preventDefault();
        navigateSlides(1);
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowUp" || event.key === "PageUp") {
        event.preventDefault();
        navigateSlides(-1);
        return;
      }

      if (event.key === "Home") {
        event.preventDefault();
        setActiveIndex(1);
        return;
      }

      if (event.key === "End") {
        event.preventDefault();
        setActiveIndex(manifest.slideCount);
      }
    },
    [manifest, navigateSlides],
  );

  useEffect(() => {
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

      if (event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === "PageDown") {
        event.preventDefault();
        navigateSlides(1);
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowUp" || event.key === "PageUp") {
        event.preventDefault();
        navigateSlides(-1);
      }
    };

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  }, [navigateSlides]);

  // ── Title resolution ────────────────────────────────────────────────
  const title = useMemo(() => {
    if (documentName) return documentName;
    return resolved?.name ?? "Presentation";
  }, [documentName, resolved?.name]);

  // ── Slide sizing ────────────────────────────────────────────────────
  // 100% means "largest whole slide that fits in the current body area".
  // Sidebar transitions resize the flex sibling, which ResizeObserver picks
  // up and feeds back into this calculation.
  const slideWidthBase = manifest?.slideWidth ?? 960;
  const slideHeightBase = manifest?.slideHeight ?? 540;
  const fitScale = (() => {
    if (!viewportSize || viewportSize.w <= 0 || viewportSize.h <= 0) return 1;
    const availableWidth = Math.max(1, viewportSize.w - SLIDE_PADDING * 2);
    const availableHeight = Math.max(1, viewportSize.h - SLIDE_PADDING * 2);
    return Math.min(availableWidth / slideWidthBase, availableHeight / slideHeightBase, 1);
  })();
  const renderScale = fitScale * zoom;
  const slideWidth = Math.max(1, Math.round(slideWidthBase * renderScale));
  const slideHeight = Math.max(1, Math.round(slideHeightBase * renderScale));
  const activeSlideUrl = slideUrls.get(activeIndex);

  // ── Render ──────────────────────────────────────────────────────────
  // "loading" covers two visually distinct phases: before `meta` arrives the
  // body is empty, after `meta` it shows slide slots filling in. Both states
  // share the "ready" branch of the render tree once the manifest exists —
  // we just rely on `slideUrls.size < slideCount` to know we're still
  // streaming.
  const state: "loading" | "error" | "ready" = error
    ? "error"
    : !manifest
      ? "loading"
      : "ready";
  const streaming = state === "ready" && !done;

  return (
    <div
      className={rootClass(className)}
      data-format="ppt"
      data-state={state}
      style={{ ...baseStyle, ...style }}
    >
      {showHeader && (
        <PPTHeaderShell
          background={headerBackground}
          foreground={headerForeground}
          style={headerStyle}
        >
          <PPTHeaderLeft
            title={title}
            isSidebarOpen={effectiveSidebarOpen}
            onToggleSidebar={toggleSidebar}
            sidebarId={sidebarId}
            showSidebarToggle={showSidebarToggle && state === "ready"}
            titleStyle={showTitle ? headerTitleStyle : { display: "none" }}
          />
          {/* `display: contents` preserves the flex layout while letting us
              drop the action icons to a muted tint of `currentColor` — same
              pattern the other viewers use to keep the title strong and the
              chrome icons softer. */}
          <div
            style={{
              display: "contents",
              color: "color-mix(in srgb, currentColor 65%, transparent)",
            }}
          >
            <div style={{ flex: 1 }} />
            {showZoomControls && (
              <PPTZoomControls
                zoom={zoom}
                onZoom={applyZoom}
                disabled={state !== "ready"}
              />
            )}
            {showDownloadButton && resolved && (
              <div style={{ flexShrink: 0 }}>
                <PPTDownloadButton resolved={resolved} />
              </div>
            )}
          </div>
        </PPTHeaderShell>
      )}

      <div
        // Body row hosts the sidebar + main scroll area. `minHeight: 0` is
        // needed so the inner overflow:auto actually scrolls (otherwise the
        // flex child grows to fit content and there's nothing to scroll).
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          color: headerForeground,
          background: bodyBackground,
        }}
      >
        {state === "ready" && manifest ? (
          <PPTSidebar
            id={sidebarId}
            open={effectiveSidebarOpen}
            background={sidebarBackground}
            width={sidebarWidth}
            slideCount={manifest.slideCount}
            slideUrls={slideUrls}
            activeIndex={activeIndex}
            slideWidth={manifest.slideWidth}
            slideHeight={manifest.slideHeight}
            onSelect={scrollToSlide}
          />
        ) : null}

        <div
          ref={viewportRef}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          aria-label="Slide viewport"
          style={{
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: SLIDE_PADDING,
            background: bodyBackground,
            position: "relative",
            outline: "none",
            ...bodyStyle,
          }}
        >
          {state === "error" && (
            <p style={{ color: "#b00020", margin: 16 }}>
              Failed to load presentation: {error?.message}
            </p>
          )}

          {state === "loading" &&
            (loadingIndicator ?? (
              <div
                // Full-height flex slot that vertically centers the spinner.
                // `flex: 1` works because the scroll container is a flex
                // column — this child gets the leftover space, and
                // `alignItems/justifyContent: center` does the rest.
                style={{
                  flex: 1,
                  alignSelf: "stretch",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                role="status"
                aria-label={loading ? "Converting presentation" : "Loading"}
              >
                <Spinner />
              </div>
            ))}

          {state === "ready" && manifest && (
            <>
              <SingleSlide
                index={activeIndex}
                url={activeSlideUrl}
                slideWidth={slideWidth}
                slideHeight={slideHeight}
              />
              {streaming && (
                <p
                  // Small footer status while slides are still streaming in.
                  // Drops out once `done` fires.
                  style={{
                    margin: "4px 0 0",
                    position: "absolute",
                    bottom: 8,
                    left: "50%",
                    transform: "translateX(-50%)",
                    fontSize: 12,
                    opacity: 0.65,
                    fontVariantNumeric: "tabular-nums",
                  }}
                  aria-live="polite"
                >
                  Loaded {slideUrls.size} of {manifest.slideCount} slides…
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SingleSlide({
  index,
  url,
  slideWidth,
  slideHeight,
}: {
  index: number;
  url: string | undefined;
  slideWidth: number;
  slideHeight: number;
}) {
  return (
    <figure
      key={index}
      data-slide-index={index}
      style={{
        margin: 0,
        width: slideWidth,
        height: slideHeight,
        background: "#ffffff",
        boxShadow:
          "0 1px 3px color-mix(in srgb, currentColor 16%, transparent), 0 1px 1px color-mix(in srgb, currentColor 8%, transparent)",
        borderRadius: 2,
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {url ? (
        <img
          src={url}
          alt={`Slide ${index}`}
          draggable={false}
          decoding="async"
          loading="eager"
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            userSelect: "none",
          }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            background: "color-mix(in srgb, currentColor 5%, transparent)",
          }}
        />
      )}
    </figure>
  );
}

/**
 * Indeterminate circular spinner. Built off a two-tone ring border + the
 * Web Animations API for rotation, so we don't have to inject `@keyframes`
 * into the global stylesheet (the rest of this library is inline-style only).
 *
 * Honors `prefers-reduced-motion`: when the user has reduced motion on, we
 * render the same ring but skip the rotation. The shape alone is recognizable
 * as a loading state — better than animating against the user's preference.
 */
function Spinner({ size = 40 }: { size?: number }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== "function") return;

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return;

    const animation = el.animate(
      [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
      { duration: 800, iterations: Infinity, easing: "linear" },
    );
    return () => animation.cancel();
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        // Faint ring around the full circumference + a denser arc at the top.
        // Both colors derive from `currentColor` so the spinner looks right on
        // any body background — dark mode picks up white-ish, light mode dark.
        border: `3px solid color-mix(in srgb, currentColor 12%, transparent)`,
        borderTopColor: "color-mix(in srgb, currentColor 55%, transparent)",
        boxSizing: "border-box",
      }}
    />
  );
}

const preloadImage = (url: string): Promise<void> =>
  new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      if (typeof image.decode === "function") {
        void image.decode().then(resolve, resolve);
        return;
      }

      resolve();
    };
    image.onerror = () => resolve();
    image.src = url;
  });

const resolveSlideIndexFromHash = (slideCount: number): number => {
  const rawSlide = readHashParam(slideHashParam);
  const slide = rawSlide === null ? 1 : Number(rawSlide);

  if (!Number.isFinite(slide)) {
    return 1;
  }

  return Math.max(1, Math.min(slideCount, Math.trunc(slide)));
};
