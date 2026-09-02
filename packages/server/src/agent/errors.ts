export class AgentError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AgentError";
  }
}

export const toAgentError = (error: unknown): AgentError => {
  if (error instanceof AgentError) {
    return error;
  }

  if (error instanceof Error) {
    return new AgentError("AGENT_ERROR", error.message);
  }

  return new AgentError("AGENT_ERROR", "Unknown agent error");
};
