"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FilePreview } from "@ank1015-app/ui/file-preview";

type PreviewState = {
  readonly websocketUrl: string;
  readonly previewBaseUrl?: string;
  readonly path: string;
  readonly name: string;
};

type PreviewMessage =
  | {
      type: "update";
      path?: string;
      name?: string;
      websocketUrl?: string;
      previewBaseUrl?: string;
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
    const previewBaseUrl = searchParams.get("previewBaseUrl") ?? undefined;

    if (websocketUrl === null || path === null || name === null) {
      return null;
    }

    return { websocketUrl, previewBaseUrl, path, name };
  }, [searchParams]);

  const [state, setState] = useState<PreviewState | null>(initial);

  useEffect(() => {
    setState(initial);
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

        return {
          websocketUrl: message.websocketUrl ?? current.websocketUrl,
          previewBaseUrl: message.previewBaseUrl ?? current.previewBaseUrl,
          path: message.path ?? current.path,
          name: message.name ?? current.name,
        };
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

  return (
    <main style={shellStyle}>
      <FilePreview
        key={`${state.path}:${state.name}`}
        name={state.name}
        path={state.path}
        previewBaseUrl={state.previewBaseUrl}
        websocketUrl={state.websocketUrl}
      />
    </main>
  );
}

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
  color: "rgba(244,246,251,0.62)",
  fontSize: 14,
};
