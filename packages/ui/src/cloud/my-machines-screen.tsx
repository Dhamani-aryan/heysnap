"use client";

import { ArrowRight02Icon, Cancel01Icon, PlusSignIcon, Settings03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect } from "react";

import darkLogoUrl from "../../../../apps/assets/heysnap-dark-logo.gif";
import lightLogoUrl from "../../../../apps/assets/heysnap-light-logo.gif";
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
  readonly showOnboardingModal: boolean;
  readonly onDismissOnboarding: () => void;
  readonly onOpenMachine: (computer: CloudComputer) => void;
  readonly onLogout: () => Promise<void>;
  readonly onRefresh: () => Promise<void>;
  readonly onStartCreateMachine: () => void;
  readonly user: CloudUser;
}

export function MyMachinesScreen({
  activeLocalComputerId,
  computers,
  showOnboardingModal,
  onDismissOnboarding,
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
                activeLocalComputerId={activeLocalComputerId}
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

      {showOnboardingModal ? (
        <div className="cloud-modal-backdrop cloud-machines-onboarding-backdrop" role="presentation">
          <section
            aria-label="Machines onboarding"
            aria-modal="true"
            className="cloud-modal cloud-machines-onboarding-modal"
            role="dialog"
          >
            <h2 className="cloud-machines-title cloud-machines-onboarding-title">
              <span>Welcome</span>
              <img
                className="cloud-machines-onboarding-logo cloud-machines-onboarding-logo-light"
                src={getImageSrc(lightLogoUrl)}
                alt=""
                aria-hidden="true"
              />
              <img
                className="cloud-machines-onboarding-logo cloud-machines-onboarding-logo-dark"
                src={getImageSrc(darkLogoUrl)}
                alt=""
                aria-hidden="true"
              />
            </h2>
            <div className="cloud-machines-onboarding-image-row" aria-hidden="true">
              <div className="cloud-machines-onboarding-image-frame">
                <img
                  className="cloud-machines-onboarding-image cloud-machines-onboarding-image-light"
                  src={getImageSrc(macLightImageUrl)}
                  alt=""
                />
                <img
                  className="cloud-machines-onboarding-image cloud-machines-onboarding-image-dark"
                  src={getImageSrc(macImageUrl)}
                  alt=""
                />
                <p className="cloud-machines-onboarding-caption">These represent remote machines.</p>
              </div>
              <div className="cloud-machines-onboarding-image-frame">
                <img
                  className="cloud-machines-onboarding-image cloud-machines-onboarding-image-light"
                  src={getImageSrc(newMacLightImageUrl)}
                  alt=""
                />
                <img
                  className="cloud-machines-onboarding-image cloud-machines-onboarding-image-dark"
                  src={getImageSrc(newMacImageUrl)}
                  alt=""
                />
                <p className="cloud-machines-onboarding-caption">These represent local machines.</p>
              </div>
            </div>
            <p className="cloud-machines-onboarding-copy">
              HeySnap works on your local machine and creates a 24*7 dedicated cloud machine for you as well. To add a
              new remote machine click on the plus box. To add a new local machine, just install the Heysnap desktop app
              and login with the same account.
            </p>
            <button
              className="cloud-primary-button cloud-machines-onboarding-action"
              type="button"
              onClick={onDismissOnboarding}
            >
              Let's go!
            </button>
            <button
              aria-label="Close onboarding"
              className="cloud-machines-onboarding-close"
              title="Close onboarding"
              type="button"
              onClick={onDismissOnboarding}
            >
              <HugeiconsIcon icon={Cancel01Icon} size={18} color="currentColor" strokeWidth={1.8} />
            </button>
          </section>
        </div>
      ) : null}
    </main>
  );
}

const MachineCard = ({
  activeLocalComputerId,
  computer,
  onOpenMachine,
}: {
  readonly activeLocalComputerId: string | null;
  readonly computer: CloudComputer;
  readonly onOpenMachine: (computer: CloudComputer) => void;
}): React.ReactElement => {
  const isLocal = computer.kind === "local";
  const displayStatus = getMachineDisplayStatus(computer, activeLocalComputerId);
  const canOpenMachine = displayStatus.canOpen;

  return (
    <button
      className="cloud-machine-card-placeholder cloud-machine-card-placeholder-device"
      data-can-open={canOpenMachine ? "true" : "false"}
      type="button"
      onClick={() => {
        if (canOpenMachine) {
          onOpenMachine(computer);
        }
      }}
    >
      <span
        className="cloud-machine-status-dot"
        data-status={displayStatus.status}
        title={displayStatus.label}
        aria-label={`Status: ${displayStatus.label}`}
      />
      <span className="cloud-machine-status-tooltip" aria-hidden="true">
        {displayStatus.label}
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

const getMachineDisplayStatus = (
  computer: CloudComputer,
  activeLocalComputerId: string | null,
): { readonly status: string; readonly label: string; readonly canOpen: boolean } => {
  if (
    computer.kind === "local" &&
    computer.tunnelConnected !== true &&
    computer.id !== activeLocalComputerId
  ) {
    return {
      status: "tunnel-disconnected",
      label: "Tunnel disconnected",
      canOpen: false,
    };
  }

  return {
    status: computer.status,
    label: formatMachineStatus(computer.status),
    canOpen: computer.status !== "creating" && computer.status !== "starting" && computer.status !== "failed",
  };
};

const compareMachinesForDisplay = (left: CloudComputer, right: CloudComputer): number => {
  const leftRank = left.kind === "local" ? 1 : 0;
  const rightRank = right.kind === "local" ? 1 : 0;

  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }

  return left.createdAt.localeCompare(right.createdAt);
};
