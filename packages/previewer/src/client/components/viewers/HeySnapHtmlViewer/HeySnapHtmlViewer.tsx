import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import type { BaseViewerProps } from "../../types";
import { HeySnapCodeViewer } from "../HeySnapCodeViewer";
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
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  onReadyRef.current = onReady;
  onErrorRef.current = onError;

  useEffect(() => {
    setPreviewError(null);
  }, [src]);

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
        key={src}
        title={title || "HTML preview"}
        src={src}
        onLoad={() => window.requestAnimationFrame(() => onReadyRef.current?.())}
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
