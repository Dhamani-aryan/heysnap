"use client";

import { Settings03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";

import macLightImageUrl from "../../../../apps/assets/mac-light.png";
import macImageUrl from "../../../../apps/assets/mac.png";
import { ThemeToggle } from "../filesystem/theme-toggle";

type ImageAsset = string | { readonly src: string };

const getImageSrc = (asset: ImageAsset): string => {
  return typeof asset === "string" ? asset : asset.src;
};

export interface RemoteMachineCreateScreenProps {
  readonly error: string | null;
  readonly isSubmitting: boolean;
  readonly onBack: () => void;
  readonly onCreateMachine: (input: { readonly name: string }) => Promise<void>;
  readonly onLogout: () => Promise<void>;
}

export function RemoteMachineCreateScreen({
  error,
  isSubmitting,
  onBack,
  onCreateMachine,
  onLogout,
}: RemoteMachineCreateScreenProps): React.ReactElement {
  const [name, setName] = useState("");
  const trimmedName = name.trim();

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
          <button className="cloud-text-button" type="button" onClick={onBack}>
            Machines
          </button>
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

      <section className="cloud-local-onboarding" aria-labelledby="cloud-remote-create-title">
        <form
          className="cloud-local-onboarding-content"
          onSubmit={(event) => {
            event.preventDefault();

            if (trimmedName.length === 0 || isSubmitting) {
              return;
            }

            void onCreateMachine({ name: trimmedName });
          }}
        >
          <h1 id="cloud-remote-create-title">Create Remote Machine</h1>
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
          <label className="cloud-field cloud-remote-create-field">
            <span>Machine name</span>
            <input
              autoFocus
              disabled={isSubmitting}
              maxLength={120}
              required
              type="text"
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </label>
          {error !== null ? (
            <div className="cloud-local-onboarding-error" role="alert">
              {error}
            </div>
          ) : null}
          <button
            aria-label={isSubmitting ? "Creating remote machine" : undefined}
            className="cloud-local-onboarding-button"
            disabled={isSubmitting || trimmedName.length === 0}
            type="submit"
          >
            {isSubmitting ? (
              <span className="cloud-local-onboarding-loader" aria-hidden="true" />
            ) : (
              "Create remote machine"
            )}
          </button>
        </form>
      </section>
    </main>
  );
}
