import { HttpError } from "../shared/errors.js";

export const INSTANCE_STATE_TRANSITIONING_CODE = "INSTANCE_STATE_TRANSITIONING";
export const INSTANCE_STATE_TRANSITIONING_MESSAGE = "Machine is still finishing sleep. Retrying shortly.";

export const toStartComputerError = (error: unknown): unknown => {
  if (isIncorrectInstanceStateError(error)) {
    return new HttpError(409, INSTANCE_STATE_TRANSITIONING_CODE, INSTANCE_STATE_TRANSITIONING_MESSAGE);
  }

  return error;
};

const isIncorrectInstanceStateError = (error: unknown): boolean => {
  const record = readObject(error);
  const nestedError = readObject(record?.["Error"]);

  return record?.["Code"] === "IncorrectInstanceState" ||
    record?.["code"] === "IncorrectInstanceState" ||
    record?.["name"] === "IncorrectInstanceState" ||
    nestedError?.["Code"] === "IncorrectInstanceState" ||
    nestedError?.["code"] === "IncorrectInstanceState";
};

const readObject = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
};
