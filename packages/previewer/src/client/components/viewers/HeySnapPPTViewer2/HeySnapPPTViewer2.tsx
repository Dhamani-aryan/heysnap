import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import WebViewer, { type WebViewerInstance } from "@pdftron/webviewer";

import type { BaseViewerProps } from "../../types";
import {
  useResolvedPPTSource,
  type HeySnapPPTSrc,
} from "../HeySnapPPTViewer/useResolvedPPTSource";

export type { HeySnapPPTSrc } from "../HeySnapPPTViewer/useResolvedPPTSource";

export interface HeySnapPPTViewer2Props extends Omit<BaseViewerProps, "src"> {
  src: HeySnapPPTSrc;
  documentName?: string;
  licenseKey?: string;
  webViewerPath?: string;
  showHeader?: boolean;
  headerBackground?: string;
  headerForeground?: string;
  headerStyle?: CSSProperties;
  headerTitleStyle?: CSSProperties;
  bodyBackground?: string;
  bodyStyle?: CSSProperties;
  loadingIndicator?: ReactNode;
  viewOnly?: boolean;
}

const DEFAULTS = {
  webViewerPath: "lib/webviewer",
  headerBackground: "#ffffff",
  headerForeground: "#15171c",
  bodyBackground: "#e9eaed",
} as const;

const rootClass = (extra?: string) =>
  ["heysnap-viewer", "heysnap-viewer--ppt2", extra].filter(Boolean).join(" ");

const rootStyle: CSSProperties = {
  position: "relative",
  display: "flex",
  flexDirection: "column",
  width: "100%",
  height: "100%",
  minHeight: 0,
  minWidth: 0,
};

const headerBaseStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  height: 40,
  flexShrink: 0,
  padding: "0 12px",
  boxShadow: "inset 0 -1px 0 color-mix(in srgb, currentColor 10%, transparent)",
};

const titleBaseStyle: CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 13,
  fontWeight: 500,
  letterSpacing: 0,
  opacity: 0.92,
};

export function HeySnapPPTViewer2({
  src,
  className,
  style,
  documentName,
  licenseKey,
  webViewerPath = DEFAULTS.webViewerPath,
  showHeader = false,
  headerBackground = DEFAULTS.headerBackground,
  headerForeground = DEFAULTS.headerForeground,
  headerStyle,
  headerTitleStyle,
  bodyBackground = DEFAULTS.bodyBackground,
  bodyStyle,
  loadingIndicator,
  viewOnly = true,
  onReady,
  onError,
}: HeySnapPPTViewer2Props): React.ReactElement {
  const { resolved, error: resolveError } = useResolvedPPTSource(src);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<WebViewerInstance | null>(null);
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  const [viewerError, setViewerError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);

  onReadyRef.current = onReady;
  onErrorRef.current = onError;

  const title = useMemo(() => {
    if (documentName !== undefined && documentName.length > 0) {
      return documentName;
    }

    return resolved?.name ?? "Presentation";
  }, [documentName, resolved?.name]);

  useEffect(() => {
    if (resolveError === null) {
      return;
    }

    setViewerError(resolveError);
    setLoading(false);
    onErrorRef.current?.(resolveError);
  }, [resolveError]);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null || resolved === null || resolveError !== null) {
      return;
    }

    let cancelled = false;
    setViewerError(null);
    setLoading(true);
    container.replaceChildren();

    const loadPresentation = async (): Promise<void> => {
      try {
        const instance = await WebViewer(
          {
            path: webViewerPath,
            licenseKey,
            isReadOnly: viewOnly,
          },
          container,
        );

        if (cancelled) {
          await instance.UI.dispose().catch(() => undefined);
          return;
        }

        instanceRef.current = instance;
        instance.UI.setTheme(resolveWebViewerTheme(headerBackground, bodyBackground));
        if (viewOnly) {
          configureViewOnlyMode(instance);
        }
        instance.Core.documentViewer.addEventListener("documentLoaded", () => {
          if (cancelled) {
            return;
          }

          if (viewOnly) {
            configureViewOnlyMode(instance);
          }
          setLoading(false);
          onReadyRef.current?.();
        });

        await instance.UI.loadDocument(resolved.file, {
          filename: title,
          extension: "pptx",
          loadAnnotations: false,
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        const nextError = error instanceof Error ? error : new Error(String(error));
        setViewerError(nextError);
        setLoading(false);
        onErrorRef.current?.(nextError);
      }
    };

    void loadPresentation();

    return () => {
      cancelled = true;
      const instance = instanceRef.current;
      instanceRef.current = null;
      container.replaceChildren();
      void instance?.UI.dispose().catch(() => undefined);
    };
  }, [
    bodyBackground,
    headerBackground,
    licenseKey,
    resolved,
    resolveError,
    title,
    viewOnly,
    webViewerPath,
  ]);

  const state = viewerError !== null ? "error" : loading ? "loading" : "ready";

  return (
    <div
      className={rootClass(className)}
      data-format="ppt"
      data-viewer="apryse"
      data-state={state}
      style={{ ...rootStyle, ...style }}
    >
      {showHeader ? (
        <header
          style={{
            ...headerBaseStyle,
            background: headerBackground,
            color: headerForeground,
            ...headerStyle,
          }}
        >
          <span title={title} style={{ ...titleBaseStyle, ...headerTitleStyle }}>
            {title}
          </span>
        </header>
      ) : null}
      <div
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          background: bodyBackground,
          ...bodyStyle,
        }}
      >
        <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
        {loading && viewerError === null ? (
          <div
            role="status"
            aria-label="Loading presentation"
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: headerForeground,
              background: bodyBackground,
              pointerEvents: "none",
            }}
          >
            {loadingIndicator ?? <Spinner />}
          </div>
        ) : null}
        {viewerError !== null ? (
          <p
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: 0,
              padding: 16,
              color: "#b00020",
              background: bodyBackground,
              textAlign: "center",
            }}
          >
            Failed to load presentation: {viewerError.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function configureViewOnlyMode(instance: WebViewerInstance): void {
  const { Feature } = instance.UI;

  instance.UI.setToolbarGroup("toolbarGroup-View");
  instance.UI.enableViewOnlyMode();
  instance.UI.disableFeatures([
    Feature.Annotations,
    Feature.ContentEdit,
    Feature.FilePicker,
    Feature.Initials,
    Feature.InlineComment,
    Feature.Measurement,
    Feature.NotesPanel,
    Feature.Redaction,
    Feature.RightClickAnnotationPopup,
    Feature.SavedSignaturesTab,
  ]);
  instance.UI.disableElements([
    "toolbarGroup-Annotate",
    "toolbarGroup-Shapes",
    "toolbarGroup-Insert",
    "toolbarGroup-Edit",
    "toolbarGroup-FillAndSign",
    "toolbarGroup-Forms",
    "toolbarGroup-Measure",
    "toolbarGroup-Redaction",
    "toggleNotesButton",
    "notesPanelToggle",
    "notesPanelButton",
    "commentPanelToggle",
    "notesPanel",
    "inlineCommentPopup",
    "annotationCommentButton",
    "officeEditorAddComment",
    "officeEditorCommentPanel",
    "officeEditorCommentAddNewButton",
    "toolsOverlay",
    "signatureModal",
    "rubberStampToolGroupButton",
    "stampToolGroupButton",
    "fileAttachmentToolGroupButton",
    "calloutToolGroupButton",
    "freeTextToolGroupButton",
    "contextMenuPopup",
    "annotationPopup",
    "textPopup",
  ]);

  const { annotationManager, documentViewer } = instance.Core;
  annotationManager.enableReadOnlyMode();
  documentViewer.enableReadOnlyMode();
}

function resolveWebViewerTheme(headerBackground: string, bodyBackground: string): "dark" | "light" {
  const color = parseHexColor(headerBackground) ?? parseHexColor(bodyBackground);

  if (color === null) {
    return "dark";
  }

  const luminance = (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) / 255;
  return luminance < 0.5 ? "dark" : "light";
}

function parseHexColor(value: string): { r: number; g: number; b: number } | null {
  const match = /^#([a-f0-9]{3}|[a-f0-9]{6})$/iu.exec(value.trim());

  if (match === null) {
    return null;
  }

  const raw = match[1] ?? "";
  const hex = raw.length === 3
    ? raw.split("").map((char) => `${char}${char}`).join("")
    : raw;
  const int = Number.parseInt(hex, 16);

  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  };
}

function Spinner({ size = 40 }: { size?: number }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== "function") {
      return;
    }

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (prefersReducedMotion) {
      return;
    }

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
        border: "3px solid color-mix(in srgb, currentColor 12%, transparent)",
        borderTopColor: "color-mix(in srgb, currentColor 55%, transparent)",
        boxSizing: "border-box",
      }}
    />
  );
}
