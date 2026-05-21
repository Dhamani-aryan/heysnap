import { useMemo } from "react";
import { HeySnapCodeViewer } from "heysnap-web-viewers/code";
import { HeySnapDocxViewer } from "heysnap-web-viewers/docx";
import { HeySnapMarkdownViewer } from "heysnap-web-viewers/markdown";
import { HeySnapPdfViewer } from "heysnap-web-viewers/pdf";
import { HeySnapPPTViewer } from "heysnap-web-viewers/ppt";
import { HeySnapXlsxViewer } from "heysnap-web-viewers/xlsx";

import type { PreviewFile, PreviewHtml, PreviewItem, PreviewWorkbook } from "../protocol";

const DARK_VIEWER_PROPS = {
  headerBackground: "#0f0f11",
  headerForeground: "#f4f6fb",
  bodyBackground: "#0b0e13",
} as const;

const PDF_DARK_PROPS = {
  ...DARK_VIEWER_PROPS,
  sidebarBackground: "#161b22",
} as const;

const PPT_DARK_PROPS = {
  ...DARK_VIEWER_PROPS,
  sidebarBackground: "#161b22",
} as const;

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const PPT_SERVER_URL =
  import.meta.env.VITE_PPT_SERVER_URL ||
  "http://13.126.207.124/Kd5QihM3zhwV2WztLXAnBc6n07Goa6O3mByrs-rqWjU/ppt";

export function Previewer({ item }: { readonly item: PreviewItem }): React.ReactElement {
  if (item.kind === "workbook") {
    return <XlsxPreview data={item.data} />;
  }

  if (item.kind === "html") {
    return <HtmlPreview data={item.data} />;
  }

  return renderFile(item.file);
}

const HtmlPreview = ({ data }: { readonly data: PreviewHtml }): React.ReactElement => {
  const separator = data.url.includes("?") ? "&" : "?";
  const src = `${data.url}${separator}v=${String(data.mtime)}`;

  return (
    <iframe
      key={`${data.path}:${String(data.mtime)}`}
      className="preview-html-frame"
      src={src}
      title={data.name}
    />
  );
};

const renderFile = (file: PreviewFile): React.ReactElement => {
  const lowerPath = file.path.toLowerCase();

  if (file.mime === "application/pdf" || lowerPath.endsWith(".pdf")) {
    return <PdfPreview file={file} />;
  }

  if (file.mime === DOCX_MIME || lowerPath.endsWith(".docx")) {
    return <DocxPreview file={file} />;
  }

  if (file.mime === PPTX_MIME || lowerPath.endsWith(".pptx")) {
    return <PptPreview file={file} />;
  }

  if (isMarkdown(file)) {
    return <MarkdownPreview file={file} />;
  }

  if (isCode(file)) {
    return <CodePreview file={file} />;
  }

  return <FallbackPreview file={file} />;
};

const PdfPreview = ({ file }: { readonly file: PreviewFile }): React.ReactElement => {
  const bytes = useMemo(() => base64ToBytes(file.data), [file.data]);

  return (
    <HeySnapPdfViewer
      key={`${file.path}:${String(file.mtime)}`}
      src={bytes}
      {...PDF_DARK_PROPS}
    />
  );
};

const DocxPreview = ({ file }: { readonly file: PreviewFile }): React.ReactElement => {
  const bytes = useMemo(() => base64ToBytes(file.data), [file.data]);

  return (
    <HeySnapDocxViewer
      key={`${file.path}:${String(file.mtime)}`}
      src={bytes}
      documentName={file.name}
      {...DARK_VIEWER_PROPS}
    />
  );
};

const PptPreview = ({ file }: { readonly file: PreviewFile }): React.ReactElement => {
  const bytes = useMemo(() => base64ToBytes(file.data), [file.data]);

  return (
    <HeySnapPPTViewer
      key={`${file.path}:${String(file.mtime)}`}
      src={bytes}
      serverUrl={PPT_SERVER_URL}
      documentName={file.name}
      {...PPT_DARK_PROPS}
    />
  );
};

const CodePreview = ({ file }: { readonly file: PreviewFile }): React.ReactElement => {
  const src = useMemo(
    () => new File([base64ToBytes(file.data)], file.name, { type: "text/plain" }),
    [file.data, file.name],
  );

  return (
    <HeySnapCodeViewer
      key={`${file.path}:${String(file.mtime)}`}
      src={src}
      documentName={file.name}
      theme="vs-dark"
      headerBackground={DARK_VIEWER_PROPS.headerBackground}
      headerForeground={DARK_VIEWER_PROPS.headerForeground}
      bodyBackground={DARK_VIEWER_PROPS.headerBackground}
    />
  );
};

const MarkdownPreview = ({ file }: { readonly file: PreviewFile }): React.ReactElement => {
  const src = useMemo(
    () => new File([base64ToBytes(file.data)], file.name, { type: "text/markdown" }),
    [file.data, file.name],
  );

  return (
    <HeySnapMarkdownViewer
      key={`${file.path}:${String(file.mtime)}`}
      src={src}
      documentName={file.name}
      codeTheme="heysnap-dark"
      headerBackground={DARK_VIEWER_PROPS.headerBackground}
      headerForeground={DARK_VIEWER_PROPS.headerForeground}
      bodyBackground={DARK_VIEWER_PROPS.bodyBackground}
    />
  );
};

const XlsxPreview = ({ data }: { readonly data: PreviewWorkbook }): React.ReactElement => (
  <div className="theme-dark preview-xlsx-shell">
    <HeySnapXlsxViewer
      key={`${data.path}:${String(data.mtime)}`}
      workbook={data.workbook}
      title={data.name}
      darkBgColor="#0b0e13"
    />
  </div>
);

const FallbackPreview = ({ file }: { readonly file: PreviewFile }): React.ReactElement => {
  const dataUrl = useMemo(() => `data:${file.mime};base64,${file.data}`, [file.data, file.mime]);

  if (file.mime.startsWith("image/")) {
    return (
      <div className="preview-media-shell">
        <img src={dataUrl} alt={file.name} />
      </div>
    );
  }

  if (file.mime.startsWith("video/")) {
    return (
      <div className="preview-media-shell">
        <video src={dataUrl} controls />
      </div>
    );
  }

  if (file.mime.startsWith("audio/")) {
    return (
      <div className="preview-media-shell">
        <audio src={dataUrl} controls />
      </div>
    );
  }

  if (
    file.mime.startsWith("text/") ||
    file.mime === "application/json" ||
    file.mime === "application/xml"
  ) {
    return <pre className="preview-text-fallback">{decodeTextFile(file.data)}</pre>;
  }

  return (
    <div className="preview-download-fallback">
      <a href={dataUrl} download={file.name}>
        Download {file.name} ({formatBytes(file.size)})
      </a>
    </div>
  );
};

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdx"]);
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
