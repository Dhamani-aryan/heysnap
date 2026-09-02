import type { CloudComputer } from './machines-api';

export function upsertComputerInList(
  computers: CloudComputer[] | undefined,
  computer: CloudComputer,
): CloudComputer[] {
  if (!computers) return [computer];
  const existingIndex = computers.findIndex((item) => item.id === computer.id);
  if (existingIndex === -1) return [...computers, computer];
  const next = [...computers];
  next[existingIndex] = computer;
  return next;
}
