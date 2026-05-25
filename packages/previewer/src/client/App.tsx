import { useEffect, useMemo, useReducer, useState } from "react";
import type { Dispatch } from "react";

import type { PreviewItem, PreviewServerMessage } from "../protocol";
import { Previewer, type PreviewTheme } from "./Previewer";
import { installFilesystemVoiceHotkeyRelay } from "./voiceHotkeyRelay";

type PreviewSlot = {
  readonly documentKey: string;
  readonly versionKey: string;
  readonly item: PreviewItem;
};

type PreviewBufferState = {
  readonly visibleSlot: PreviewSlot | null;
  readonly pendingSlot: PreviewSlot | null;
  readonly error: string | null;
};

type PreviewBufferAction =
  | { readonly type: "reset" }
  | { readonly type: "queue"; readonly slot: PreviewSlot }
  | { readonly type: "ready"; readonly key: string }
  | { readonly type: "previewError"; readonly key: string; readonly message: string }
  | { readonly type: "error"; readonly message: string };

const emptyPreviewBuffer: PreviewBufferState = {
  visibleSlot: null,
  pendingSlot: null,
  error: null,
};

type PreviewQuery = {
  readonly path: string | null;
  readonly root: string | null;
  readonly showChrome: boolean;
  readonly theme: PreviewTheme;
};

export function App(): React.ReactElement {
  const query = usePreviewQuery();
  const [buffer, dispatchBuffer] = useReducer(previewBufferReducer, emptyPreviewBuffer);
  const [status, setStatus] = useState<"idle" | "connecting" | "open" | "closed">("idle");

  useEffect(() => {
    const cleanup = installFilesystemVoiceHotkeyRelay(window);
    return () => cleanup?.();
  }, []);

  useEffect(() => {
    if (query.path === null || query.path.length === 0) {
      dispatchBuffer({ type: "reset" });
      setStatus("idle");
      return;
    }

    const socket = new WebSocket(buildPreviewWebSocketUrl());
    let cancelled = false;

    setStatus("connecting");
    dispatchBuffer({ type: "reset" });

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
        handlePreviewMessage(message, dispatchBuffer);
      } catch {
        dispatchBuffer({ type: "error", message: "Received an invalid preview message." });
      }
    });

    socket.addEventListener("close", () => {
      if (!cancelled) {
        setStatus("closed");
      }
    });

    socket.addEventListener("error", () => {
      if (!cancelled && socket.readyState === WebSocket.OPEN) {
        dispatchBuffer({ type: "error", message: "Preview websocket error." });
      }
    });

    return () => {
      cancelled = true;
      socket.close();
    };
  }, [query.path, query.root]);

  if (query.path === null || query.path.length === 0) {
    return <PreviewPlayground theme={query.theme} />;
  }

  return (
    <main
      className={query.showChrome ? "preview-shell" : "preview-shell preview-shell-embedded"}
      data-theme={query.theme}
    >
      {query.showChrome ? (
        <header className="preview-header">
          <span className="preview-status" data-state={status}>{status}</span>
          <span className="preview-path" title={query.path}>{query.path}</span>
        </header>
      ) : null}
      {buffer.error !== null ? <PreviewError message={buffer.error} /> : null}
      <section className="preview-stage" aria-label="File preview">
        {buffer.visibleSlot !== null || buffer.pendingSlot !== null ? (
          <PreviewBuffer
            visibleSlot={buffer.visibleSlot}
            pendingSlot={buffer.pendingSlot}
            theme={query.theme}
            onReady={(key) => {
              dispatchBuffer({ type: "ready", key });
            }}
            onError={(key, previewError) => {
              dispatchBuffer({ type: "previewError", key, message: previewError.message });
            }}
          />
        ) : buffer.error === null ? (
          <PreviewLoading />
        ) : null}
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
      theme: params.get("theme") === "light" ? "light" : "dark",
    };
  }, []);

const handlePreviewMessage = (
  message: PreviewServerMessage,
  dispatchBuffer: Dispatch<PreviewBufferAction>,
): void => {
  switch (message.type) {
    case "file": {
      const { type: _type, ...file } = message;
      queuePreviewItem({ kind: "file", file }, dispatchBuffer);
      return;
    }
    case "workbook": {
      const { type: _type, ...data } = message;
      queuePreviewItem({ kind: "workbook", data }, dispatchBuffer);
      return;
    }
    case "htmlPreview": {
      const { type: _type, ...data } = message;
      queuePreviewItem({ kind: "html", data }, dispatchBuffer);
      return;
    }
    case "error":
      dispatchBuffer({ type: "error", message: message.message });
      return;
    case "pong":
      return;
  }
};

const queuePreviewItem = (
  item: PreviewItem,
  dispatchBuffer: Dispatch<PreviewBufferAction>,
): void => {
  dispatchBuffer({
    type: "queue",
    slot: {
      documentKey: previewItemDocumentKey(item),
      versionKey: previewItemVersionKey(item),
      item,
    },
  });
};

const previewBufferReducer = (
  state: PreviewBufferState,
  action: PreviewBufferAction,
): PreviewBufferState => {
  switch (action.type) {
    case "reset":
      return emptyPreviewBuffer;
    case "queue":
      if (state.visibleSlot?.versionKey === action.slot.versionKey) {
        return { visibleSlot: state.visibleSlot, pendingSlot: null, error: null };
      }

      if (state.visibleSlot?.documentKey === action.slot.documentKey) {
        return {
          visibleSlot: action.slot,
          pendingSlot: null,
          error: null,
        };
      }

      return {
        visibleSlot: state.visibleSlot,
        pendingSlot: action.slot,
        error: state.visibleSlot === null ? null : state.error,
      };
    case "ready":
      if (state.pendingSlot?.versionKey !== action.key) {
        return state;
      }

      return {
        visibleSlot: state.pendingSlot,
        pendingSlot: null,
        error: null,
      };
    case "previewError":
      if (state.pendingSlot?.versionKey !== action.key) {
        return state;
      }

      return {
        visibleSlot: state.visibleSlot,
        pendingSlot: null,
        error: action.message,
      };
    case "error":
      return { ...state, error: action.message };
  }
};

const PreviewBuffer = ({
  visibleSlot,
  pendingSlot,
  theme,
  onReady,
  onError,
}: {
  readonly visibleSlot: PreviewSlot | null;
  readonly pendingSlot: PreviewSlot | null;
  readonly theme: PreviewTheme;
  readonly onReady: (key: string) => void;
  readonly onError: (key: string, error: Error) => void;
}): React.ReactElement => (
  <div className="preview-buffer">
    {visibleSlot !== null ? (
      <div className="preview-buffer-pane preview-buffer-pane-visible">
        <Previewer item={visibleSlot.item} theme={theme} />
      </div>
    ) : pendingSlot !== null ? (
      <PreviewLoading />
    ) : null}
    {pendingSlot !== null ? (
      <div
        key={pendingSlot.versionKey}
        className={
          visibleSlot === null
            ? "preview-buffer-pane preview-buffer-pane-pending preview-buffer-pane-initial"
            : "preview-buffer-pane preview-buffer-pane-pending"
        }
        aria-hidden={visibleSlot !== null}
      >
        <Previewer
          item={pendingSlot.item}
          theme={theme}
          onReady={() => onReady(pendingSlot.versionKey)}
          onError={(previewError) => onError(pendingSlot.versionKey, previewError)}
        />
      </div>
    ) : null}
  </div>
);

const previewItemDocumentKey = (item: PreviewItem): string => {
  if (item.kind === "file") {
    return ["file", item.file.path, item.file.mime].join(":");
  }

  if (item.kind === "workbook") {
    return ["workbook", item.data.path].join(":");
  }

  return ["html", item.data.path].join(":");
};

const previewItemVersionKey = (item: PreviewItem): string => {
  if (item.kind === "file") {
    const { file } = item;
    return ["file", file.path, String(file.mtime), String(file.size), file.mime].join(":");
  }

  if (item.kind === "workbook") {
    return ["workbook", item.data.path, String(item.data.mtime), String(item.data.size)].join(":");
  }

  return ["html", item.data.path, String(item.data.mtime), item.data.url].join(":");
};

const PreviewPlayground = ({ theme }: { readonly theme: PreviewTheme }): React.ReactElement => {
  const [path, setPath] = useState("");
  const [root, setRoot] = useState("");

  return (
    <main className="preview-playground" data-theme={theme}>
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
