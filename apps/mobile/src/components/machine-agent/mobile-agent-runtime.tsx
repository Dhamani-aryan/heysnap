import type { ReactNode } from 'react';
import { AgentRuntimeProvider, useOptionalAgentRuntime } from '@ank1015-app/ui/agent-hooks';

type MobileAgentRuntimeProps = {
  agentBaseUrl: string;
  children: ReactNode;
};

export function MobileAgentRuntime({ agentBaseUrl, children }: MobileAgentRuntimeProps) {
  const existing = useOptionalAgentRuntime();

  if (existing !== null) {
    return <>{children}</>;
  }

  return <AgentRuntimeProvider agentBaseUrl={agentBaseUrl}>{children}</AgentRuntimeProvider>;
}
