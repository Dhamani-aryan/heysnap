"use client";

import type { ComputerAccessSessionResponse } from "./cloud-client";

export const ACCESS_SESSION_REFRESH_BUFFER_MS = 60_000;

export const isRemoteMachineConnectable = (status: string): boolean =>
  status === "online" || status === "idle";

export const isRemoteMachinePendingStartup = (status: string): boolean =>
  status === "creating" || status === "starting";

export const isRemoteMachineTerminal = (status: string): boolean =>
  status === "failed" || status === "offline" || status === "deleted";

export const getRemoteMachineUnavailableMessage = (status: string): string => {
  if (status === "failed") {
    return "Machine failed to start.";
  }

  if (status === "offline") {
    return "Machine is offline.";
  }

  if (status === "deleted") {
    return "Machine not found.";
  }

  if (status === "sleeping") {
    return "Machine is sleeping.";
  }

  return `Machine is ${formatStatusLabel(status).toLowerCase()}.`;
};

export const formatStatusLabel = (status: string): string =>
  status
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");

export const isAccessSessionUsable = (
  response: ComputerAccessSessionResponse | null,
  computerId: string,
): boolean => {
  if (response === null || response.accessSession.computerId !== computerId) {
    return false;
  }

  const expiresAt = Date.parse(response.accessSession.expiresAt);

  return Number.isFinite(expiresAt) && expiresAt - Date.now() > ACCESS_SESSION_REFRESH_BUFFER_MS;
};
