import {
  useEffect,
  useRef,
  useState,
  type AudioHTMLAttributes,
  type CSSProperties,
  type ReactNode,
  type SyntheticEvent,
} from "react";

import type { BaseViewerProps } from "../../types";
import { useResolvedAudioSource, type HeySnapAudioSrc } from "./useResolvedAudioSource";
import {
  AudioHeaderGroup,
  AudioZoomPicker,
  clampAudioZoom,
  AudioDownloadButton,
  AudioHeaderShell,
  AudioReloadButton,
} from "./AudioPlayerHeader";

export type { HeySnapAudioSrc } from "./useResolvedAudioSource";

/**
 * Props for {@link HeySnapAudioPlayer}. Every visual property has a sane
 * default — in practice only `src` is required.
 */
export interface HeySnapAudioPlayerProps extends Omit<BaseViewerProps, "src"> {
  /**
   * The audio to play. Accepts a URL string, a `File` from a file input,
   * a `Blob`, an `ArrayBuffer`, or a `Uint8Array` of audio bytes.
   */
  src: HeySnapAudioSrc;

  // ── Header / toolbar ─────────────────────────────────────────────────
  /** Hide the toolbar entirely. @default true */
  showHeader?: boolean;
  /** Toolbar background. @default "#ffffff" */
  headerBackground?: string;
  /** Toolbar foreground; also drives hover/active tints. @default "#15171c" */
  headerForeground?: string;
  /** Escape hatch — styles merged onto the toolbar `<header>`. */
  headerStyle?: CSSProperties;
  /** @deprecated The audio toolbar no longer renders a filename. */
  headerTitleStyle?: CSSProperties;

  /** @deprecated The audio toolbar no longer renders a filename. */
  showTitle?: boolean;
  /** Show the zoom level picker on the right side of the toolbar. @default true */
  showZoomControls?: boolean;
  /** Show the download button on the right side of the toolbar. @default true */
  showDownloadButton?: boolean;

  // ── Body ────────────────────────────────────────────────────────────
  /** Background painted around the player. @default "#f5f5f7" */
  bodyBackground?: string;
  /** Escape hatch — styles merged onto the body. */
  bodyStyle?: CSSProperties;
  /** Styles merged onto the rendered `<audio>` element. */
  audioStyle?: CSSProperties;

  // ── Native <audio> passthroughs ─────────────────────────────────────
  /** Show the native player controls. @default true */
  controls?: boolean;
  /** Start playback as soon as the data is loaded. @default false */
  autoPlay?: boolean;
  /** Start with the audio muted (required by browsers for autoplay). @default false */
  muted?: boolean;
  /** Loop playback when the end is reached. @default false */
  loop?: boolean;
  /** Whether/how the user agent should preload data. @default "metadata" */
  preload?: AudioHTMLAttributes<HTMLAudioElement>["preload"];
  /**
   * `crossOrigin` attribute forwarded to the `<audio>` element. Useful when
   * the source URL serves CORS headers and a consumer wants to read samples.
   */
  crossOrigin?: AudioHTMLAttributes<HTMLAudioElement>["crossOrigin"];

  // ── Misc ────────────────────────────────────────────────────────────
  /** Override the document name used for diagnostics. */
  documentName?: string;
  /** Slot for a custom loading indicator while the metadata loads. */
  loadingIndicator?: ReactNode;
  /**
   * Called when the audio fails to load (404, decoding error, unsupported
   * format, unreadable buffer). The player surfaces a default error UI on
   * its own; use this for analytics / toasts.
   */
  onError?: (error: Error) => void;
}

const rootClass = (extra?: string) =>
  ["heysnap-viewer", "heysnap-viewer--audio", extra].filter(Boolean).join(" ");

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
  // Light surface around the native pill so the player reads as a card on
  // its own surface rather than as part of the page chrome.
  bodyBackground: "#f5f5f7",
} as const;

/**
 * Read-only audio player with the browser's native controls. Renders the
 * file via the platform's native `<audio>` element so codec/container
 * support tracks whatever the browser supports (MP3, AAC, Opus, FLAC, …).
 * Loading, decoding, and CORS all delegate to the browser.
 *
 * A `data-src` attribute is stamped on the root for string sources so
 * consumers can identify the source without poking at refs.
 */
export function HeySnapAudioPlayer({
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
  audioStyle,

  controls = true,
  autoPlay = false,
  muted = false,
  loop = false,
  preload = "metadata",
  crossOrigin,

  loadingIndicator,
  onReady,
  onError,
}: HeySnapAudioPlayerProps) {
  const { resolved, error: resolveError, version } = useResolvedAudioSource(src);

  // Load errors are reported by the `<audio>` element itself and are
  // separate from `src` resolution failures (which already include things
  // like "unsupported src shape"). Both feed into the same shell branch but
  // we keep them apart so a fresh `src` clears the load error cleanly.
  const [loadError, setLoadError] = useState<Error | null>(null);
  const error = resolveError ?? loadError;

  // Tracks whether the browser has read enough metadata (duration) to
  // render the player chrome. Used to drive `data-state="ready"`.
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState<number>(1);

  // Stable ref so the effect can call the latest `onError` without
  // depending on it (avoids re-firing on every parent rerender).
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    setLoadError(null);
    setReady(false);
    setZoom(1);
  }, [version]);

  useEffect(() => {
    if (resolveError) onErrorRef.current?.(resolveError);
  }, [resolveError]);

  const handleLoadedMetadata = () => {
    setReady(true);
    window.requestAnimationFrame(() => onReadyRef.current?.());
  };

  const handleError = (e: SyntheticEvent<HTMLAudioElement>) => {
    // `MediaError` is the spec-defined shape on `<audio>` failures — fall
    // back to a generic message if the browser hasn't attached one yet.
    const mediaError = e.currentTarget.error;
    const message = mediaError?.message || "Audio failed to load.";
    const err = new Error(message);
    setLoadError(err);
    onErrorRef.current?.(err);
  };

  // ── Render ──────────────────────────────────────────────────────────
  const reloadPreview = () => window.location.reload();

  const renderShell = (state: "loading" | "error" | "ready", body: ReactNode) => (
    <div
      className={rootClass(className)}
      data-format="audio"
      // Preserve the original `src` on the root only when it's a string —
      // binary sources don't have a stable identifier to stamp here, and
      // an object URL would expose an internal detail.
      {...(typeof src === "string" ? { "data-src": src } : {})}
      data-state={state}
      style={{ ...baseStyle, ...style }}
    >
      {showHeader && (
        <AudioHeaderShell
          background={headerBackground}
          foreground={headerForeground}
          style={headerStyle}
        >
          <AudioHeaderGroup align="left">
            <AudioReloadButton onReload={reloadPreview} />
          </AudioHeaderGroup>
          <AudioHeaderGroup align="right">
            {showZoomControls && (
              <AudioZoomPicker
                background={headerBackground}
                foreground={headerForeground}
                zoom={zoom}
                onZoom={(next) => setZoom(clampAudioZoom(next))}
                disabled={state !== "ready"}
              />
            )}
            {showDownloadButton && resolved && <AudioDownloadButton resolved={resolved} />}
          </AudioHeaderGroup>
        </AudioHeaderShell>
      )}
      {body}
    </div>
  );

  if (error) {
    return renderShell(
      "error",
      <p style={{ padding: 16, color: "#b00020" }}>Failed to load audio: {error.message}</p>,
    );
  }

  if (!resolved) {
    return renderShell(
      "loading",
      loadingIndicator ?? <p style={{ padding: 16, color: "#666" }}>Loading audio…</p>,
    );
  }

  const state: "loading" | "error" | "ready" = loadError
    ? "error"
    : ready
      ? "ready"
      : "loading";

  return renderShell(
    state,
    <div
      style={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        background: bodyBackground,
        // Center the native player chrome both axes. The native pill stays
        // its natural width (browser-defined), padded so it doesn't crowd
        // the body edges on narrow containers.
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        overflow: "hidden",
        ...bodyStyle,
      }}
    >
      <audio
        // Remount on src change so the browser drops any buffered state
        // from the previous source — otherwise `<audio>` sometimes hangs
        // onto the old metadata until you call `.load()` manually.
        key={resolved.url}
        src={resolved.url}
        controls={controls}
        autoPlay={autoPlay}
        muted={muted}
        loop={loop}
        preload={preload}
        crossOrigin={crossOrigin}
        onLoadedMetadata={handleLoadedMetadata}
        onError={handleError}
        // Capped at a comfortable reading width — the native pill grows
        // unbounded otherwise, which looks awkward in a wide container.
        style={{
          display: "block",
          width: "100%",
          maxWidth: 560 * zoom,
          ...audioStyle,
        }}
      />
    </div>,
  );
}
