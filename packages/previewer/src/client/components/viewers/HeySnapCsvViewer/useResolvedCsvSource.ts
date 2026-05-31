import { useEffect, useState } from "react";

/**
 * CSV sources mirror the other text-based viewers: URLs are fetched, File /
 * Blob instances go through the browser's decoder, and raw byte buffers are
 * decoded as UTF-8.
 */
export type HeySnapCsvSrc =
  | string
  | File
  | Blob
  | ArrayBuffer
  | Uint8Array
  | {
      readonly text: string;
      readonly name?: string;
      readonly mime?: string;
    };

export interface ResolvedCsvSource {
  readonly text: string;
  readonly name: string;
  readonly mime: string;
}

interface State {
  readonly resolved: ResolvedCsvSource | null;
  readonly error: Error | null;
  /** Increments on every src change so callers can reset view state. */
  readonly version: number;
}

export function useResolvedCsvSource(src: HeySnapCsvSrc): State {
  const [state, setState] = useState<State>({ resolved: null, error: null, version: 0 });

  useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, error: null, version: prev.version + 1 }));

    (async () => {
      try {
        const resolved = await resolve(src);
        if (!cancelled) {
          setState((prev) => ({ resolved, error: null, version: prev.version }));
        }
      } catch (err) {
        if (!cancelled) {
          const error = err instanceof Error ? err : new Error(String(err));
          setState((prev) => ({ resolved: null, error, version: prev.version }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [src]);

  return state;
}

async function resolve(src: HeySnapCsvSrc): Promise<ResolvedCsvSource> {
  if (typeof src === "string") {
    const response = await fetch(src);
    if (!response.ok) {
      throw new Error(`Failed to fetch CSV (${response.status} ${response.statusText}).`);
    }

    return {
      text: await response.text(),
      name: filenameFromUrl(src),
      mime: response.headers.get("content-type") ?? mimeFromName(src),
    };
  }

  if (isInlineCsvSource(src)) {
    return {
      text: src.text,
      name: src.name ?? "data.csv",
      mime: src.mime ?? mimeFromName(src.name ?? "data.csv"),
    };
  }

  if (typeof File !== "undefined" && src instanceof File) {
    return {
      text: await src.text(),
      name: src.name || "data.csv",
      mime: src.type || mimeFromName(src.name),
    };
  }

  if (typeof Blob !== "undefined" && src instanceof Blob) {
    return {
      text: await src.text(),
      name: "data.csv",
      mime: src.type || "text/csv",
    };
  }

  if (src instanceof ArrayBuffer) {
    return {
      text: decodeBytes(src),
      name: "data.csv",
      mime: "text/csv",
    };
  }

  if (src instanceof Uint8Array) {
    return {
      text: decodeBytes(src),
      name: "data.csv",
      mime: "text/csv",
    };
  }

  throw new Error(
    "HeySnapCsvViewer: `src` must be a URL string, File, Blob, ArrayBuffer, Uint8Array, or { text } object.",
  );
}

function isInlineCsvSource(src: HeySnapCsvSrc): src is Extract<HeySnapCsvSrc, { readonly text: string }> {
  return (
    typeof src === "object" &&
    src !== null &&
    !(typeof Blob !== "undefined" && src instanceof Blob) &&
    "text" in src &&
    typeof src.text === "string"
  );
}

function decodeBytes(bytes: ArrayBuffer | Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function filenameFromUrl(src: string): string {
  try {
    const base = typeof window !== "undefined" ? window.location?.href : "https://localhost/";
    const url = new URL(src, base);
    const last = url.pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : "data.csv";
  } catch {
    const last = src.split(/[\\/]/).filter(Boolean).pop();
    return last ?? "data.csv";
  }
}

function mimeFromName(name: string): string {
  return name.toLowerCase().endsWith(".tsv") ? "text/tab-separated-values" : "text/csv";
}
