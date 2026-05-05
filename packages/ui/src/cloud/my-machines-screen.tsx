"use client";

import {
  CloudServerIcon,
  ComputerAddIcon,
  ComputerIcon,
  Logout03Icon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";

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

interface MachineRow {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly status: string;
  readonly providerMetadata: unknown;
  readonly lastHeartbeatAt: string | null;
  readonly computer?: CloudComputer;
  readonly disabled: boolean;
}

export function MyMachinesScreen({
  activeLocalComputerId,
  computers,
  error,
  isCreatingMachine,
  isLoading,
  onCreateMachine,
  onOpenMachine,
  onLogout,
  onRefresh,
  user,
}: MyMachinesScreenProps): React.ReactElement {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [machineName, setMachineName] = useState("Dev Machine");
  const [createError, setCreateError] = useState<string | null>(null);
  const rows: MachineRow[] = computers.map((computer) => ({
      id: computer.id,
      name: computer.name,
      kind: computer.kind,
      status: computer.status,
      providerMetadata: computer.providerMetadata,
      lastHeartbeatAt: computer.lastHeartbeatAt,
      computer,
      disabled: computer.kind === "local" && computer.id !== activeLocalComputerId,
    }));

  return (
    <main className="cloud-shell">
      <header className="cloud-topbar">
        <div>
          <h1>My Machines</h1>
          <p>{user.email}</p>
        </div>
        <div className="cloud-topbar-actions">
          <ThemeToggle />
          <button
            className="cloud-text-button"
            disabled={isCreatingMachine}
            type="button"
            onClick={() => {
              setCreateError(null);
              setIsCreateOpen(true);
            }}
          >
            <HugeiconsIcon icon={ComputerAddIcon} size={17} color="currentColor" strokeWidth={1.8} />
            New machine
          </button>
          <button
            className="cloud-icon-button"
            disabled={isLoading}
            title="Refresh"
            type="button"
            onClick={() => void onRefresh()}
          >
            <HugeiconsIcon icon={RefreshIcon} size={18} color="currentColor" strokeWidth={1.8} />
          </button>
          <button className="cloud-text-button" type="button" onClick={() => void onLogout()}>
            <HugeiconsIcon icon={Logout03Icon} size={17} color="currentColor" strokeWidth={1.8} />
            Sign out
          </button>
        </div>
      </header>

      <section className="cloud-machines-panel" aria-busy={isLoading}>
        {error !== null ? <div className="cloud-machines-error" role="alert">{error}</div> : null}
        {isLoading && rows.length === 0 ? <div className="cloud-empty-state">Loading machines...</div> : null}
        {!isLoading && rows.length === 0 ? <div className="cloud-empty-state">No cloud machines yet.</div> : null}

        {rows.length > 0 ? (
          <div className="cloud-machine-list">
            {rows.map((row) => (
              <MachineListRow
                key={row.id}
                row={row}
                onOpenMachine={onOpenMachine}
              />
            ))}
          </div>
        ) : null}
      </section>

      {isCreateOpen ? (
        <div className="cloud-modal-backdrop" role="presentation">
          <form
            className="cloud-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-machine-title"
            onSubmit={(event) => {
              event.preventDefault();
              const name = machineName.trim();

              if (name.length === 0) {
                setCreateError("Name is required.");
                return;
              }

              setCreateError(null);
              void onCreateMachine({ name })
                .then(() => {
                  setIsCreateOpen(false);
                  setMachineName("Dev Machine");
                })
                .catch((error) => {
                  setCreateError(error instanceof Error ? error.message : "Failed to create machine.");
                });
            }}
          >
            <h2 id="create-machine-title">Create machine</h2>
            <label className="cloud-field">
              <span>Name</span>
              <input
                autoFocus
                maxLength={120}
                value={machineName}
                onChange={(event) => setMachineName(event.currentTarget.value)}
              />
            </label>
            {createError !== null ? <div className="cloud-auth-error" role="alert">{createError}</div> : null}
            <div className="cloud-modal-actions">
              <button
                className="cloud-text-button"
                disabled={isCreatingMachine}
                type="button"
                onClick={() => {
                  setCreateError(null);
                  setIsCreateOpen(false);
                }}
              >
                Cancel
              </button>
              <button className="cloud-primary-button" disabled={isCreatingMachine} type="submit">
                {isCreatingMachine ? "Creating..." : "Create"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}

const MachineListRow = ({
  row,
  onOpenMachine,
}: {
  readonly row: MachineRow;
  readonly onOpenMachine: (computer: CloudComputer) => void;
}): React.ReactElement => {
  const region = readMetadataString(row.providerMetadata, "region");
  const instanceType = readMetadataString(row.providerMetadata, "instanceType");
  const instanceId = readMetadataString(row.providerMetadata, "instanceId");
  const meta = [region, instanceType, instanceId].filter((value) => value !== null).join(" · ");

  return (
    <button
      className="cloud-machine-row"
      data-disabled={row.disabled ? "true" : "false"}
      disabled={row.disabled}
      title={row.disabled ? "This local machine is not active in this desktop app" : row.name}
      type="button"
      onClick={() => {
        if (!row.disabled && row.computer !== undefined) {
          onOpenMachine(row.computer);
        }
      }}
    >
      <span className="cloud-machine-icon" aria-hidden="true">
        <HugeiconsIcon
          icon={row.kind === "local" ? ComputerIcon : CloudServerIcon}
          size={22}
          color="currentColor"
          strokeWidth={1.7}
        />
      </span>
      <span className="cloud-machine-main">
        <span className="cloud-machine-title">{row.name}</span>
        <span className="cloud-machine-meta">
          {meta.length > 0 ? meta : row.kind}
        </span>
      </span>
      <span className="cloud-machine-side">
        <span className="cloud-status-pill" data-status={row.status}>{formatStatus(row.status)}</span>
        <span className="cloud-machine-heartbeat">{formatHeartbeat(row.lastHeartbeatAt)}</span>
      </span>
    </button>
  );
};

const readMetadataString = (metadata: unknown, key: string): string | null => {
  if (typeof metadata !== "object" || metadata === null || !(key in metadata)) {
    return null;
  }

  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
};

const formatStatus = (status: string): string =>
  status
    .split(/[-_\s]+/g)
    .filter((part) => part.length > 0)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");

const formatHeartbeat = (lastHeartbeatAt: string | null): string => {
  if (lastHeartbeatAt === null) {
    return "No heartbeat";
  }

  const date = new Date(lastHeartbeatAt);
  return Number.isNaN(date.getTime()) ? "No heartbeat" : `Last seen ${date.toLocaleString()}`;
};
