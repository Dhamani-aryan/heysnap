import type { ReactElement } from "react";

import type { UploadProgressState } from "./filesystem-dialog-types";
import { Spinner } from "../finder/finder-icons";
import { formatBytes } from "../shared/filesystem-format";

export const UploadProgressDialog = ({
  progress,
}: {
  readonly progress: UploadProgressState;
}): ReactElement => {
  const percent = progress.totalBytes === 0
    ? 100
    : Math.max(0, Math.min(100, (progress.completedBytes / progress.totalBytes) * 100));

  return (
    <div className="upload-progress-backdrop" role="presentation">
      <div
        className="upload-progress-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-progress-title"
      >
        <div className="upload-progress-heading">
          <div>
            <h2 id="upload-progress-title">{progress.title}</h2>
            <p>{progress.phase === "uploading" ? "Finishing upload" : progress.detail}</p>
          </div>
          <Spinner />
        </div>
        <div
          className="upload-progress-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
        >
          <span style={{ width: `${percent}%` }} />
        </div>
        <div className="upload-progress-meta">
          <span>{Math.round(percent)}%</span>
          <span>{formatBytes(progress.completedBytes)} / {formatBytes(progress.totalBytes)}</span>
        </div>
      </div>
    </div>
  );
};
