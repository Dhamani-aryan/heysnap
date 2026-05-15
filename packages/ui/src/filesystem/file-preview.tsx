"use client";

import { Suspense, lazy, useEffect, useState, type ReactElement } from "react";

const HeySnapAudioPlayer = lazy(() =>
  import("heysnap-web-viewers/audio").then((module) => ({ default: module.HeySnapAudioPlayer })),
);
const HeySnapCodeViewer = lazy(() =>
  import("heysnap-web-viewers/code").then((module) => ({ default: module.HeySnapCodeViewer })),
);
const HeySnapDocxViewer = lazy(() =>
  import("heysnap-web-viewers/docx").then((module) => ({ default: module.HeySnapDocxViewer })),
);
const HeySnapHtmlViewer = lazy(() =>
  import("heysnap-web-viewers/html").then((module) => ({ default: module.HeySnapHtmlViewer })),
);
const HeySnapImageViewer = lazy(() =>
  import("heysnap-web-viewers/image").then((module) => ({ default: module.HeySnapImageViewer })),
);
const HeySnapMarkdownViewer = lazy(() =>
  import("heysnap-web-viewers/markdown").then((module) => ({ default: module.HeySnapMarkdownViewer })),
);
const HeySnapPdfViewer = lazy(() =>
  import("heysnap-web-viewers/pdf").then((module) => ({ default: module.HeySnapPdfViewer })),
);
const HeySnapPPTViewer = lazy(() =>
  import("heysnap-web-viewers/ppt").then((module) => ({ default: module.HeySnapPPTViewer })),
);
const HeySnapVideoViewer = lazy(() =>
  import("heysnap-web-viewers/video").then((module) => ({ default: module.HeySnapVideoViewer })),
);
const HeySnapXlsxViewer = lazy(() =>
  import("heysnap-web-viewers/xlsx").then((module) => ({ default: module.HeySnapXlsxViewer })),
);

const PPT_VIEWER_SERVER_URL = "http://13.126.207.124/Kd5QihM3zhwV2WztLXAnBc6n07Goa6O3mByrs-rqWjU/ppt";

export type FilePreviewProps = {
  readonly name: string;
  readonly path: string;
  readonly websocketUrl: string;
  /** Cache-buster used to refetch the file when it changes (e.g. updatedAt or version). */
  readonly version?: string;
};

const fallback = (
  <div
    style={{
      display: "flex",
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      width: "100%",
      height: "100%",
      background: "#0b0d11",
      color: "rgba(244,246,251,0.55)",
      fontSize: 14,
    }}
  >
    Loading…
  </div>
);

const DARK_VIEWER_PROPS = {
  bodyBackground: "var(--heysnap-document-viewer-body-background)",
  headerBackground: "var(--heysnap-document-viewer-header-background)",
  headerForeground: "var(--heysnap-document-viewer-header-foreground)",
} as const;

const PDF_DARK_PROPS = {
  ...DARK_VIEWER_PROPS,
  sidebarBackground: "var(--heysnap-document-viewer-sidebar-background)",
} as const;

const PPT_DARK_PROPS = {
  ...DARK_VIEWER_PROPS,
  sidebarBackground: "var(--heysnap-document-viewer-sidebar-background)",
} as const;

export function FilePreview({ name, path, websocketUrl, version }: FilePreviewProps): ReactElement {
  return (
    <section className="heysnap-document-viewer" style={{ width: "100%", height: "100%" }}>
      <Suspense fallback={fallback}>{renderViewer({ name, path, websocketUrl, version })}</Suspense>
    </section>
  );
}

const renderViewer = ({ name, path, websocketUrl, version }: FilePreviewProps): ReactElement => {
  const downloadUrl = buildFilesystemDownloadUrl(websocketUrl, [path], version);
  const pdfPreviewUrl = buildFilesystemPreviewUrl(websocketUrl, path, "pdf", version);
  const xlsxUrl = buildFilesystemXlsxUrl(websocketUrl, path, version);

  if (isPdfFile(name)) {
    return <HeySnapPdfViewer src={pdfPreviewUrl} {...PDF_DARK_PROPS} />;
  }

  if (isDocxFile(name)) {
    return <HeySnapDocxViewer src={downloadUrl} documentName={name} {...DARK_VIEWER_PROPS} />;
  }

  if (isPptxFile(name)) {
    return (
      <HeySnapPPTViewer
        src={downloadUrl}
        documentName={name}
        serverUrl={PPT_VIEWER_SERVER_URL}
        {...PPT_DARK_PROPS}
      />
    );
  }

  if (isXlsxFile(name)) {
    return <XlsxPreview url={xlsxUrl} name={name} />;
  }

  if (isOfficePdfPreviewFile(name)) {
    return <HeySnapPdfViewer src={pdfPreviewUrl} {...PDF_DARK_PROPS} />;
  }

  if (isImageFile(name)) {
    return <HeySnapImageViewer src={downloadUrl} documentName={name} {...DARK_VIEWER_PROPS} />;
  }

  if (isMarkdownFile(name)) {
    return <HeySnapMarkdownViewer src={downloadUrl} documentName={name} {...DARK_VIEWER_PROPS} codeTheme="heysnap-dark" />;
  }

  if (isHtmlFile(name)) {
    return <HeySnapHtmlViewer src={downloadUrl} documentName={name} {...DARK_VIEWER_PROPS} codeTheme="heysnap-dark" />;
  }

  if (isCodeFile(name) || isPlainTextFile(name)) {
    return <HeySnapCodeViewer src={downloadUrl} documentName={name} {...DARK_VIEWER_PROPS} theme="heysnap-dark" />;
  }

  if (isAudioFile(name)) {
    return <HeySnapAudioPlayer src={downloadUrl} documentName={name} {...DARK_VIEWER_PROPS} />;
  }

  if (isVideoFile(name)) {
    return <HeySnapVideoViewer src={downloadUrl} documentName={name} {...DARK_VIEWER_PROPS} />;
  }

  return (
    <div
      style={{
        display: "flex",
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        background: "#0b0d11",
        color: "rgba(244,246,251,0.55)",
        fontSize: 14,
        padding: 24,
        textAlign: "center",
      }}
    >
      No preview available for {name}.
    </div>
  );
};

function XlsxPreview({ url, name }: { url: string; name: string }): ReactElement {
  const [workbook, setWorkbook] = useState<unknown | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setWorkbook(null);
    setError(null);

    fetch(url)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load workbook (${String(response.status)}).`);
        }
        return (await response.json()) as unknown;
      })
      .then((data) => {
        if (!cancelled) {
          setWorkbook(data);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Failed to load workbook.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  if (error !== null) {
    return (
      <div
        style={{
          display: "flex",
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          background: "#0b0d11",
          color: "rgba(244,246,251,0.55)",
          fontSize: 14,
        }}
      >
        {error}
      </div>
    );
  }

  if (workbook === null) {
    return fallback;
  }

  return (
    <div className="theme-dark" style={{ width: "100%", height: "100%" }}>
      <HeySnapXlsxViewer workbook={workbook} title={name} darkBgColor="#0b0d11" />
    </div>
  );
}

export const isPdfFile = (fileName: string): boolean =>
  fileName.toLowerCase().endsWith(".pdf");

export const isDocxFile = (fileName: string): boolean =>
  fileName.toLowerCase().endsWith(".docx");

export const isPptxFile = (fileName: string): boolean =>
  fileName.toLowerCase().endsWith(".pptx");

export const isXlsxFile = (fileName: string): boolean =>
  fileName.toLowerCase().endsWith(".xlsx");

export const isOfficePdfPreviewFile = (fileName: string): boolean =>
  /\.(ppt|xls)$/iu.test(fileName);

export const isImageFile = (fileName: string): boolean =>
  /\.(avif|bmp|gif|ico|jpe?g|png|svg|webp)$/iu.test(fileName);

export const isMarkdownFile = (fileName: string): boolean =>
  /\.(md|markdown|mdx)$/iu.test(fileName);

export const isHtmlFile = (fileName: string): boolean =>
  /\.html?$/iu.test(fileName);

export const isCodeFile = (fileName: string): boolean =>
  /(^|\/)(dockerfile|makefile|\.dockerignore|\.editorconfig|\.eslintignore|\.eslintrc|\.gitignore|\.npmrc|\.prettierignore|\.prettierrc)$/iu.test(fileName) ||
  /(^|\/)\.env(?:\..+)?$/iu.test(fileName) ||
  /\.(bash|c|cc|cjs|cljs|clj|conf|cpp|cs|css|cxx|dart|env|erl|ex|exs|fish|fs|go|gql|graphql|h|handlebars|hbs|hh|hpp|ini|java|js|json|jsonc|jsx|kt|kts|less|lua|mjs|php|pl|proto|ps1|py|r|rb|rs|scala|scss|sh|sql|svelte|swift|toml|ts|tsx|vue|xml|ya?ml|zsh)$/iu.test(fileName);

export const isPlainTextFile = (fileName: string): boolean =>
  /\.(log|text|txt)$/iu.test(fileName);

export const isAudioFile = (fileName: string): boolean =>
  /\.(aac|aif|aiff|flac|m4a|mp3|oga|ogg|opus|wav|weba)$/iu.test(fileName);

export const isVideoFile = (fileName: string): boolean =>
  /\.(m4v|mov|mp4|mpeg|mpg|ogv|webm)$/iu.test(fileName);

export const buildFilesystemDownloadUrl = (
  filesystemWebsocketUrl: string,
  paths: readonly string[],
  version?: string,
): string => {
  const baseUrl = typeof window !== "undefined" && typeof window.location?.href === "string" ? window.location.href : "http://localhost";
  const url = new URL(filesystemWebsocketUrl, baseUrl);

  if (url.protocol === "ws:") {
    url.protocol = "http:";
  } else if (url.protocol === "wss:") {
    url.protocol = "https:";
  }

  url.pathname = url.pathname.replace(/\/filesystem\/?$/u, "/filesystem/download");
  url.searchParams.delete("path");
  url.searchParams.delete("showHidden");
  url.searchParams.delete("v");
  paths.forEach((path) => {
    url.searchParams.append("path", path);
  });
  if (version !== undefined) {
    url.searchParams.set("v", version);
  }

  return url.toString();
};

export const buildFilesystemPreviewUrl = (
  filesystemWebsocketUrl: string,
  path: string,
  format: "pdf",
  version?: string,
): string => {
  const baseUrl = typeof window !== "undefined" && typeof window.location?.href === "string" ? window.location.href : "http://localhost";
  const url = new URL(filesystemWebsocketUrl, baseUrl);

  if (url.protocol === "ws:") {
    url.protocol = "http:";
  } else if (url.protocol === "wss:") {
    url.protocol = "https:";
  }

  url.pathname = url.pathname.replace(/\/filesystem\/?$/u, "/filesystem/preview");
  url.searchParams.delete("path");
  url.searchParams.delete("showHidden");
  url.searchParams.delete("v");
  url.searchParams.set("path", path);
  url.searchParams.set("format", format);
  if (version !== undefined) {
    url.searchParams.set("v", version);
  }

  return url.toString();
};

export const buildFilesystemXlsxUrl = (
  filesystemWebsocketUrl: string,
  path: string,
  version?: string,
): string => {
  const baseUrl = typeof window !== "undefined" && typeof window.location?.href === "string" ? window.location.href : "http://localhost";
  const url = new URL(filesystemWebsocketUrl, baseUrl);

  if (url.protocol === "ws:") {
    url.protocol = "http:";
  } else if (url.protocol === "wss:") {
    url.protocol = "https:";
  }

  url.pathname = url.pathname.replace(/\/filesystem\/?$/u, "/filesystem/xlsx");
  url.searchParams.delete("path");
  url.searchParams.delete("showHidden");
  url.searchParams.delete("v");
  url.searchParams.set("path", path);
  if (version !== undefined) {
    url.searchParams.set("v", version);
  }

  return url.toString();
};
