"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  FilePreview,
  buildFilesystemDownloadUrl,
  buildFilesystemPreviewUrl,
  buildFilesystemXlsxUrl,
  isDocxFile,
  isImageFile,
  isOfficePdfPreviewFile,
  isPdfFile,
  isPptxFile,
  isXlsxFile,
} from "@ank1015-app/ui/file-preview";

type PreviewState = {
  websocketUrl: string;
  path: string;
  name: string;
  version: string;
};

type PreviewMessage =
  | {
      type: "update";
      version?: string;
      path?: string;
      name?: string;
      websocketUrl?: string;
    }
  | {
      type: "ping";
    };

export default function PreviewPage(): React.ReactElement {
  return (
    <Suspense fallback={(
      <main style={shellStyle}>
        <div style={messageStyle}>Loading preview...</div>
      </main>
    )}>
      <PreviewPageContent />
    </Suspense>
  );
}

function PreviewPageContent(): React.ReactElement {
  const searchParams = useSearchParams();
  const initial = useMemo<PreviewState | null>(() => {
    const websocketUrl = searchParams.get("websocketUrl");
    const path = searchParams.get("path");
    const name = searchParams.get("name");
    const version = searchParams.get("v") ?? "";

    if (websocketUrl === null || path === null || name === null) {
      return null;
    }

    return { websocketUrl, path, name, version };
  }, [searchParams]);

  const [state, setState] = useState<PreviewState | null>(initial);
  const [stagedState, setStagedState] = useState<PreviewState | null>(null);

  useEffect(() => {
    setState(initial);
    setStagedState(null);
  }, [initial]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent): void => {
      const message = parsePreviewMessage(event.data);

      if (message === null) {
        return;
      }

      if (message.type === "ping") {
        notifyHost({ type: "pong" });
        return;
      }

      setState((current) => {
        if (current === null) {
          return current;
        }

        const next = {
          websocketUrl: message.websocketUrl ?? current.websocketUrl,
          path: message.path ?? current.path,
          name: message.name ?? current.name,
          version: message.version ?? current.version,
        };

        if (isSamePreviewDocument(current, next)) {
          setStagedState(next);
          return current;
        }

        setStagedState(null);
        return next;
      });
    };

    window.addEventListener("message", handleMessage);
    notifyHost({ type: "ready" });

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  if (state === null) {
    return (
      <main style={shellStyle}>
        <div style={messageStyle}>Missing preview parameters.</div>
      </main>
    );
  }

  const visibleState = state;

  return (
    <main style={shellStyle}>
      <FilePreview
        key={`${visibleState.path}:${visibleState.name}`}
        name={visibleState.name}
        path={visibleState.path}
        websocketUrl={visibleState.websocketUrl}
        version={visibleState.version}
      />
      {stagedState === null ? null : (
        <PreviewPreloader
          state={stagedState}
          onReady={(readyState) => {
            setState((current) => {
              if (current === null || !isSamePreviewDocument(current, readyState)) {
                return current;
              }

              return readyState;
            });
            setStagedState((current) => (
              current !== null && isSamePreviewVersion(current, readyState) ? null : current
            ));
          }}
        />
      )}
    </main>
  );
}

function PreviewPreloader({
  state,
  onReady,
}: {
  state: PreviewState;
  onReady: (state: PreviewState) => void;
}): null {
  useEffect(() => {
    const abortController = new AbortController();

    void preloadPreviewState(state, abortController.signal)
      .catch(() => undefined)
      .then(() => {
        if (!abortController.signal.aborted) {
          onReady(state);
        }
      });

    return () => {
      abortController.abort();
    };
  }, [onReady, state]);

  return null;
}

const preloadPreviewState = async (
  state: PreviewState,
  signal: AbortSignal,
): Promise<void> => {
  const url = getPreviewAssetUrl(state);

  if (url === null) {
    return;
  }

  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error(`Failed to preload preview (${String(response.status)}).`);
  }

  await response.blob();
};

const getPreviewAssetUrl = (state: PreviewState): string | null => {
  if (isPdfFile(state.name) || isOfficePdfPreviewFile(state.name)) {
    return buildFilesystemPreviewUrl(state.websocketUrl, state.path, "pdf", state.version);
  }

  if (isXlsxFile(state.name)) {
    return buildFilesystemXlsxUrl(state.websocketUrl, state.path, state.version);
  }

  if (isDocxFile(state.name) || isPptxFile(state.name) || isImageFile(state.name)) {
    return buildFilesystemDownloadUrl(state.websocketUrl, [state.path], state.version);
  }

  return buildFilesystemDownloadUrl(state.websocketUrl, [state.path], state.version);
};

const isSamePreviewDocument = (left: PreviewState, right: PreviewState): boolean =>
  left.websocketUrl === right.websocketUrl &&
  left.path === right.path &&
  left.name === right.name;

const isSamePreviewVersion = (left: PreviewState, right: PreviewState): boolean =>
  isSamePreviewDocument(left, right) && left.version === right.version;

const parsePreviewMessage = (raw: unknown): PreviewMessage | null => {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;

      return parsePreviewMessage(parsed);
    } catch {
      return null;
    }
  }

  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const candidate = raw as { type?: unknown };

  if (candidate.type === "update" || candidate.type === "ping") {
    return raw as PreviewMessage;
  }

  return null;
};

const notifyHost = (payload: { type: "ready" | "pong" }): void => {
  const message = JSON.stringify(payload);
  // React Native WebView injects a global ReactNativeWebView with postMessage.
  const bridge = (window as unknown as { ReactNativeWebView?: { postMessage: (data: string) => void } })
    .ReactNativeWebView;

  if (bridge !== undefined) {
    bridge.postMessage(message);
    return;
  }

  if (window.parent !== window) {
    window.parent.postMessage(payload, "*");
  }
};

const shellStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  width: "100vw",
  height: "100vh",
  margin: 0,
  padding: 0,
  background: "#0b0d11",
  color: "#f4f6fb",
  overflow: "hidden",
  colorScheme: "dark",
};

const messageStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "rgba(244,246,251,0.55)",
  fontSize: 14,
};
