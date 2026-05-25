import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import type { BaseViewerProps } from "../../types";
import { HeySnapCodeViewer } from "../HeySnapCodeViewer";
import { installFilesystemVoiceHotkeyRelay } from "../../../voiceHotkeyRelay";
import {
  clampFontSize,
  CodeFontSizeControls,
} from "../HeySnapCodeViewer/CodeViewerHeader";
import {
  HtmlDownloadButton,
  HtmlHeaderShell,
  HtmlModeToggle,
  HtmlTitle,
  type HtmlViewMode,
} from "./HtmlViewerHeader";

export type { HtmlViewMode } from "./HtmlViewerHeader";

export interface HeySnapHtmlViewerProps extends Omit<BaseViewerProps, "src"> {
  /** URL served by the preview server for the watched HTML file. */
  src: string;
  /** Which view mode to start in. @default "preview" */
  defaultMode?: HtmlViewMode;
  /** Controlled mode. When set, `defaultMode` is ignored. */
  mode?: HtmlViewMode;
  /** Called when the user clicks Preview / Code. */
  onModeChange?: (next: HtmlViewMode) => void;
  /** Render the toolbar. @default true */
  showHeader?: boolean;
  /** Toolbar background. @default "#ffffff" */
  headerBackground?: string;
  /** Toolbar foreground. @default "#15171c" */
  headerForeground?: string;
  /** Escape hatch — styles merged onto the toolbar `<header>`. */
  headerStyle?: CSSProperties;
  /** Styles merged onto the filename span. */
  headerTitleStyle?: CSSProperties;
  /** Show the filename on the left side of the toolbar. @default true */
  showTitle?: boolean;
  /** Show the Preview / Code toggle. @default true */
  showModeToggle?: boolean;
  /** Show Monaco font-size controls when viewing source. @default true */
  showCodeFontSizeControls?: boolean;
  /** Show the download button on the right. @default true */
  showDownloadButton?: boolean;
  /** Monaco theme id used in Code mode. */
  codeTheme?: string;
  /** Background painted around the iframe/source. @default "#ffffff" */
  bodyBackground?: string;
  /** Escape hatch — styles merged onto the body wrapper. */
  bodyStyle?: CSSProperties;
  /** Override the filename shown in the toolbar and used for download. */
  documentName?: string;
  /** Slot for a custom loading indicator while Monaco loads source. */
  loadingIndicator?: ReactNode;
}

const rootClass = (extra?: string) =>
  ["heysnap-viewer", "heysnap-viewer--html", extra].filter(Boolean).join(" ");

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
  fontSize: 12,
} as const;

export function HeySnapHtmlViewer({
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
  showCodeFontSizeControls = true,
  showDownloadButton = true,

  codeTheme,

  bodyBackground = DEFAULTS.bodyBackground,
  bodyStyle,

  documentName,
  loadingIndicator,
  onReady,
  onError,
}: HeySnapHtmlViewerProps) {
  const [uncontrolledMode, setUncontrolledMode] = useState<HtmlViewMode>(defaultMode);
  const isControlled = controlledMode !== undefined;
  const currentMode: HtmlViewMode = isControlled ? controlledMode : uncontrolledMode;
  const [fontSize, setFontSize] = useState<number>(() => DEFAULTS.fontSize);
  const [previewError, setPreviewError] = useState<Error | null>(null);
  const [iframeSrc, setIframeSrc] = useState(src);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  const nestedHotkeyCleanupRef = useRef<(() => void) | null>(null);
  onReadyRef.current = onReady;
  onErrorRef.current = onError;

  useEffect(() => {
    setIframeSrc((currentSrc) => buildReloadSrcPreservingPreviewLocation(src, currentSrc, iframeRef.current));
    setPreviewError(null);
  }, [src]);

  useEffect(() => () => {
    nestedHotkeyCleanupRef.current?.();
    nestedHotkeyCleanupRef.current = null;
  }, []);

  const handleModeChange = (next: HtmlViewMode) => {
    if (!isControlled) setUncontrolledMode(next);
    onModeChange?.(next);
  };

  const title = documentName || "document.html";
  const state: "loading" | "error" | "ready" = previewError ? "error" : "ready";

  const renderShell = (body: ReactNode) => (
    <div
      className={rootClass(className)}
      data-format="html"
      data-mode={currentMode}
      data-src={src}
      data-state={state}
      style={{ ...baseStyle, ...style }}
    >
      {showHeader && (
        <HtmlHeaderShell
          background={headerBackground}
          foreground={headerForeground}
          style={headerStyle}
        >
          {showTitle && <HtmlTitle name={title} style={headerTitleStyle} />}
          {showModeToggle && (
            <div style={{ color: "color-mix(in srgb, currentColor 65%, transparent)" }}>
              <HtmlModeToggle
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
            {currentMode === "code" && showCodeFontSizeControls && (
              <CodeFontSizeControls
                fontSize={fontSize}
                onChange={(next) => setFontSize(clampFontSize(next))}
                disabled={state !== "ready"}
              />
            )}
            {showDownloadButton && <HtmlDownloadButton name={title} url={src} />}
          </div>
        </HtmlHeaderShell>
      )}
      {body}
    </div>
  );

  if (previewError) {
    return renderShell(
      <p style={{ padding: 16, color: "#b00020" }}>
        Failed to load HTML preview: {previewError.message}
      </p>,
    );
  }

  if (currentMode === "code") {
    return renderShell(
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
          src={src}
          language="html"
          showHeader={false}
          bodyBackground={bodyBackground}
          fontSize={fontSize}
          onFontSizeChange={setFontSize}
          onReady={onReady}
          onError={onError}
          loadingIndicator={loadingIndicator}
          {...(codeTheme ? { theme: codeTheme } : {})}
        />
      </div>,
    );
  }

  return renderShell(
    <div
      style={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        background: bodyBackground,
        overflow: "hidden",
        display: "flex",
        ...bodyStyle,
      }}
    >
      <iframe
        ref={iframeRef}
        title={title || "HTML preview"}
        src={iframeSrc}
        onLoad={(event) => {
          nestedHotkeyCleanupRef.current?.();
          nestedHotkeyCleanupRef.current = event.currentTarget.contentWindow === null
            ? null
            : installFilesystemVoiceHotkeyRelay(event.currentTarget.contentWindow);
          window.requestAnimationFrame(() => onReadyRef.current?.());
        }}
        onError={() => {
          const error = new Error(`Failed to load HTML preview: ${title}`);
          setPreviewError(error);
          onErrorRef.current?.(error);
        }}
        style={{
          flex: 1,
          width: "100%",
          height: "100%",
          border: 0,
          background: "transparent",
        }}
      />
    </div>,
  );
}

const buildReloadSrcPreservingPreviewLocation = (
  nextSrc: string,
  fallbackCurrentSrc: string,
  iframe: HTMLIFrameElement | null,
): string => {
  try {
    const nextUrl = new URL(nextSrc, window.location.href);
    const currentUrl = currentPreviewUrl(iframe, fallbackCurrentSrc);
    const previewRoot = htmlPreviewRoot(nextUrl);

    if (
      currentUrl === null ||
      previewRoot === null ||
      currentUrl.origin !== nextUrl.origin ||
      !currentUrl.pathname.startsWith(previewRoot)
    ) {
      return nextUrl.toString();
    }

    const nextVersion = nextUrl.searchParams.get("v");

    if (nextVersion !== null) {
      currentUrl.searchParams.set("v", nextVersion);
    }

    return currentUrl.toString();
  } catch {
    return nextSrc;
  }
};

const currentPreviewUrl = (
  iframe: HTMLIFrameElement | null,
  fallbackCurrentSrc: string,
): URL | null => {
  try {
    const href = iframe?.contentWindow?.location.href;
    return href === undefined ? new URL(fallbackCurrentSrc, window.location.href) : new URL(href);
  } catch {
    try {
      return new URL(fallbackCurrentSrc, window.location.href);
    } catch {
      return null;
    }
  }
};

const htmlPreviewRoot = (url: URL): string | null => {
  const match = /^(.*\/api\/html-preview\/[^/]+\/)/u.exec(url.pathname);
  return match?.[1] ?? null;
};
