export const agentQueryKeys = {
  thread: (agentBaseUrl: string, threadId: string | null) =>
    ['agent', agentBaseUrl, 'thread', threadId] as const,
  threadGroups: (agentBaseUrl: string) =>
    ['agent', agentBaseUrl, 'thread-groups'] as const,
}
