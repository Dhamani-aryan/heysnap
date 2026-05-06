"use client";

import { Settings03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect } from "react";

import newMacLightImageUrl from "../../../../apps/assets/new-mac-light.png";
import newMacImageUrl from "../../../../apps/assets/new-mac.png";
import { ThemeToggle } from "../filesystem/theme-toggle";

type ImageAsset = string | { readonly src: string };

const getImageSrc = (asset: ImageAsset): string => {
  return typeof asset === "string" ? asset : asset.src;
};

export interface LocalMachineOnboardingScreenProps {
  readonly error: string | null;
  readonly hasExistingMachines: boolean;
  readonly isSubmitting: boolean;
  readonly machineName: string;
  readonly onAddMachine: () => Promise<void>;
  readonly onLogout: () => Promise<void>;
}

export function LocalMachineOnboardingScreen({
  error,
  hasExistingMachines,
  isSubmitting,
  machineName,
  onAddMachine,
  onLogout,
}: LocalMachineOnboardingScreenProps): React.ReactElement {
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
            aria-label="Settings"
            className="theme-toggle"
            title="Settings"
            type="button"
            onClick={() => void onLogout()}
          >
            <HugeiconsIcon icon={Settings03Icon} size={18} color="currentColor" strokeWidth={1.8} />
          </button>
        </div>
      </header>

      <section className="cloud-local-onboarding" aria-labelledby="cloud-local-onboarding-title">
        <div className="cloud-local-onboarding-content">
          <h1 id="cloud-local-onboarding-title">
            {hasExistingMachines ? "New Machine?" : "Add your first Machine"}
          </h1>
          <div className="cloud-local-onboarding-art" aria-hidden="true">
            <img
              className="cloud-local-onboarding-image cloud-local-onboarding-image-light"
              src={getImageSrc(newMacLightImageUrl)}
              alt=""
            />
            <img
              className="cloud-local-onboarding-image cloud-local-onboarding-image-dark"
              src={getImageSrc(newMacImageUrl)}
              alt=""
            />
          </div>
          <div className="cloud-local-onboarding-name">{machineName}</div>
          {error !== null ? (
            <div className="cloud-local-onboarding-error" role="alert">
              {error}
            </div>
          ) : null}
          <button
            aria-label={isSubmitting ? "Adding machine to workspace" : undefined}
            className="cloud-local-onboarding-button"
            disabled={isSubmitting}
            type="button"
            onClick={() => void onAddMachine()}
          >
            {isSubmitting ? (
              <span className="cloud-local-onboarding-loader" aria-hidden="true" />
            ) : (
              "Add Machine to workspace"
            )}
          </button>
        </div>
      </section>
    </main>
  );
}
