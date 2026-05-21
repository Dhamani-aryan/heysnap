import { useEffect, useState } from "react";

/**
 * Anything we accept on the `src` prop. The underlying `docx-preview`
 * renderer consumes binary buffers, so URL strings get fetched up-front;
 * everything else is normalized to an `ArrayBuffer`.
 */
export type HeySnapDocxSrc = string | File | Blob | ArrayBuffer | Uint8Array;

export interface ResolvedDocxSource {
  /** Buffer handed to `docx-preview`'s `renderAsync`. */
  buffer: ArrayBuffer;
  /** Human-readable filename for the title bar / document name. */
  name: string;
}

interface State {
  resolved: ResolvedDocxSource | null;
  error: Error | null;
  /** Increments once per `src` change; use as a remount key. */
  version: number;
}

/**
 * Normalizes the polymorphic `src` prop into an `ArrayBuffer` that
 * `docx-preview`'s `renderAsync` can consume. URLs are fetched; `File`/
 * `Blob` are read into memory; raw buffers pass through. The returned
 * `version` is bumped on every `src` change so callers can use it as a
 * remount key.
 */
export function useResolvedDocxSource(src: HeySnapDocxSrc): State {
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

async function resolve(src: HeySnapDocxSrc): Promise<ResolvedDocxSource> {
  if (typeof src === "string") {
    const response = await fetch(src);
    if (!response.ok) {
      throw new Error(`Failed to fetch DOCX (${response.status} ${response.statusText}).`);
    }
    const buffer = await response.arrayBuffer();
    return { buffer, name: filenameFromUrl(src) };
  }
  if (src instanceof ArrayBuffer) {
    return { buffer: src, name: "document.docx" };
  }
  if (src instanceof Uint8Array) {
    // Copy out so a sliced view becomes an owned buffer the editor can keep.
    return { buffer: src.slice().buffer, name: "document.docx" };
  }
  if (typeof Blob !== "undefined" && src instanceof Blob) {
    const buffer = await blobToArrayBuffer(src);
    const name = typeof File !== "undefined" && src instanceof File ? src.name : "document.docx";
    return { buffer, name };
  }
  throw new Error(
    "HeySnapDocxViewer: `src` must be a URL string, File, Blob, ArrayBuffer, or Uint8Array.",
  );
}

/**
 * Pull a human-readable filename out of a URL. Falls back to "document.docx"
 * for opaque sources so the title is never blank.
 */
function filenameFromUrl(src: string): string {
  try {
    const base = typeof window !== "undefined" ? window.location?.href : "https://localhost/";
    const url = new URL(src, base);
    const last = url.pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : "document.docx";
  } catch {
    const last = src.split(/[\\/]/).filter(Boolean).pop();
    return last ?? "document.docx";
  }
}

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
