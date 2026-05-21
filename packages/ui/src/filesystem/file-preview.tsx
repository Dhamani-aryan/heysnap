"use client";

import type { ReactElement } from "react";

export type FilePreviewProps = {
  readonly name: string;
  readonly path: string;
  readonly websocketUrl: string;
  readonly previewBaseUrl?: string;
  /** Cache-buster used to refetch the file when it changes (e.g. updatedAt or version). */
  readonly version?: string;
};

export function FilePreview({
  name,
  path,
  previewBaseUrl,
  websocketUrl,
  version,
}: FilePreviewProps): ReactElement {
  const resolvedPreviewBaseUrl = resolveFilesystemPreviewBaseUrl(websocketUrl, previewBaseUrl);

  if (resolvedPreviewBaseUrl === null) {
    return (
      <section className="heysnap-document-viewer" aria-label={name} style={{ width: "100%", height: "100%" }}>
        <div className="document-viewer-state error">
          <p>File preview is not available on this server yet. Restart or update the cloud server and machine server.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="heysnap-document-viewer" aria-label={name} style={{ width: "100%", height: "100%" }}>
      <iframe
        className="heysnap-file-preview-frame"
        src={buildFilesystemPreviewerUrl(resolvedPreviewBaseUrl, path, version)}
        title={name}
      />
    </section>
  );
}

export const resolveFilesystemPreviewBaseUrl = (
  filesystemWebsocketUrl: string,
  previewBaseUrl?: string,
): string | null => {
  if (previewBaseUrl !== undefined && previewBaseUrl.trim().length > 0) {
    return previewBaseUrl;
  }

  return isGatewayFilesystemWebsocketUrl(filesystemWebsocketUrl)
    ? null
    : deriveFilesystemPreviewBaseUrl(filesystemWebsocketUrl);
};

export const deriveFilesystemPreviewBaseUrl = (filesystemWebsocketUrl: string): string => {
  const baseUrl = typeof window !== "undefined" && typeof window.location?.href === "string"
    ? window.location.href
    : "http://localhost";
  const url = new URL(filesystemWebsocketUrl, baseUrl);

  if (url.protocol === "ws:") {
    url.protocol = "http:";
  } else if (url.protocol === "wss:") {
    url.protocol = "https:";
  }

  const previewPathname = url.pathname.replace(/\/filesystem\/?$/u, "/preview");
  url.pathname = previewPathname === url.pathname ? "/preview" : previewPathname;
  url.searchParams.delete("path");
  url.searchParams.delete("showHidden");
  url.searchParams.delete("v");

  return url.toString();
};

export const buildFilesystemPreviewerUrl = (
  previewBaseUrl: string,
  path: string,
  version?: string,
): string => {
  const baseUrl = typeof window !== "undefined" && typeof window.location?.href === "string"
    ? window.location.href
    : "http://localhost";
  const url = new URL(previewBaseUrl, baseUrl);

  url.searchParams.delete("path");
  url.searchParams.delete("root");
  url.searchParams.delete("chrome");
  url.searchParams.delete("v");
  url.searchParams.set("path", path);
  url.searchParams.set("chrome", "0");

  if (version !== undefined && version.length > 0) {
    url.searchParams.set("v", version);
  }

  return url.toString();
};

export const isGatewayFilesystemWebsocketUrl = (filesystemWebsocketUrl: string): boolean => {
  try {
    const baseUrl = typeof window !== "undefined" && typeof window.location?.href === "string"
      ? window.location.href
      : "http://localhost";
    const url = new URL(filesystemWebsocketUrl, baseUrl);
    return /^\/gateway\/computers\/[^/]+\/filesystem\/?$/u.test(url.pathname);
  } catch {
    return false;
  }
};

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
  const baseUrl = typeof window !== "undefined" && typeof window.location?.href === "string"
    ? window.location.href
    : "http://localhost";
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
  const baseUrl = typeof window !== "undefined" && typeof window.location?.href === "string"
    ? window.location.href
    : "http://localhost";
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
  const baseUrl = typeof window !== "undefined" && typeof window.location?.href === "string"
    ? window.location.href
    : "http://localhost";
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
