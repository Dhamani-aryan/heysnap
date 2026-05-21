import { useEffect, useState } from "react";

export type HeySnapPdfSrc = string | File | Blob | ArrayBuffer | Uint8Array;

export type ResolvedPdfSource =
  | { kind: "url"; url: string; name: string }
  | { kind: "buffer"; buffer: ArrayBuffer; name: string };

interface State {
  resolved: ResolvedPdfSource | null;
  error: Error | null;
  /** Increments once per `src` change; use as a remount key. */
  version: number;
}

/**
 * Normalizes the polymorphic `src` prop into something the EmbedPDF document
 * manager can consume directly. `Blob`/`File` are read into an `ArrayBuffer`
 * asynchronously; URLs and buffers resolve synchronously on the next tick.
 *
 * The returned `version` is incremented every time `src` changes so callers
 * can pass it as a `key` to force a clean remount of the viewer.
 */
export function useResolvedPdfSource(src: HeySnapPdfSrc): State {
  const [state, setState] = useState<State>({ resolved: null, error: null, version: 0 });

  useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ resolved: null, error: null, version: prev.version + 1 }));

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

async function resolve(src: HeySnapPdfSrc): Promise<ResolvedPdfSource> {
  if (typeof src === "string") {
    return { kind: "url", url: src, name: filenameFromUrl(src) };
  }
  if (src instanceof ArrayBuffer) {
    return { kind: "buffer", buffer: src, name: "document.pdf" };
  }
  if (src instanceof Uint8Array) {
    // Copy out so a sliced view becomes an owned buffer.
    return { kind: "buffer", buffer: src.slice().buffer, name: "document.pdf" };
  }
  if (typeof Blob !== "undefined" && src instanceof Blob) {
    const buffer = await blobToArrayBuffer(src);
    const name = typeof File !== "undefined" && src instanceof File ? src.name : "document.pdf";
    return { kind: "buffer", buffer, name };
  }
  throw new Error(
    "HeySnapPdfViewer: `src` must be a URL string, File, Blob, ArrayBuffer, or Uint8Array.",
  );
}

/**
 * Pull a human-readable filename out of a URL. Falls back to "document.pdf"
 * for opaque sources (no path, data: URIs, etc.) so the title is never blank.
 */
function filenameFromUrl(src: string): string {
  try {
    // Use `new URL` with a permissive base so relative URLs and bare paths work.
    const base = typeof window !== "undefined" ? window.location?.href : "https://localhost/";
    const url = new URL(src, base);
    const last = url.pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : "document.pdf";
  } catch {
    // Bare strings that aren't valid URLs (rare): try a plain split.
    const last = src.split(/[\\/]/).filter(Boolean).pop();
    return last ?? "document.pdf";
  }
}

/**
 * Read a Blob/File into an ArrayBuffer. Prefers the native `Blob.arrayBuffer()`
 * (every modern browser) and falls back to FileReader for older runtimes and
 * for jsdom, which does not implement it.
 */
function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") {
    return blob.arrayBuffer();
  }
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (result instanceof ArrayBuffer) resolve(result);
      else reject(new Error("FileReader did not return an ArrayBuffer."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed."));
    reader.readAsArrayBuffer(blob);
  });
}
