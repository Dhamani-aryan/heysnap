export type MediaRangeResult =
  | { readonly kind: "full" }
  | {
      readonly kind: "partial";
      readonly start: number;
      readonly end: number;
      readonly contentLength: number;
      readonly contentRange: string;
    }
  | {
      readonly kind: "invalid";
      readonly contentRange: string;
    };

export const resolveMediaRange = (
  rangeHeader: string | string[] | undefined,
  fileSize: number,
): MediaRangeResult => {
  const range = Array.isArray(rangeHeader) ? rangeHeader[0] : rangeHeader;

  if (range === undefined || range.trim().length === 0) {
    return { kind: "full" };
  }

  if (!Number.isSafeInteger(fileSize) || fileSize < 0) {
    return { kind: "invalid", contentRange: "bytes */0" };
  }

  const match = /^bytes=(\d*)-(\d*)$/u.exec(range.trim());

  if (match === null || fileSize === 0) {
    return invalidRange(fileSize);
  }

  const [, rawStart = "", rawEnd = ""] = match;

  if (rawStart.length === 0 && rawEnd.length === 0) {
    return invalidRange(fileSize);
  }

  if (rawStart.length === 0) {
    const suffixLength = Number(rawEnd);

    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return invalidRange(fileSize);
    }

    const start = Math.max(fileSize - suffixLength, 0);
    const end = fileSize - 1;
    return partialRange(start, end, fileSize);
  }

  const start = Number(rawStart);
  const requestedEnd = rawEnd.length === 0 ? fileSize - 1 : Number(rawEnd);

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    requestedEnd < start ||
    start >= fileSize
  ) {
    return invalidRange(fileSize);
  }

  return partialRange(start, Math.min(requestedEnd, fileSize - 1), fileSize);
};

const partialRange = (start: number, end: number, fileSize: number): MediaRangeResult => ({
  kind: "partial",
  start,
  end,
  contentLength: end - start + 1,
  contentRange: `bytes ${String(start)}-${String(end)}/${String(fileSize)}`,
});

const invalidRange = (fileSize: number): MediaRangeResult => ({
  kind: "invalid",
  contentRange: `bytes */${String(Math.max(fileSize, 0))}`,
});
