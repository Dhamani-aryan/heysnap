import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactElement } from "react";

import type { FeedbackSubmitState, UploadProgressState } from "./filesystem-dialog-types";
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

export const FeedbackDialog = ({
  comment,
  currentPath,
  selectedThreadId,
  state,
  onChangeComment,
  onClose,
  onSubmit,
}: {
  readonly comment: string;
  readonly currentPath: string;
  readonly selectedThreadId: string | null;
  readonly state: FeedbackSubmitState;
  readonly onChangeComment: (value: string) => void;
  readonly onClose: () => void;
  readonly onSubmit: () => void;
}): ReactElement => {
  const canSubmit = comment.trim().length > 0 && state.status !== "submitting";

  return (
    <div className="feedback-dialog-backdrop" role="presentation">
      <form
        className="feedback-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-dialog-title"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) {
            onSubmit();
          }
        }}
      >
        <div className="feedback-dialog-heading">
          <div>
            <h2 id="feedback-dialog-title">Share feedback</h2>
            <p>{currentPath.length === 0 ? "Workspace root" : currentPath}</p>
          </div>
          <button
            type="button"
            className="feedback-dialog-close"
            aria-label="Close feedback"
            title="Close"
            disabled={state.status === "submitting"}
            onClick={onClose}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={16} color="currentColor" strokeWidth={1.8} />
          </button>
        </div>
        <textarea
          className="feedback-dialog-input"
          value={comment}
          maxLength={5_000}
          autoFocus
          placeholder="What should we know?"
          aria-label="Feedback comment"
          disabled={state.status === "submitting"}
          onChange={(event) => onChangeComment(event.currentTarget.value)}
        />
        <div className="feedback-dialog-meta">
          <span>{selectedThreadId === null ? "No thread selected" : selectedThreadId}</span>
          <span>{comment.length}/5000</span>
        </div>
        <div className="feedback-dialog-actions">
          <button
            type="button"
            className="feedback-dialog-secondary"
            disabled={state.status === "submitting"}
            onClick={onClose}
          >
            Close
          </button>
          <button
            type="submit"
            className="feedback-dialog-primary"
            disabled={!canSubmit}
          >
            {state.status === "submitting" ? "Sending" : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
};
