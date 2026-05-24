import {
  ArrowLeft02Icon,
  Moon02Icon,
  PowerIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState, type ReactElement } from "react";

import type { FilesystemConnectionStatus } from "../../../filesystem/filesystem-client";

export const MachineStatusControl = ({
  canSleepMachine,
  compact,
  machineName,
  status,
  onBack,
  onSleep,
}: {
  readonly canSleepMachine: boolean;
  readonly compact: boolean;
  readonly machineName: string;
  readonly status: FilesystemConnectionStatus;
  readonly onBack?: () => void;
  readonly onSleep?: () => Promise<void>;
}): ReactElement => {
  const [isOpen, setIsOpen] = useState(false);
  const [isSleeping, setIsSleeping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const statusLabel = getFilesystemConnectionLabel(status);
  const isSleepDisabled = !canSleepMachine || onSleep === undefined || isSleeping;
  const isBackDisabled = onBack === undefined || isSleeping;
  const buttonClassName = [
    "machine-status-button",
    isOpen ? "active" : "",
    compact ? "icon-only" : "",
  ].filter(Boolean).join(" ");

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const closeMenu = (event: PointerEvent): void => {
      const target = event.target;

      if (target instanceof Node && containerRef.current?.contains(target)) {
        return;
      }

      setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeMenu, true);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeMenu, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  const sleepMachine = (): void => {
    if (isSleepDisabled || onSleep === undefined) {
      return;
    }

    setIsSleeping(true);
    setError(null);

    void onSleep()
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : "Failed to sleep machine.");
      })
      .finally(() => {
        setIsSleeping(false);
      });
  };

  return (
    <div ref={containerRef} className="machine-status-control">
      {isOpen ? (
        <div className="machine-status-popover" role="dialog" aria-label="Machine actions">
          <button
            type="button"
            className="machine-status-action"
            disabled={isSleepDisabled}
            title={canSleepMachine ? "Sleep machine" : "Local machines cannot be slept from here"}
            onClick={sleepMachine}
          >
            {isSleeping ? (
              <span className="machine-status-action-spinner" aria-hidden="true" />
            ) : (
              <HugeiconsIcon icon={Moon02Icon} size={17} color="currentColor" strokeWidth={1.8} />
            )}
            <span>Sleep</span>
          </button>
          <button
            type="button"
            className="machine-status-action"
            disabled={isBackDisabled}
            onClick={() => {
              onBack?.();
              setIsOpen(false);
            }}
          >
            <HugeiconsIcon icon={ArrowLeft02Icon} size={17} color="currentColor" strokeWidth={1.8} />
            <span>Back</span>
          </button>
          {error === null ? null : <div className="machine-status-error">{error}</div>}
        </div>
      ) : null}

      <button
        type="button"
        className={buttonClassName}
        aria-label={`${machineName}, ${statusLabel}`}
        title={`${machineName} · ${statusLabel}`}
        aria-expanded={isOpen}
        onClick={() => {
          setError(null);
          setIsOpen((current) => !current);
        }}
      >
        <HugeiconsIcon icon={PowerIcon} size={12} color="currentColor" strokeWidth={1.8} />
        <span className="machine-status-label">{machineName}</span>
        <ConnectionStatusIndicator status={status} />
      </button>
    </div>
  );
};

const ConnectionStatusIndicator = ({
  status,
}: {
  readonly status: FilesystemConnectionStatus;
}): ReactElement => {
  if (status === "connecting") {
    return <span className="machine-status-spinner" aria-hidden="true" />;
  }

  return <span className="machine-status-dot" data-status={status} aria-hidden="true" />;
};

const getFilesystemConnectionLabel = (status: FilesystemConnectionStatus): string => {
  switch (status) {
    case "alive":
      return "Connected";
    case "connecting":
      return "Connecting";
    case "closed":
      return "Disconnected";
  }
};
