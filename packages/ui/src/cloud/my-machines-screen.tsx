"use client";

import { Settings03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect } from "react";

import { ThemeToggle } from "../filesystem/theme-toggle";
import type { CloudComputer, CloudUser } from "./cloud-client";

export interface MyMachinesScreenProps {
  readonly activeLocalComputerId: string | null;
  readonly computers: CloudComputer[];
  readonly error: string | null;
  readonly isCreatingMachine: boolean;
  readonly isLoading: boolean;
  readonly onCreateMachine: (input: { readonly name: string }) => Promise<void>;
  readonly onOpenMachine: (computer: CloudComputer) => void;
  readonly onLogout: () => Promise<void>;
  readonly onRefresh: () => Promise<void>;
  readonly user: CloudUser;
}

export function MyMachinesScreen(_props: MyMachinesScreenProps): React.ReactElement {
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
        </div>
      </section>
    </main>
  );
}
