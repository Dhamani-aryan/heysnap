import { useEffect, useMemo } from "react";

import type { PreviewFile, PreviewHtml, PreviewItem, PreviewWorkbook } from "../protocol";
import { HeySnapAudioPlayer } from "./components/viewers/HeySnapAudioPlayer";
import {
  HEYSNAP_DARK_ID,
  HEYSNAP_LIGHT_ID,
  HeySnapCodeViewer,
} from "./components/viewers/HeySnapCodeViewer";
import { HeySnapCsvViewer } from "./components/viewers/HeySnapCsvViewer";
import { HeySnapDocxViewer } from "./components/viewers/HeySnapDocxViewer";
import { HeySnapHtmlViewer } from "./components/viewers/HeySnapHtmlViewer";
import { HeySnapImageViewer } from "./components/viewers/HeySnapImageViewer";
import { HeySnapMarkdownViewer } from "./components/viewers/HeySnapMarkdownViewer";
import { HeySnapPdfViewer } from "./components/viewers/HeySnapPdfViewer";
import { HeySnapPPTViewer2 } from "./components/viewers/HeySnapPPTViewer2";
import { HeySnapVideoViewer } from "./components/viewers/HeySnapVideoViewer";
import { HeySnapXlsxViewer } from "./components/viewers/HeySnapXlsxViewer";

export type PreviewTheme = "dark" | "light";

type ViewerThemeConfig = {
  readonly mode: PreviewTheme;
  readonly headerBackground: string;
  readonly headerForeground: string;
  readonly bodyBackground: string;
  readonly codeBodyBackground: string;
  readonly mediaBodyBackground: string;
  readonly sidebarBackground: string;
  readonly codeTheme: string;
  readonly xlsxClassName: string;
};

const VIEWER_THEMES: Record<PreviewTheme, ViewerThemeConfig> = {
  dark: {
    mode: "dark",
    headerBackground: "#0f0f11",
    headerForeground: "#f4f6fb",
    bodyBackground: "#0b0e13",
    codeBodyBackground: "#0f0f11",
    mediaBodyBackground: "#000000",
    sidebarBackground: "#161b22",
    codeTheme: HEYSNAP_DARK_ID,
    xlsxClassName: "theme-dark",
  },
  light: {
    mode: "light",
    headerBackground: "#ffffff",
    headerForeground: "#15171c",
    bodyBackground: "#f3f4f6",
    codeBodyBackground: "#ffffff",
    mediaBodyBackground: "#f3f4f6",
    sidebarBackground: "#eef1f5",
    codeTheme: HEYSNAP_LIGHT_ID,
    xlsxClassName: "theme-light",
  },
};

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const APRYSE_LICENSE_KEY =
  import.meta.env.VITE_APRYSE_LICENSE_KEY ||
  "demo:1779706095669:63187a52030000000065b902b995af262c1b7e2b5c56aa901fd7282a7d";
const APRYSE_WEBVIEWER_PATH =
  import.meta.env.VITE_APRYSE_WEBVIEWER_PATH || "lib/webviewer";

type PreviewerCallbacks = {
  readonly onReady?: () => void;
  readonly onError?: (error: Error) => void;
};

type ThemedPreviewerCallbacks = PreviewerCallbacks & {
  readonly theme: ViewerThemeConfig;
};

export function Previewer({
  item,
  theme = "dark",
  onReady,
  onError,
}: {
  readonly item: PreviewItem;
  readonly theme?: PreviewTheme;
} & PreviewerCallbacks): React.ReactElement {
  const viewerTheme = VIEWER_THEMES[theme];

  if (item.kind === "workbook") {
    return <XlsxPreview data={item.data} theme={viewerTheme} onReady={onReady} onError={onError} />;
  }

  if (item.kind === "html") {
    return <HtmlPreview data={item.data} theme={viewerTheme} onReady={onReady} onError={onError} />;
  }

  return renderFile(item.file, { theme: viewerTheme, onReady, onError });
}

const HtmlPreview = ({
  data,
  theme,
  onReady,
  onError,
}: {
  readonly data: PreviewHtml;
} & ThemedPreviewerCallbacks): React.ReactElement => {
  const separator = data.url.includes("?") ? "&" : "?";
  const src = `${data.url}${separator}v=${String(data.mtime)}`;

  return (
    <HeySnapHtmlViewer
      src={src}
      change={data.change}
      documentName={data.name}
      headerBackground={theme.headerBackground}
      headerForeground={theme.headerForeground}
      bodyBackground={theme.codeBodyBackground}
      onReady={onReady}
      onError={onError}
    />
  );
};

const renderFile = (file: PreviewFile, callbacks: ThemedPreviewerCallbacks): React.ReactElement => {
  const lowerPath = file.path.toLowerCase();

  if (file.mime === "application/pdf" || lowerPath.endsWith(".pdf")) {
    return <PdfPreview file={file} {...callbacks} />;
  }

  if (file.mime === DOCX_MIME || lowerPath.endsWith(".docx")) {
    return <DocxPreview file={file} {...callbacks} />;
  }

  if (file.mime === PPTX_MIME || lowerPath.endsWith(".pptx")) {
    return <PptPreview file={file} {...callbacks} />;
  }

  if (isMarkdown(file)) {
    return <MarkdownPreview file={file} {...callbacks} />;
  }

  if (isCsv(file)) {
    return <CsvPreview file={file} {...callbacks} />;
  }

  if (isCode(file)) {
    return <CodePreview file={file} {...callbacks} />;
  }

  if (file.mime.startsWith("image/")) {
    return <ImagePreview file={file} {...callbacks} />;
  }

  if (file.mime.startsWith("video/")) {
    return <VideoPreview file={file} {...callbacks} />;
  }

  if (file.mime.startsWith("audio/")) {
    return <AudioPreview file={file} {...callbacks} />;
  }

  return <FallbackPreview file={file} {...callbacks} />;
};

const PdfPreview = ({
  file,
  theme,
  onReady,
  onError,
}: {
  readonly file: PreviewFile;
} & ThemedPreviewerCallbacks): React.ReactElement => {
  const bytes = useMemo(() => base64ToBytes(requiredFileData(file)), [file]);

  return (
    <HeySnapPdfViewer
      src={bytes}
      onReady={onReady}
      onError={onError}
      headerBackground={theme.headerBackground}
      headerForeground={theme.headerForeground}
      bodyBackground={theme.bodyBackground}
      sidebarBackground={theme.sidebarBackground}
    />
  );
};

const DocxPreview = ({
  file,
  theme,
  onReady,
  onError,
}: {
  readonly file: PreviewFile;
} & ThemedPreviewerCallbacks): React.ReactElement => {
  const bytes = useMemo(() => base64ToBytes(requiredFileData(file)), [file]);

  return (
    <HeySnapDocxViewer
      src={bytes}
      documentName={file.name}
      onReady={onReady}
      onError={onError}
      headerBackground={theme.headerBackground}
      headerForeground={theme.headerForeground}
      bodyBackground={theme.bodyBackground}
    />
  );
};

const PptPreview = ({
  file,
  theme,
  onReady,
  onError,
}: {
  readonly file: PreviewFile;
} & ThemedPreviewerCallbacks): React.ReactElement => {
  const bytes = useMemo(() => base64ToBytes(requiredFileData(file)), [file]);

  return (
    <HeySnapPPTViewer2
      src={bytes}
      licenseKey={APRYSE_LICENSE_KEY}
      webViewerPath={APRYSE_WEBVIEWER_PATH}
      documentName={file.name}
      onReady={onReady}
      onError={onError}
      headerBackground={theme.headerBackground}
      headerForeground={theme.headerForeground}
      bodyBackground={theme.bodyBackground}
    />
  );
};

const CodePreview = ({
  file,
  theme,
  onReady,
  onError,
}: {
  readonly file: PreviewFile;
} & ThemedPreviewerCallbacks): React.ReactElement => {
  const src = useMemo(
    () => new File([base64ToBytes(requiredFileData(file))], file.name, { type: "text/plain" }),
    [file],
  );

  return (
    <HeySnapCodeViewer
      src={src}
      documentName={file.name}
      theme={theme.codeTheme}
      headerBackground={theme.headerBackground}
      headerForeground={theme.headerForeground}
      bodyBackground={theme.codeBodyBackground}
      onReady={onReady}
      onError={onError}
    />
  );
};

const CsvPreview = ({
  file,
  theme,
  onReady,
  onError,
}: {
  readonly file: PreviewFile;
} & ThemedPreviewerCallbacks): React.ReactElement => {
  const src = useMemo(() => fileToBrowserFile(file), [file]);

  return (
    <HeySnapCsvViewer
      src={src}
      documentName={file.name}
      colorScheme={theme.mode}
      headerBackground={theme.headerBackground}
      headerForeground={theme.headerForeground}
      bodyBackground={theme.codeBodyBackground}
      onReady={onReady}
      onError={onError}
    />
  );
};

const MarkdownPreview = ({
  file,
  theme,
  onReady,
  onError,
}: {
  readonly file: PreviewFile;
} & ThemedPreviewerCallbacks): React.ReactElement => {
  const src = useMemo(
    () => new File([base64ToBytes(requiredFileData(file))], file.name, { type: "text/markdown" }),
    [file],
  );

  return (
    <HeySnapMarkdownViewer
      src={src}
      assetBaseUrl={file.assetBaseUrl}
      documentName={file.name}
      codeTheme={theme.codeTheme}
      headerBackground={theme.headerBackground}
      headerForeground={theme.headerForeground}
      bodyBackground={theme.codeBodyBackground}
      onReady={onReady}
      onError={onError}
    />
  );
};

const XlsxPreview = ({
  data,
  theme,
  onReady,
}: {
  readonly data: PreviewWorkbook;
} & ThemedPreviewerCallbacks): React.ReactElement => {
  const downloadFile = useMemo(
    () =>
      typeof data.data === "string"
        ? new Blob([base64ToBytes(data.data)], { type: XLSX_MIME })
        : null,
    [data.data],
  );

  return (
    <div className={`${theme.xlsxClassName} preview-xlsx-shell`}>
      <HeySnapXlsxViewer
        workbook={data.workbook}
        workbookChange={data.change}
        title={data.name}
        darkBgColor={VIEWER_THEMES.dark.bodyBackground}
        lightBgColor={VIEWER_THEMES.light.codeBodyBackground}
        downloadFile={downloadFile}
        downloadUrl={data.downloadUrl}
        downloadFileName={data.name}
        downloadMime={XLSX_MIME}
        allowJsonDownloadFallback={false}
        onReady={onReady}
      />
    </div>
  );
};

const ImagePreview = ({
  file,
  theme,
  onReady,
  onError,
}: {
  readonly file: PreviewFile;
} & ThemedPreviewerCallbacks): React.ReactElement => {
  const src = useMemo(() => fileToBrowserFile(file), [file]);

  return (
    <HeySnapImageViewer
      src={src}
      documentName={file.name}
      headerBackground={theme.headerBackground}
      headerForeground={theme.headerForeground}
      bodyBackground={theme.bodyBackground}
      onReady={onReady}
      onError={onError}
    />
  );
};

const VideoPreview = ({
  file,
  theme,
  onReady,
  onError,
}: {
  readonly file: PreviewFile;
} & ThemedPreviewerCallbacks): React.ReactElement => {
  const src = useMemo(() => file.sourceUrl ?? fileToBrowserFile(file), [file]);

  return (
    <HeySnapVideoViewer
      src={src}
      downloadUrl={file.downloadUrl}
      documentName={file.name}
      headerBackground={theme.headerBackground}
      headerForeground={theme.headerForeground}
      bodyBackground={theme.mediaBodyBackground}
      onReady={onReady}
      onError={onError}
    />
  );
};

const AudioPreview = ({
  file,
  theme,
  onReady,
  onError,
}: {
  readonly file: PreviewFile;
} & ThemedPreviewerCallbacks): React.ReactElement => {
  const src = useMemo(() => fileToBrowserFile(file), [file]);

  return (
    <HeySnapAudioPlayer
      src={src}
      documentName={file.name}
      headerBackground={theme.headerBackground}
      headerForeground={theme.headerForeground}
      bodyBackground={theme.bodyBackground}
      onReady={onReady}
      onError={onError}
    />
  );
};

const FallbackPreview = ({
  file,
  onReady,
}: {
  readonly file: PreviewFile;
} & ThemedPreviewerCallbacks): React.ReactElement => {
  const fileData = requiredFileData(file);
  const dataUrl = useMemo(() => `data:${file.mime};base64,${fileData}`, [fileData, file.mime]);

  if (
    file.mime.startsWith("text/") ||
    file.mime === "application/json" ||
    file.mime === "application/xml"
  ) {
    return (
      <ReadyAfterPaint onReady={onReady}>
        <pre className="preview-text-fallback">{decodeTextFile(fileData)}</pre>
      </ReadyAfterPaint>
    );
  }

  return (
    <ReadyAfterPaint onReady={onReady}>
      <div className="preview-download-fallback">
        <a href={dataUrl} download={file.name}>
          Download {file.name} ({formatBytes(file.size)})
        </a>
      </div>
    </ReadyAfterPaint>
  );
};

const fileToBrowserFile = (file: PreviewFile): File =>
  new File([base64ToBytes(requiredFileData(file))], file.name, { type: file.mime });

const requiredFileData = (file: PreviewFile): string => {
  if (typeof file.data === "string") {
    return file.data;
  }

  throw new Error(`Preview data missing for ${file.name}.`);
};

const ReadyAfterPaint = ({
  children,
  onReady,
}: {
  readonly children: React.ReactElement;
  readonly onReady?: () => void;
}): React.ReactElement => {
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => onReady?.());
    return () => window.cancelAnimationFrame(frame);
  }, [onReady]);

  return children;
};

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdx"]);
const CSV_EXTENSIONS = new Set([".csv", ".tsv"]);
const CSV_MIME_TYPES = new Set(["text/csv", "text/tab-separated-values"]);
const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonc",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".py",
  ".rb",
  ".rs",
  ".go",
  ".java",
  ".kt",
  ".swift",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".cc",
  ".cs",
  ".php",
  ".lua",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".sql",
  ".r",
  ".dart",
  ".scala",
  ".clj",
  ".ex",
  ".exs",
  ".elm",
  ".hs",
  ".proto",
  ".gql",
  ".graphql",
  ".env",
  ".dockerfile",
  ".makefile",
  ".txt",
  ".log",
]);

const isMarkdown = (file: PreviewFile): boolean =>
  file.mime === "text/markdown" || MARKDOWN_EXTENSIONS.has(extensionOf(file.path));

const isCsv = (file: PreviewFile): boolean =>
  CSV_MIME_TYPES.has(file.mime) || CSV_EXTENSIONS.has(extensionOf(file.path));

const isCode = (file: PreviewFile): boolean => {
  if (CODE_EXTENSIONS.has(extensionOf(file.path))) {
    return true;
  }

  return (
    file.mime.startsWith("text/") ||
    file.mime === "application/json" ||
    file.mime === "application/xml"
  );
};

const extensionOf = (path: string): string => {
  const index = path.lastIndexOf(".");
  return index >= 0 ? path.slice(index).toLowerCase() : "";
};

const base64ToBytes = (base64: string): Uint8Array<ArrayBuffer> => {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
};

const decodeTextFile = (base64: string): string => {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(base64ToBytes(base64));
  } catch {
    return window.atob(base64);
  }
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${String(bytes)} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
};
