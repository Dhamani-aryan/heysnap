import type { AgentThreadGroup, AgentThreadSummary } from "./types.js";

export const compareThreadsByUpdatedAtDesc = (
  left: AgentThreadSummary,
  right: AgentThreadSummary,
): number => right.updatedAt - left.updatedAt;

export const groupThreadSummariesByStartPath = (
  threads: readonly AgentThreadSummary[],
): AgentThreadGroup[] => {
  const groups = new Map<string, AgentThreadSummary[]>();

  for (const thread of threads) {
    const group = groups.get(thread.startPath) ?? [];
    group.push(thread);
    groups.set(thread.startPath, group);
  }

  return Array.from(groups.entries())
    .map(([path, groupThreads]) => ({
      path,
      threads: [...groupThreads].sort(compareThreadsByUpdatedAtDesc),
    }))
    .sort((left, right) => {
      const leftUpdatedAt = left.threads[0]?.updatedAt ?? Number.NEGATIVE_INFINITY;
      const rightUpdatedAt = right.threads[0]?.updatedAt ?? Number.NEGATIVE_INFINITY;

      return rightUpdatedAt - leftUpdatedAt || left.path.localeCompare(right.path);
    });
};
