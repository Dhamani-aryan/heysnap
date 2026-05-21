import { useEffect, useMemo, useState } from "react";

import type { PreviewItem, PreviewServerMessage } from "../protocol";
import { Previewer } from "./Previewer";

type PreviewQuery = {
  readonly path: string | null;
  readonly root: string | null;
  readonly showChrome: boolean;
};

export function App(): React.ReactElement {
  const query = usePreviewQuery();
  const [item, setItem] = useState<PreviewItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "connecting" | "open" | "closed">("idle");

  useEffect(() => {
    if (query.path === null || query.path.length === 0) {
      setItem(null);
      setError(null);
      setStatus("idle");
      return;
    }

    const socket = new WebSocket(buildPreviewWebSocketUrl());
    let cancelled = false;

    setStatus("connecting");
    setItem(null);
    setError(null);

    socket.addEventListener("open", () => {
      if (cancelled) {
        return;
      }

      setStatus("open");
      socket.send(JSON.stringify({
        type: "watch",
        path: query.path,
        publicBasePath: getPreviewBasePath(),
        ...(query.root === null || query.root.length === 0 ? {} : { root: query.root }),
      }));
    });

    socket.addEventListener("message", (event) => {
      if (cancelled) {
        return;
      }

      try {
        const message = JSON.parse(String(event.data)) as PreviewServerMessage;
        handlePreviewMessage(message, setItem, setError);
      } catch {
        setError("Received an invalid preview message.");
      }
    });

    socket.addEventListener("close", () => {
      if (!cancelled) {
        setStatus("closed");
      }
    });

    socket.addEventListener("error", () => {
      if (!cancelled && socket.readyState === WebSocket.OPEN) {
        setError("Preview websocket error.");
      }
    });

    return () => {
      cancelled = true;
      socket.close();
    };
  }, [query.path, query.root]);

  if (query.path === null || query.path.length === 0) {
    return <PreviewPlayground />;
  }

  return (
    <main className={query.showChrome ? "preview-shell" : "preview-shell preview-shell-embedded"}>
      {query.showChrome ? (
        <header className="preview-header">
          <span className="preview-status" data-state={status}>{status}</span>
          <span className="preview-path" title={query.path}>{query.path}</span>
        </header>
      ) : null}
      {error !== null ? <PreviewError message={error} /> : null}
      <section className="preview-stage" aria-label="File preview">
        {item !== null ? <Previewer item={item} /> : error === null ? <PreviewLoading /> : null}
      </section>
    </main>
  );
}

const usePreviewQuery = (): PreviewQuery =>
  useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      path: params.get("path"),
      root: params.get("root"),
      showChrome: params.get("chrome") !== "0",
    };
  }, []);

const handlePreviewMessage = (
  message: PreviewServerMessage,
  setItem: (item: PreviewItem | null) => void,
  setError: (error: string | null) => void,
): void => {
  switch (message.type) {
    case "file": {
      const { type: _type, ...file } = message;
      setError(null);
      setItem({ kind: "file", file });
      return;
    }
    case "workbook": {
      const { type: _type, ...data } = message;
      setError(null);
      setItem({ kind: "workbook", data });
      return;
    }
    case "htmlPreview": {
      const { type: _type, ...data } = message;
      setError(null);
      setItem({ kind: "html", data });
      return;
    }
    case "error":
      setError(message.message);
      return;
    case "pong":
      return;
  }
};

const PreviewPlayground = (): React.ReactElement => {
  const [path, setPath] = useState("");
  const [root, setRoot] = useState("");

  return (
    <main className="preview-playground">
      <form
        className="preview-playground-form"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmedPath = path.trim();

          if (trimmedPath.length === 0) {
            return;
          }

          const url = new URL(window.location.href);
          url.searchParams.set("path", trimmedPath);
          if (root.trim().length > 0) {
            url.searchParams.set("root", root.trim());
          } else {
            url.searchParams.delete("root");
          }
          window.location.href = url.toString();
        }}
      >
        <label>
          <span>Path</span>
          <input
            value={path}
            placeholder="/absolute/path/to/file"
            spellCheck={false}
            onChange={(event) => setPath(event.currentTarget.value)}
          />
        </label>
        <label>
          <span>HTML root</span>
          <input
            value={root}
            placeholder="optional"
            spellCheck={false}
            onChange={(event) => setRoot(event.currentTarget.value)}
          />
        </label>
        <button type="submit">Open</button>
      </form>
    </main>
  );
};

const PreviewError = ({ message }: { readonly message: string }): React.ReactElement => (
  <div className="preview-error" role="status">
    {message}
  </div>
);

const PreviewLoading = (): React.ReactElement => (
  <div className="preview-loading" role="status">
    Loading...
  </div>
);

const buildPreviewWebSocketUrl = (): string => {
  const basePath = getPreviewBasePath();
  const socketPath = `${basePath}/ws`.replace(/\/{2,}/gu, "/");
  const url = new URL(socketPath, window.location.href);
  url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
};

const getPreviewBasePath = (): string => {
  const injected = window.__HEYSNAP_PREVIEWER_BASE_PATH__;

  if (typeof injected === "string" && injected.length > 0 && injected !== "%HEYSNAP_PREVIEWER_BASE_PATH%") {
    return injected.replace(/\/+$/u, "");
  }

  return "/preview";
};
