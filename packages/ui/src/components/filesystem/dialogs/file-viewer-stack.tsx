import { memo, type ReactElement } from "react";

import {
  buildFilesystemPreviewerUrl,
  resolveFilesystemPreviewBaseUrl,
} from "../../../filesystem/file-preview";
import type { OpenFileTab } from "../finder/finder-types";

const FileViewer = ({
  file,
  filesystemPreviewBaseUrl,
  websocketUrl,
}: {
  readonly file: OpenFileTab;
  readonly filesystemPreviewBaseUrl?: string;
  readonly websocketUrl: string;
}): ReactElement => {
  const previewBaseUrl = resolveFilesystemPreviewBaseUrl(websocketUrl, filesystemPreviewBaseUrl);

  if (previewBaseUrl === null) {
    return (
      <section className="heysnap-document-viewer" aria-label={file.name}>
        <DocumentViewerState
          message="File preview is not available on this server yet. Restart or update the cloud server and machine server."
          variant="error"
        />
      </section>
    );
  }

  return (
    <section className="heysnap-document-viewer" aria-label={file.name}>
      <iframe
        className="heysnap-file-preview-frame"
        src={buildFilesystemPreviewerUrl(previewBaseUrl, file.path)}
        title={file.name}
      />
    </section>
  );
};

const MemoizedFileViewer = memo(FileViewer);

export const FileViewerStack = ({
  openFileTabs,
  activeFilePath,
  filesystemPreviewBaseUrl,
  websocketUrl,
}: {
  readonly openFileTabs: OpenFileTab[];
  readonly activeFilePath: string | null;
  readonly filesystemPreviewBaseUrl?: string;
  readonly websocketUrl: string;
}): ReactElement => (
  <>
    {openFileTabs.map((tab) => {
      const isActive = tab.path === activeFilePath;

      return (
        <div
          key={tab.path}
          className={isActive ? "left-pane-surface active" : "left-pane-surface inactive"}
          aria-hidden={!isActive}
        >
          <MemoizedFileViewer
            file={tab}
            filesystemPreviewBaseUrl={filesystemPreviewBaseUrl}
            websocketUrl={websocketUrl}
          />
        </div>
      );
    })}
  </>
);

const DocumentViewerState = ({
  message,
  variant = "info",
}: {
  readonly message: string;
  readonly variant?: "info" | "error";
}): ReactElement => (
  <div className={variant === "error" ? "document-viewer-state error" : "document-viewer-state"}>
    <p>{message}</p>
  </div>
);
