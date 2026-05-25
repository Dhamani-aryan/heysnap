"use client";

import { LogoutSquare01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect } from "react";

import macLightImageUrl from "../../../../../../apps/assets/mac-light.png";
import macImageUrl from "../../../../../../apps/assets/mac.png";
// import { ThemeToggle } from "../filesystem/theme-toggle";
import type { CloudUser } from "../../../cloud/cloud-client";

type ImageAsset = string | { readonly src: string };

const getImageSrc = (asset: ImageAsset): string => {
  return typeof asset === "string" ? asset : asset.src;
};

export interface RemoteMachineCreateScreenProps {
  readonly error: string | null;
  readonly isSubmitting: boolean;
  readonly onCreateMachine: (input: { readonly name: string }) => Promise<void>;
  readonly onLogout: () => Promise<void>;
  readonly user: CloudUser;
}

export function RemoteMachineCreateScreen({
  error,
  isSubmitting,
  onCreateMachine,
  onLogout,
  user,
}: RemoteMachineCreateScreenProps): React.ReactElement {
  const machineName = createDefaultMachineName(user.username);

  useEffect(() => {
    document.documentElement.dataset.cloudScreen = "machines";

    return () => {
      delete document.documentElement.dataset.cloudScreen;
    };
  }, []);

  return (
    <main className="cloud-shell cloud-remote-create-shell">
      <header className="cloud-topbar">
        <div className="cloud-topbar-actions">
          {/*
          <ThemeToggle />
          */}
          <button
            aria-label="Logout"
            className="theme-toggle"
            title="Logout"
            type="button"
            onClick={() => void onLogout()}
          >
            <HugeiconsIcon icon={LogoutSquare01Icon} size={18} color="currentColor" strokeWidth={1.8} />
          </button>
        </div>
      </header>

      <section
        className="cloud-local-onboarding cloud-remote-create-onboarding"
        aria-labelledby="cloud-remote-create-title"
      >
        <form
          className="cloud-local-onboarding-content"
          onSubmit={(event) => {
            event.preventDefault();

            if (machineName.length === 0 || isSubmitting) {
              return;
            }

            void onCreateMachine({ name: machineName });
          }}
        >
          <h1 id="cloud-remote-create-title">Your personal, private, AI computer</h1>
          <div className="cloud-local-onboarding-art" aria-hidden="true">
            <img
              className="cloud-local-onboarding-image cloud-local-onboarding-image-light"
              src={getImageSrc(macLightImageUrl)}
              alt=""
            />
            <img
              className="cloud-local-onboarding-image cloud-local-onboarding-image-dark"
              src={getImageSrc(macImageUrl)}
              alt=""
            />
          </div>
          <div className="cloud-remote-create-machine-name" aria-label="Machine name">
            <strong>{machineName}</strong>
          </div>
          {error !== null ? (
            <div className="cloud-local-onboarding-error" role="alert">
              {error}
            </div>
          ) : null}
          <button
            aria-label={isSubmitting ? "Creating remote machine" : undefined}
            className="cloud-local-onboarding-button"
            disabled={isSubmitting || machineName.length === 0}
            type="submit"
          >
            {isSubmitting ? (
              <span className="cloud-local-onboarding-loader" aria-hidden="true" />
            ) : (
              "Create"
            )}
          </button>
        </form>
      </section>
    </main>
  );
}

const createDefaultMachineName = (username: string): string => {
  const trimmed = username.trim();

  if (trimmed.length === 0) {
    return "";
  }

  return `${trimmed[0]!.toUpperCase()}${trimmed.slice(1)}'s Computer`;
};
