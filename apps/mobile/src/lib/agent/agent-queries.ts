export const agentQueryKeys = {
  thread: (agentIdentity: string, threadId: string | null) =>
    ['agent', agentIdentity, 'thread', threadId] as const,
  threadGroups: (agentIdentity: string) =>
    ['agent', agentIdentity, 'thread-groups'] as const,
}
