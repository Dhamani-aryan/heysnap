"use client";

import type { ReactElement } from "react";

export type FilePreviewProps = {
  readonly name: string;
  readonly path: string;
  readonly websocketUrl: string;
  readonly previewBaseUrl?: string;
};

export function FilePreview({
  name,
  path,
  previewBaseUrl,
  websocketUrl,
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
        src={buildFilesystemPreviewerUrl(resolvedPreviewBaseUrl, path)}
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

  return url.toString();
};

export const isSameFilesystemPreviewerDocumentUrl = (leftUrl: string, rightUrl: string): boolean => {
  try {
    return normalizeFilesystemPreviewerDocumentUrl(leftUrl) === normalizeFilesystemPreviewerDocumentUrl(rightUrl);
  } catch {
    return leftUrl === rightUrl;
  }
};

export const normalizeFilesystemPreviewerDocumentUrl = (rawUrl: string): string => {
  const baseUrl = typeof window !== "undefined" && typeof window.location?.href === "string"
    ? window.location.href
    : "http://localhost";
  const url = new URL(rawUrl, baseUrl);

  url.searchParams.delete("accessToken");
  url.searchParams.delete("token");
  url.searchParams.delete("v");
  sortSearchParams(url);
  url.hash = "";

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

const sortSearchParams = (url: URL): void => {
  const entries = Array.from(url.searchParams.entries())
    .sort(([leftName, leftValue], [rightName, rightValue]) =>
      leftName === rightName ? leftValue.localeCompare(rightValue) : leftName.localeCompare(rightName)
    );

  url.search = "";

  for (const [name, value] of entries) {
    url.searchParams.append(name, value);
  }
};
