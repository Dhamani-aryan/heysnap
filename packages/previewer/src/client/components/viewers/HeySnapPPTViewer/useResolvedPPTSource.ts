import { useEffect, useState } from "react";

/**
 * Anything we accept on the `src` prop. The server expects a multipart upload
 * with a `File`, so URL strings get fetched up-front; `Blob` / `ArrayBuffer` /
 * `Uint8Array` are wrapped in a `File` with a stable filename so the toolbar
 * always has something readable to show.
 */
export type HeySnapPPTSrc = string | File | Blob | ArrayBuffer | Uint8Array;

export interface ResolvedPPTSource {
  /** File handed to the conversion endpoint as multipart `file`. */
  file: File;
  /** Filename used in the toolbar title and download button. */
  name: string;
}

interface State {
  resolved: ResolvedPPTSource | null;
  error: Error | null;
  /** Increments once per `src` change; use as a remount/refetch key. */
  version: number;
}

const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/**
 * Normalizes the polymorphic `src` prop into a `{ file, name }` pair the
 * server can consume. URLs are fetched; everything else is wrapped in a
 * `File` with the right MIME. The returned `version` is bumped on every
 * `src` change so callers can use it as a refetch key.
 */
export function useResolvedPPTSource(src: HeySnapPPTSrc): State {
  const [state, setState] = useState<State>({
    resolved: null,
    error: null,
    version: 0,
  });

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

async function resolve(src: HeySnapPPTSrc): Promise<ResolvedPPTSource> {
  if (typeof src === "string") {
    const response = await fetch(src);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch PPTX (${response.status} ${response.statusText}).`,
      );
    }
    const blob = await response.blob();
    const name = filenameFromUrl(src);
    const file = new File([blob], name, { type: PPTX_MIME });
    return { file, name };
  }
  if (typeof File !== "undefined" && src instanceof File) {
    return { file: src, name: src.name || "presentation.pptx" };
  }
  if (typeof Blob !== "undefined" && src instanceof Blob) {
    const name = "presentation.pptx";
    return { file: new File([src], name, { type: PPTX_MIME }), name };
  }
  if (src instanceof ArrayBuffer) {
    const name = "presentation.pptx";
    return { file: new File([new Uint8Array(src)], name, { type: PPTX_MIME }), name };
  }
  if (src instanceof Uint8Array) {
    const name = "presentation.pptx";
    // Copy out so a sliced view becomes an owned buffer the File can keep.
    return { file: new File([new Uint8Array(src)], name, { type: PPTX_MIME }), name };
  }
  throw new Error(
    "HeySnapPPTViewer: `src` must be a URL string, File, Blob, ArrayBuffer, or Uint8Array.",
  );
}

function filenameFromUrl(src: string): string {
  try {
    const base = typeof window !== "undefined" ? window.location?.href : "https://localhost/";
    const url = new URL(src, base);
    const last = url.pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : "presentation.pptx";
  } catch {
    const last = src.split(/[\\/]/).filter(Boolean).pop();
    return last ?? "presentation.pptx";
  }
}
