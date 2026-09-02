export class FilesystemError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "FilesystemError";
  }
}

export const toFilesystemError = (error: unknown): FilesystemError => {
  if (error instanceof FilesystemError) {
    return error;
  }

  if (error instanceof Error) {
    return new FilesystemError("INTERNAL_ERROR", error.message);
  }

  return new FilesystemError("INTERNAL_ERROR", "Unexpected filesystem error");
};
