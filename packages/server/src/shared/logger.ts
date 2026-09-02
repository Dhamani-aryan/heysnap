import pino, { type Logger, type LoggerOptions } from "pino";

const DEFAULT_AXIOM_DATASET = "heysnap-websocket-logs";

const redactPaths = [
  "authorization",
  "headers.authorization",
  "token",
  "accessToken",
  "*.token",
  "*.accessToken",
];

export const createServiceLogger = (
  service: string,
  bindings: Record<string, unknown> = {},
): Logger => {
  const level = process.env.LOG_LEVEL?.trim() || (process.env.NODE_ENV === "test" ? "silent" : "info");
  const options: LoggerOptions = {
    level,
    base: {
      service,
      ...bindings,
    },
    redact: {
      paths: redactPaths,
      censor: "[redacted]",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  const axiomToken = process.env.AXIOM_TOKEN?.trim();

  if (axiomToken !== undefined && axiomToken.length > 0) {
    return pino(options, pino.transport({
      targets: [
        {
          target: "pino/file",
          options: { destination: 1 },
        },
        {
          target: "@axiomhq/pino",
          options: {
            dataset: process.env.AXIOM_DATASET?.trim() || DEFAULT_AXIOM_DATASET,
            token: axiomToken,
            orgId: process.env.AXIOM_ORG_ID?.trim() || undefined,
            url: process.env.AXIOM_URL?.trim() || undefined,
          },
        },
      ],
    }));
  }

  return pino(options);
};

export const logger = createServiceLogger("machine-server");

export const sanitizeUrlPath = (rawUrl: string | undefined): string | undefined => {
  if (rawUrl === undefined) {
    return undefined;
  }

  try {
    const url = new URL(rawUrl, "http://localhost");
    url.searchParams.delete("accessToken");
    url.searchParams.delete("token");
    return `${url.pathname}${url.search}`;
  } catch {
    return rawUrl;
  }
};

export const errorToLog = (error: unknown): Record<string, unknown> => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return { message: String(error) };
};
