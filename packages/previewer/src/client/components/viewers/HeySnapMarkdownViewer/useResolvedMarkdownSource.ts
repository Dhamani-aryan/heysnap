import { useEffect, useState } from "react";

/**
 * Anything we accept on the `src` prop. URLs are fetched as text; `File` /
 * `Blob` go through `.text()`; `ArrayBuffer` / `Uint8Array` are decoded as
 * UTF-8. The polymorphism matches the rest of the viewer family.
 *
 * For markdown specifically we also accept the markdown text directly as a
 * `MarkdownContent` wrapper, which is the natural input when the consumer
 * already has the string in memory (e.g. from an AI streaming response) and
 * doesn't want the viewer to fetch anything.
 */
export type HeySnapMarkdownSrc =
  | string
  | File
  | Blob
  | ArrayBuffer
  | Uint8Array
  | MarkdownContent;

/**
 * Inline markdown content wrapper. Use when you have the markdown text in
 * memory and don't want the viewer to treat the string as a URL.
 *
 * @example
 * ```tsx
 * <HeySnapMarkdownViewer src={{ text: "# Hello", name: "README.md" }} />
 * ```
 */
export interface MarkdownContent {
  /** Markdown source text rendered by Streamdown. */
  text: string;
  /** Filename shown in the toolbar title and used for the download. */
  name?: string;
}

export interface ResolvedMarkdownSource {
  /** Raw markdown text. */
  text: string;
  /** Filename used by the toolbar title and the download button. */
  name: string;
}

interface State {
  resolved: ResolvedMarkdownSource | null;
  error: Error | null;
  /** Increments on every `src` change so callers can react to fresh content. */
  version: number;
}

/**
 * Normalizes the polymorphic `src` into `{ text, name }`. Fetches URLs,
 * decodes buffers, and unwraps `MarkdownContent`. `version` bumps on every
 * `src` change without clearing the previous source while the new content
 * resolves.
 */
export function useResolvedMarkdownSource(src: HeySnapMarkdownSrc): State {
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

async function resolve(src: HeySnapMarkdownSrc): Promise<ResolvedMarkdownSource> {
  if (isMarkdownContent(src)) {
    return { text: src.text, name: src.name ?? "document.md" };
  }
  if (typeof src === "string") {
    const response = await fetch(src);
    if (!response.ok) {
      throw new Error(`Failed to fetch markdown (${response.status} ${response.statusText}).`);
    }
    const text = await response.text();
    return { text, name: filenameFromUrl(src) };
  }
  if (typeof File !== "undefined" && src instanceof File) {
    const text = await src.text();
    return { text, name: src.name || "document.md" };
  }
  if (typeof Blob !== "undefined" && src instanceof Blob) {
    const text = await src.text();
    return { text, name: "document.md" };
  }
  if (src instanceof ArrayBuffer) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(src);
    return { text, name: "document.md" };
  }
  if (src instanceof Uint8Array) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(src);
    return { text, name: "document.md" };
  }
  throw new Error(
    "HeySnapMarkdownViewer: `src` must be a URL string, File, Blob, ArrayBuffer, Uint8Array, or { text, name } object.",
  );
}

function isMarkdownContent(src: HeySnapMarkdownSrc): src is MarkdownContent {
  return (
    typeof src === "object" &&
    src !== null &&
    !(src instanceof ArrayBuffer) &&
    !(typeof File !== "undefined" && src instanceof File) &&
    !(typeof Blob !== "undefined" && src instanceof Blob) &&
    !(src instanceof Uint8Array) &&
    "text" in src &&
    typeof (src as { text: unknown }).text === "string"
  );
}

function filenameFromUrl(src: string): string {
  try {
    const base = typeof window !== "undefined" ? window.location?.href : "https://localhost/";
    const url = new URL(src, base);
    const last = url.pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : "document.md";
  } catch {
    const last = src.split(/[\\/]/).filter(Boolean).pop();
    return last ?? "document.md";
  }
}
