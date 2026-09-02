export class CapabilityError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CapabilityError";
  }
}

export const toCapabilityError = (error: unknown): CapabilityError => {
  if (error instanceof CapabilityError) {
    return error;
  }

  if (error instanceof Error) {
    return new CapabilityError("CAPABILITY_ERROR", error.message);
  }

  return new CapabilityError("CAPABILITY_ERROR", "Capability operation failed.");
};
