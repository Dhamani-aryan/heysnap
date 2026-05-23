import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type SyntheticEvent,
  type VideoHTMLAttributes,
} from "react";

import type { BaseViewerProps } from "../../types";
import { useResolvedVideoSource, type HeySnapVideoSrc } from "./useResolvedVideoSource";
import {
  clampVideoZoom,
  VideoDownloadButton,
  VideoHeaderShell,
  VideoTitle,
  VideoZoomControls,
} from "./VideoViewerHeader";

export type { HeySnapVideoSrc } from "./useResolvedVideoSource";

/**
 * Props for {@link HeySnapVideoViewer}. Every visual property has a sane
 * default — in practice only `src` is required.
 */
export interface HeySnapVideoViewerProps extends Omit<BaseViewerProps, "src"> {
  /**
   * The video to display. Accepts a URL string, a `File` from a file input,
   * a `Blob`, an `ArrayBuffer`, or a `Uint8Array` of video bytes.
   */
  src: HeySnapVideoSrc;

  // ── Header / toolbar ─────────────────────────────────────────────────
  /** Hide the toolbar entirely. @default true */
  showHeader?: boolean;
  /** Toolbar background. @default "#ffffff" */
  headerBackground?: string;
  /** Toolbar foreground; also drives hover/active tints. @default "#15171c" */
  headerForeground?: string;
  /** Escape hatch — styles merged onto the toolbar `<header>`. */
  headerStyle?: CSSProperties;
  /** Styles merged onto the filename span. */
  headerTitleStyle?: CSSProperties;

  /** Show the filename on the left side of the toolbar. @default true */
  showTitle?: boolean;
  /** Show the −/+ zoom controls on the right side of the toolbar. @default true */
  showZoomControls?: boolean;
  /** Show the download button on the right side of the toolbar. @default true */
  showDownloadButton?: boolean;

  // ── Body ────────────────────────────────────────────────────────────
  /** Background painted around the video. @default "#000000" */
  bodyBackground?: string;
  /** Escape hatch — styles merged onto the body. */
  bodyStyle?: CSSProperties;
  /** Styles merged onto the rendered `<video>` element. */
  videoStyle?: CSSProperties;

  // ── Native <video> passthroughs ─────────────────────────────────────
  /** Show the native player controls. @default true */
  controls?: boolean;
  /** Start playback as soon as the data is loaded. @default false */
  autoPlay?: boolean;
  /** Start with the audio muted (required by browsers for autoplay). @default false */
  muted?: boolean;
  /** Loop playback when the end is reached. @default false */
  loop?: boolean;
  /** Whether/how the user agent should preload data. @default "metadata" */
  preload?: VideoHTMLAttributes<HTMLVideoElement>["preload"];
  /** Optional poster image URL shown before playback begins. */
  poster?: string;
  /**
   * `crossOrigin` attribute forwarded to the `<video>` element. Useful when
   * the source URL serves CORS headers and a consumer wants to read frames.
   */
  crossOrigin?: VideoHTMLAttributes<HTMLVideoElement>["crossOrigin"];

  // ── Misc ────────────────────────────────────────────────────────────
  /** Override the document name shown in the title slot. */
  documentName?: string;
  /** Slot for a custom loading indicator while the metadata loads. */
  loadingIndicator?: ReactNode;
  /**
   * Called when the video fails to load (404, decoding error, unsupported
   * format, unreadable buffer). The viewer surfaces a default error UI on
   * its own; use this for analytics / toasts.
   */
  onError?: (error: Error) => void;
}

const rootClass = (extra?: string) =>
  ["heysnap-viewer", "heysnap-viewer--video", extra].filter(Boolean).join(" ");

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
  // Black background matches what every video player ships with — the
  // letterbox bars around a non-conforming aspect ratio should disappear
  // into the chrome.
  bodyBackground: "#000000",
} as const;

const NATIVE_CONTROLS_HEIGHT = 48;

/**
 * Read-only video viewer with a fit-to-window default and the browser's
 * native playback controls. Renders the file via the platform's native
 * `<video>` element so codec/container support tracks whatever the browser
 * supports (MP4/H.264, WebM, Ogg, …). Loading, decoding, and CORS all
 * delegate to the browser.
 *
 * A `data-src` attribute is stamped on the root for string sources so
 * consumers can identify the source without poking at refs.
 */
export function HeySnapVideoViewer({
  src,
  className,
  style,

  showHeader = true,
  headerBackground = DEFAULTS.headerBackground,
  headerForeground = DEFAULTS.headerForeground,
  headerStyle,
  headerTitleStyle,

  showTitle = true,
  showZoomControls = true,
  showDownloadButton = true,

  bodyBackground = DEFAULTS.bodyBackground,
  bodyStyle,
  videoStyle,

  controls = true,
  autoPlay = false,
  muted = false,
  loop = false,
  preload = "metadata",
  poster,
  crossOrigin,

  documentName,
  loadingIndicator,
  onReady,
  onError,
}: HeySnapVideoViewerProps) {
  const { resolved, error: resolveError, version } = useResolvedVideoSource(src);

  // Load errors are reported by the `<video>` element itself and are separate
  // from `src` resolution failures (which already include things like
  // "unsupported src shape"). Both feed into the same shell branch but we
  // keep them apart so a fresh `src` clears the load error cleanly.
  const [loadError, setLoadError] = useState<Error | null>(null);
  const error = resolveError ?? loadError;

  // Tracks whether the browser has read enough metadata (duration, size) to
  // render the player chrome. Used to drive `data-state="ready"`.
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState<number>(1);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [bodySize, setBodySize] = useState<{ w: number; h: number } | null>(null);

  // Stable ref so the effect can call the latest `onError` without
  // depending on it (avoids re-firing on every parent rerender).
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const readyVersionRef = useRef<number | null>(null);

  useEffect(() => {
    setLoadError(null);
    setReady(false);
    setZoom(1);
    setNaturalSize(null);
    setBodySize(null);
  }, [version]);

  useEffect(() => {
    if (resolveError) onErrorRef.current?.(resolveError);
  }, [resolveError]);

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

  const applyZoom = (next: number) => setZoom(clampVideoZoom(next));

  const handleLoadedMetadata = (e: SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      setNaturalSize({ w: video.videoWidth, h: video.videoHeight });
    }
    setReady(true);
  };

  useEffect(() => {
    if (error || !ready || !bodySize || readyVersionRef.current === version) return;
    readyVersionRef.current = version;
    const frame = window.requestAnimationFrame(() => onReadyRef.current?.());
    return () => window.cancelAnimationFrame(frame);
  }, [bodySize, error, ready, version]);

  const handleError = (e: SyntheticEvent<HTMLVideoElement>) => {
    // `MediaError` is the spec-defined shape on `<video>` failures — fall
    // back to a generic message if the browser hasn't attached one yet.
    const mediaError = e.currentTarget.error;
    const message = mediaError?.message || "Video failed to load.";
    const err = new Error(message);
    setLoadError(err);
    onErrorRef.current?.(err);
  };

  // ── Render ──────────────────────────────────────────────────────────
  const title = documentName || resolved?.name || "";

  const renderShell = (state: "loading" | "error" | "ready", body: ReactNode) => (
    <div
      className={rootClass(className)}
      data-format="video"
      // Preserve the original `src` on the root only when it's a string —
      // binary sources don't have a stable identifier to stamp here, and
      // an object URL would expose an internal detail.
      {...(typeof src === "string" ? { "data-src": src } : {})}
      data-state={state}
      style={{ ...baseStyle, ...style }}
    >
      {showHeader && (
        <VideoHeaderShell
          background={headerBackground}
          foreground={headerForeground}
          style={headerStyle}
        >
          {showTitle && <VideoTitle name={title} style={headerTitleStyle} />}
          {/* `display: contents` preserves the flex layout while letting us
              drop the action icons to a muted tint of `currentColor` —
              matches the image viewer's chrome treatment. */}
          <div
            style={{
              display: "contents",
              color: "color-mix(in srgb, currentColor 65%, transparent)",
            }}
          >
            {/* Spacer pushes the right cluster to the far edge while letting
                the left cluster shrink instead of grow. */}
            <div style={{ flex: 1 }} />
            {showZoomControls && (
              <VideoZoomControls
                zoom={zoom}
                onZoom={applyZoom}
                disabled={state !== "ready"}
              />
            )}
            {showDownloadButton && resolved && <VideoDownloadButton resolved={resolved} />}
          </div>
        </VideoHeaderShell>
      )}
      {body}
    </div>
  );

  if (error) {
    return renderShell(
      "error",
      <p style={{ padding: 16, color: "#b00020" }}>Failed to load video: {error.message}</p>,
    );
  }

  if (!resolved) {
    return renderShell(
      "loading",
      loadingIndicator ?? <p style={{ padding: 16, color: "#666" }}>Loading video…</p>,
    );
  }

  const state: "loading" | "error" | "ready" = loadError
    ? "error"
    : ready
      ? "ready"
      : "loading";

  const fitScale = (() => {
    if (!naturalSize || !bodySize || bodySize.w === 0 || bodySize.h === 0) return 1;
    const sx = bodySize.w / naturalSize.w;
    const sy = Math.max(1, bodySize.h - NATIVE_CONTROLS_HEIGHT) / naturalSize.h;
    return Math.min(sx, sy, 1);
  })();
  const renderScale = fitScale * zoom;
  const displayW = naturalSize ? naturalSize.w * renderScale : undefined;
  const displayH = naturalSize ? naturalSize.h * renderScale : undefined;

  return renderShell(
    state,
    <div
      ref={bodyRef}
      style={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        background: bodyBackground,
        // Center the video both axes; `object-fit: contain` on the element
        // handles the aspect-ratio fit so the letterbox bars land on
        // `bodyBackground` rather than stretching the content.
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "auto",
        ...bodyStyle,
      }}
    >
      <div
        style={{
          width: displayW,
          height: displayH,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <video
          // Remount on src change so the browser drops any buffered state
          // from the previous source — otherwise `<video>` will sometimes
          // hang onto the old metadata until you call `.load()` manually.
          key={resolved.url}
          src={resolved.url}
          controls={controls}
          autoPlay={autoPlay}
          muted={muted}
          loop={loop}
          preload={preload}
          poster={poster}
          crossOrigin={crossOrigin}
          onLoadedMetadata={handleLoadedMetadata}
          onError={handleError}
          // `playsInline` lets iOS play in the page rather than hijacking
          // into fullscreen — universally desirable for an inline viewer.
          playsInline
          style={{
            display: "block",
            width: displayW ?? "100%",
            height: displayH ?? "100%",
            maxWidth: "none",
            maxHeight: "none",
            objectFit: "contain",
            backgroundColor: "transparent",
            ...videoStyle,
          }}
        />
      </div>
    </div>,
  );
}
