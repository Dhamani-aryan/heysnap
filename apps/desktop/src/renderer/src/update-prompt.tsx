import { useEffect, useState } from "react";

import type { DesktopUpdateStatus } from "../../shared/desktop-updates";

export function DesktopUpdatePrompt(): React.ReactElement | null {
  const bridge = window.ank1015DesktopUpdates;
  const [status, setStatus] = useState<DesktopUpdateStatus | null>(null);

  useEffect(() => {
    if (bridge === undefined) {
      return;
    }

    let isCurrent = true;

    void bridge.getUpdateStatus().then((nextStatus) => {
      if (isCurrent) {
        setStatus(nextStatus);
      }
    });

    const unsubscribe = bridge.onStatusChanged((nextStatus) => {
      setStatus(nextStatus);
    });

    return () => {
      isCurrent = false;
      unsubscribe();
    };
  }, [bridge]);

  if (bridge === undefined || status === null || status.latest === null) {
    return null;
  }

  const shouldShow =
    status.state === "downloading" ||
    status.state === "downloaded" ||
    status.state === "error" ||
    (status.state === "available" && status.latest.version !== status.dismissedVersion);

  if (!shouldShow) {
    return null;
  }

  const isBusy = status.state === "downloading";
  const title = status.state === "downloaded" ? "Update ready" : "Update available";
  const primaryLabel = status.state === "downloaded"
    ? "Restart to update"
    : status.state === "downloading"
      ? "Downloading..."
      : status.isPackaged
        ? "Update"
        : "Download";

  const onDismiss = (): void => {
    if (status.latest !== null) {
      void bridge.dismissUpdate(status.latest.version);
    }
  };

  const onUpdate = (): void => {
    void bridge.downloadAndInstallUpdate();
  };

  return (
    <div className="desktop-update-backdrop" role="presentation">
      <section className="desktop-update-modal" role="dialog" aria-modal="true" aria-labelledby="desktop-update-title">
        <div className="desktop-update-heading">
          <h2 id="desktop-update-title">{title}</h2>
          <p>
            {status.currentVersion} to {status.latest.version}
          </p>
        </div>

        {status.latest.notes !== null && status.latest.notes.length > 0 ? (
          <p className="desktop-update-notes">{status.latest.notes}</p>
        ) : null}

        {status.state === "downloaded" ? (
          <p className="desktop-update-message">The update has downloaded and can be installed now.</p>
        ) : null}

        {status.state === "error" && status.error !== null ? (
          <p className="desktop-update-error">{status.error}</p>
        ) : null}

        {status.state === "downloading" ? (
          <div className="desktop-update-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(status.progress?.percent ?? 0)}>
            <span style={{ width: `${Math.max(0, Math.min(100, status.progress?.percent ?? 0))}%` }} />
          </div>
        ) : null}

        <div className="desktop-update-actions">
          <button className="cloud-text-button" type="button" onClick={onDismiss} disabled={isBusy}>
            Later
          </button>
          <button className="cloud-primary-button" type="button" onClick={onUpdate} disabled={isBusy}>
            {primaryLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
