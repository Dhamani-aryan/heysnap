import { describe, expect, it } from "vitest";

import { CloudApiError } from "../../src/cloud/cloud-client";
import {
  START_MACHINE_TRANSITION_RETRY_LIMIT,
  isStartInstanceStateTransitioningError,
  shouldRetryStartMachine,
} from "../../src/query/cloud/use-machine-queries";

describe("start machine retry handling", () => {
  it("retries only EC2 state transition conflicts", () => {
    const transitionError = new CloudApiError(
      409,
      "INSTANCE_STATE_TRANSITIONING",
      "Machine is still finishing sleep. Retrying shortly.",
    );
    const quotaError = new CloudApiError(409, "QUOTA_EXCEEDED", "Quota exceeded.");

    expect(isStartInstanceStateTransitioningError(transitionError)).toBe(true);
    expect(shouldRetryStartMachine(0, transitionError)).toBe(true);
    expect(shouldRetryStartMachine(START_MACHINE_TRANSITION_RETRY_LIMIT - 1, transitionError)).toBe(true);
    expect(shouldRetryStartMachine(START_MACHINE_TRANSITION_RETRY_LIMIT, transitionError)).toBe(false);
    expect(shouldRetryStartMachine(0, quotaError)).toBe(false);
    expect(shouldRetryStartMachine(0, new Error("network failed"))).toBe(false);
  });
});
