import { useEffect, useState } from "react";

/**
 * Anything we accept on the `src` prop. URL strings render directly via the
 * native `<img>` tag (no fetch needed for the viewer to function), while
 * `File` / `Blob` / `ArrayBuffer` / `Uint8Array` sources are wrapped in a
 * blob object URL whose lifetime tracks the resolved state.
 */
export type HeySnapImageSrc = string | File | Blob | ArrayBuffer | Uint8Array;

export interface ResolvedImageSource {
  /** Value to hand to `<img src>`. Either the original URL or a blob: URL. */
  url: string;
  /** Filename used for the toolbar title and the download button's saved name. */
  name: string;
  /** True when `url` is a blob URL we own and must revoke on cleanup. */
  isObjectUrl: boolean;
  /** MIME type when known; powers the download fallback's blob type. */
  type?: string;
}

interface State {
  resolved: ResolvedImageSource | null;
  error: Error | null;
  /** Increments once per `src` change; useful as a remount key. */
  version: number;
}

/**
 * Normalize the polymorphic `src` into a `{ url, name }` pair an `<img>` can
 * load. URL strings pass through unchanged; binary sources get an object URL
 * that's revoked when `src` changes or the viewer unmounts.
 */
export function useResolvedImageSource(src: HeySnapImageSrc): State {
  const [state, setState] = useState<State>(() => initial(src));

  useEffect(() => {
    let cancelled = false;
    let createdObjectUrl: string | null = null;

    try {
      const resolved = resolveSync(src);
      if (resolved.isObjectUrl) createdObjectUrl = resolved.url;
      if (!cancelled) {
        setState((prev) => ({
          resolved,
          error: null,
          version: prev.version + 1,
        }));
      } else if (createdObjectUrl) {
        // Already unmounted while resolving — clean up immediately.
        URL.revokeObjectURL(createdObjectUrl);
      }
    } catch (err) {
      if (!cancelled) {
        const error = err instanceof Error ? err : new Error(String(err));
        setState((prev) => ({
          resolved: null,
          error,
          version: prev.version + 1,
        }));
      }
    }

    return () => {
      cancelled = true;
      // Revoke the URL we owned for *this* effect run. The next run (or
      // unmount) is responsible for its own URL — keeps things simple even
      // when React strict-mode double-invokes effects.
      if (createdObjectUrl) URL.revokeObjectURL(createdObjectUrl);
    };
  }, [src]);

  return state;
}

/**
 * Initial state for the first render. We resolve string sources synchronously
 * so the `<img>` mounts immediately without a loading flash, but defer
 * binary sources to the effect — creating an object URL during render would
 * leak under React StrictMode's double-mount because the *render* URL would
 * never be revoked. Binary sources briefly show the loading shell instead.
 */
function initial(src: HeySnapImageSrc): State {
  if (typeof src === "string") {
    try {
      return { resolved: resolveSync(src), error: null, version: 0 };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      return { resolved: null, error, version: 0 };
    }
  }
  return { resolved: null, error: null, version: 0 };
}

function resolveSync(src: HeySnapImageSrc): ResolvedImageSource {
  if (typeof src === "string") {
    return { url: src, name: filenameFromUrl(src), isObjectUrl: false };
  }
  if (typeof File !== "undefined" && src instanceof File) {
    return {
      url: URL.createObjectURL(src),
      name: src.name || "image",
      isObjectUrl: true,
      type: src.type || undefined,
    };
  }
  if (typeof Blob !== "undefined" && src instanceof Blob) {
    return {
      url: URL.createObjectURL(src),
      name: "image",
      isObjectUrl: true,
      type: src.type || undefined,
    };
  }
  if (src instanceof ArrayBuffer) {
    const blob = new Blob([new Uint8Array(src)]);
    return { url: URL.createObjectURL(blob), name: "image", isObjectUrl: true };
  }
  if (src instanceof Uint8Array) {
    // Copy out so a sliced view becomes an owned buffer the Blob can keep.
    const blob = new Blob([new Uint8Array(src)]);
    return { url: URL.createObjectURL(blob), name: "image", isObjectUrl: true };
  }
  throw new Error(
    "HeySnapImageViewer: `src` must be a URL string, File, Blob, ArrayBuffer, or Uint8Array.",
  );
}

/**
 * Pull a human-readable filename out of a URL. Falls back to "image" for
 * opaque sources (data URLs, blob URLs, weird inputs) so the title is never
 * blank.
 */
function filenameFromUrl(src: string): string {
  if (src.startsWith("data:") || src.startsWith("blob:")) return "image";
  try {
    const base = typeof window !== "undefined" ? window.location?.href : "https://localhost/";
    const url = new URL(src, base);
    const last = url.pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : "image";
  } catch {
    const last = src.split(/[\\/]/).filter(Boolean).pop();
    return last ?? "image";
  }
}
