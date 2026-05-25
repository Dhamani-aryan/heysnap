export const clearSleepMachineHealth = (machineHealth: unknown): Record<string, unknown> => {
  const health = readObject(machineHealth);

  if (health === undefined) {
    return {};
  }

  const { autoSleep: _autoSleep, idleSince: _idleSince, lastActivityAt: _lastActivityAt, ...rest } = health;
  return rest;
};

const readObject = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
};
