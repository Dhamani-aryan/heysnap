import { useEffect, useRef, useState } from "react";
import type { ResolvedPPTSource } from "./useResolvedPPTSource";

/**
 * Static fields known once the server emits the `meta` event. After this the
 * viewer can size its slide slots and the sidebar can render numbered
 * thumbnails immediately, before any pages have rasterized.
 */
export interface SlideManifest {
  jobId: string;
  filename: string;
  /** Total slide count for the deck. */
  slideCount: number;
  /** CSS pixels at zoom 1.0. Derived server-side from the PDF page size. */
  slideWidth: number;
  slideHeight: number;
}

export interface SlideManifestEntry {
  index: number;
  url: string;
}

interface State {
  /** Null until the `meta` event arrives. */
  manifest: SlideManifest | null;
  /** Sparse map: slide index (1-based) → absolute image URL. */
  slideUrls: ReadonlyMap<number, string>;
  /** True while the streaming request is open (upload + conversion). */
  loading: boolean;
  /** True after the server signals `done` — all slides accounted for. */
  done: boolean;
  error: Error | null;
}

const INITIAL_STATE: State = {
  manifest: null,
  slideUrls: new Map(),
  loading: false,
  done: false,
  error: null,
};

/**
 * Stream the conversion. Returns a state object that updates incrementally:
 *
 *   1. `loading: true` from the moment we POST until the stream closes.
 *   2. `manifest` populates when the server emits `meta` — usually within
 *      a couple of seconds of upload (the slow soffice step).
 *   3. `slideUrls` grows by one entry per `slide` event. Entries may arrive
 *      out of order because the server rasterizes pages in parallel.
 *   4. `done: true` and `loading: false` once the server emits `done`.
 *
 * Refires whenever `resolved` or `serverUrl` changes; aborts the in-flight
 * stream cleanly when the component unmounts or the source swaps mid-flight.
 */
export function usePPTConversion(
  resolved: ResolvedPPTSource | null,
  serverUrl: string,
): State {
  const [state, setState] = useState<State>(INITIAL_STATE);

  // Holds the AbortController across effect runs so a quick src-swap can
  // cancel the previous stream before kicking off the new one.
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!resolved) {
      setState(INITIAL_STATE);
      return;
    }

    const ac = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ac;

    setState({ ...INITIAL_STATE, loading: true });

    (async () => {
      try {
        await streamConvert(resolved, serverUrl, ac.signal, (event) => {
          if (ac.signal.aborted) return;

          if (event.event === "meta") {
            setState((prev) => ({
              ...prev,
              manifest: {
                jobId: event.jobId,
                filename: event.filename,
                slideCount: event.slideCount,
                slideWidth: event.slideWidth,
                slideHeight: event.slideHeight,
              },
            }));
          } else if (event.event === "slide") {
            const absUrl = absoluteUrl(serverUrl, event.url);
            setState((prev) => {
              const slideUrls = new Map(prev.slideUrls);
              slideUrls.set(event.index, absUrl);
              return { ...prev, slideUrls };
            });
          } else if (event.event === "done") {
            setState((prev) => ({ ...prev, loading: false, done: true }));
          } else if (event.event === "error") {
            // Server-side pipeline failure. Surface via the error channel
            // and stop loading — the connection may stay open briefly after
            // this but no further slides are coming.
            throw new Error(event.message);
          }
        });

        // The stream may close without a `done` event if the server crashed
        // mid-write or a proxy cut it. Either way, drop loading so the UI
        // doesn't spin forever.
        if (!ac.signal.aborted) {
          setState((prev) => (prev.loading ? { ...prev, loading: false } : prev));
        }
      } catch (err) {
        if (ac.signal.aborted) return;
        const error = err instanceof Error ? err : new Error(String(err));
        setState((prev) => ({ ...prev, loading: false, error }));
      }
    })();

    return () => {
      ac.abort();
    };
  }, [resolved, serverUrl]);

  return state;
}

// ── Streaming machinery ─────────────────────────────────────────────────

type ServerEvent =
  | {
      event: "meta";
      jobId: string;
      filename: string;
      slideCount: number;
      slideWidth: number;
      slideHeight: number;
    }
  | { event: "slide"; index: number; url: string }
  | { event: "done" }
  | { event: "error"; message: string };

/**
 * POST the file to `<serverUrl>/convert/stream` and walk the NDJSON body
 * line-by-line. Each line is a complete JSON event; partial chunks across
 * read boundaries are accumulated until the next `\n`.
 *
 * We use `fetch` + `ReadableStream` rather than `EventSource` because
 * EventSource only supports `GET` and we need to upload the file. The
 * NDJSON format is also simpler to parse than the SSE wire format for our
 * one-shot use case.
 */
async function streamConvert(
  resolved: ResolvedPPTSource,
  serverUrl: string,
  signal: AbortSignal,
  onEvent: (event: ServerEvent) => void,
): Promise<void> {
  const base = trimSlash(serverUrl);

  const form = new FormData();
  form.append("file", resolved.file, resolved.name);

  const response = await fetch(`${base}/convert/stream`, {
    method: "POST",
    body: form,
    signal,
  });

  if (!response.ok) {
    let message = `Conversion failed (${response.status} ${response.statusText}).`;
    try {
      const body = await response.json();
      if (body && typeof body.error === "string") message = body.error;
    } catch {
      /* keep status-derived message */
    }
    throw new Error(message);
  }

  if (!response.body) {
    throw new Error("Streaming response has no body (browser too old?).");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Walk every complete line. Holding the leftover (no trailing \n) for
      // the next read covers the case where one event splits across two
      // network chunks.
      let nlIdx: number;
      while ((nlIdx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nlIdx);
        buffer = buffer.slice(nlIdx + 1);
        if (!line) continue;
        try {
          onEvent(JSON.parse(line) as ServerEvent);
        } catch (err) {
          // A malformed line is logged but doesn't kill the stream — better
          // to keep delivering the rest than to fail the whole conversion.
          console.warn("[ppt] skipped bad NDJSON line:", line, err);
        }
      }
    }

    // Drain any trailing partial line. Practically the server always ends
    // with `\n` so this is a no-op, but a future protocol tweak that omits
    // the final newline shouldn't break the client.
    const tail = buffer.trim();
    if (tail) {
      try {
        onEvent(JSON.parse(tail) as ServerEvent);
      } catch {
        /* ignore */
      }
    }
  } finally {
    // Release the reader so the underlying body stream can be GC'd. Calling
    // `cancel` is safe even if we read to completion — it becomes a no-op.
    reader.cancel().catch(() => {});
  }
}

function trimSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function absoluteUrl(base: string, ref: string): string {
  if (/^https?:\/\//i.test(ref)) return ref;
  const trimmed = trimSlash(base);
  return `${trimmed}${ref.startsWith("/") ? "" : "/"}${ref}`;
}
