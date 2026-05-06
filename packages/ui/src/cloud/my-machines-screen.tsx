"use client";

import { ArrowRight02Icon, PlusSignIcon, Settings03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect } from "react";

import macLightImageUrl from "../../../../apps/assets/mac-light.png";
import macImageUrl from "../../../../apps/assets/mac.png";
import newMacLightImageUrl from "../../../../apps/assets/new-mac-light.png";
import newMacImageUrl from "../../../../apps/assets/new-mac.png";
import { ThemeToggle } from "../filesystem/theme-toggle";
import type { CloudComputer, CloudUser } from "./cloud-client";

type ImageAsset = string | { readonly src: string };

const getImageSrc = (asset: ImageAsset): string => {
  return typeof asset === "string" ? asset : asset.src;
};

export interface MyMachinesScreenProps {
  readonly activeLocalComputerId: string | null;
  readonly computers: CloudComputer[];
  readonly error: string | null;
  readonly isCreatingMachine: boolean;
  readonly isLoading: boolean;
  readonly onOpenMachine: (computer: CloudComputer) => void;
  readonly onLogout: () => Promise<void>;
  readonly onRefresh: () => Promise<void>;
  readonly onStartCreateMachine: () => void;
  readonly user: CloudUser;
}

export function MyMachinesScreen({
  computers,
  onLogout,
  onOpenMachine,
  onStartCreateMachine,
}: MyMachinesScreenProps): React.ReactElement {
  const sortedComputers = [...computers].sort(compareMachinesForDisplay);

  useEffect(() => {
    document.documentElement.dataset.cloudScreen = "machines";

    return () => {
      delete document.documentElement.dataset.cloudScreen;
    };
  }, []);

  return (
    <main className="cloud-shell">
      <header className="cloud-topbar">
        <div className="cloud-topbar-actions">
          <ThemeToggle />
          <button
            className="theme-toggle"
            title="Settings"
            type="button"
            aria-label="Settings"
            onClick={() => void onLogout()}
          >
            <HugeiconsIcon icon={Settings03Icon} size={18} color="currentColor" strokeWidth={1.8} />
          </button>
        </div>
      </header>

      <section className="cloud-machines-page">
        <div className="cloud-machines-page-inner">
          <h1 className="cloud-machines-title">Machines</h1>
          <p className="cloud-machines-subtitle">
            Your cloud and local computers. <span>Learn more</span>
          </p>

          <div className="cloud-machines-grid">
            {sortedComputers.map((computer) => (
              <MachineCard
                key={computer.id}
                computer={computer}
                onOpenMachine={onOpenMachine}
              />
            ))}
            <button
              aria-label="Create remote machine"
              className="cloud-machine-card-placeholder cloud-machine-card-placeholder-add"
              type="button"
              onClick={onStartCreateMachine}
            >
              <div className="cloud-machine-card-add-art">
                <HugeiconsIcon icon={PlusSignIcon} size={34} color="currentColor" strokeWidth={1.6} />
              </div>
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

const MachineCard = ({
  computer,
  onOpenMachine,
}: {
  readonly computer: CloudComputer;
  readonly onOpenMachine: (computer: CloudComputer) => void;
}): React.ReactElement => {
  const isLocal = computer.kind === "local";

  return (
    <button
      className="cloud-machine-card-placeholder cloud-machine-card-placeholder-device"
      type="button"
      onClick={() => onOpenMachine(computer)}
    >
      <span
        className="cloud-machine-status-dot"
        data-status={computer.status}
        title={formatMachineStatus(computer.status)}
        aria-label={`Status: ${formatMachineStatus(computer.status)}`}
      />
      <span className="cloud-machine-status-tooltip" aria-hidden="true">
        {formatMachineStatus(computer.status)}
      </span>
      <div className="cloud-machine-card-art">
        <img
          className={`cloud-machine-card-image cloud-machine-card-image-light${isLocal ? " cloud-machine-card-image-new" : ""}`}
          src={getImageSrc(isLocal ? newMacLightImageUrl : macLightImageUrl)}
          alt=""
          aria-hidden="true"
        />
        <img
          className={`cloud-machine-card-image cloud-machine-card-image-dark${isLocal ? " cloud-machine-card-image-new" : ""}`}
          src={getImageSrc(isLocal ? newMacImageUrl : macImageUrl)}
          alt=""
          aria-hidden="true"
        />
      </div>
      <div className="cloud-machine-card-footer">
        <span>{`Work on ${computer.name}`}</span>
        <HugeiconsIcon
          icon={ArrowRight02Icon}
          size={18}
          color="currentColor"
          strokeWidth={1.65}
        />
      </div>
    </button>
  );
};

const formatMachineStatus = (status: string): string =>
  status
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");

const compareMachinesForDisplay = (left: CloudComputer, right: CloudComputer): number => {
  const leftRank = left.kind === "local" ? 1 : 0;
  const rightRank = right.kind === "local" ? 1 : 0;

  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }

  return left.createdAt.localeCompare(right.createdAt);
};
