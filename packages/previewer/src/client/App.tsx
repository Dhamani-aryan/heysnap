import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Dispatch, RefObject } from "react";

import type { PreviewClientMessage, PreviewItem, PreviewServerMessage, PreviewWorkbookPatchMessage } from "../protocol";
import { applyWorkbookPatch } from "../workbookPatch";
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
  | { readonly type: "workbookPatch"; readonly message: PreviewWorkbookPatchMessage }
  | { readonly type: "ready"; readonly key: string }
  | { readonly type: "previewError"; readonly key: string; readonly message: string }
  | { readonly type: "error"; readonly message: string };

const emptyPreviewBuffer: PreviewBufferState = {
  visibleSlot: null,
  pendingSlot: null,
  error: null,
};

const PREVIEW_THEME_STORAGE_KEY = "heysnap-preview-theme";

type PreviewQuery = {
  readonly path: string | null;
  readonly root: string | null;
  readonly theme: PreviewTheme;
};

export function App(): React.ReactElement {
  const query = usePreviewQuery();
  const [theme, setTheme] = useState<PreviewTheme>(() => query.theme);
  const [buffer, dispatchBuffer] = useReducer(previewBufferReducer, emptyPreviewBuffer);
  const bufferRef = useRef(buffer);

  useEffect(() => {
    bufferRef.current = buffer;
  }, [buffer]);

  useEffect(() => {
    const cleanup = installFilesystemVoiceHotkeyRelay(window);
    return () => cleanup?.();
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (window.parent !== window && event.source !== window.parent) {
        return;
      }

      const nextTheme = previewThemeFromMessage(event.data);

      if (nextTheme !== null) {
        setTheme(nextTheme);
        writeStoredPreviewTheme(nextTheme);
      }
    };

    window.addEventListener("message", handleMessage);
    notifyParentPreviewReady();

    const retryTimers = [
      window.setTimeout(notifyParentPreviewReady, 100),
      window.setTimeout(notifyParentPreviewReady, 500),
    ];

    return () => {
      window.removeEventListener("message", handleMessage);
      for (const timer of retryTimers) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  useEffect(() => {
    if (query.path === null || query.path.length === 0) {
      dispatchBuffer({ type: "reset" });
      return;
    }

    const socket = new WebSocket(buildPreviewWebSocketUrl());
    const watchMessage = createWatchMessage(query);
    let cancelled = false;

    dispatchBuffer({ type: "reset" });

    const sendWatchMessage = () => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(watchMessage));
      }
    };

    socket.addEventListener("open", () => {
      if (cancelled) {
        return;
      }

      sendWatchMessage();
    });

    socket.addEventListener("message", (event) => {
      if (cancelled) {
        return;
      }

      try {
        const message = JSON.parse(String(event.data)) as PreviewServerMessage;
        handlePreviewMessage(message, dispatchBuffer, bufferRef, sendWatchMessage);
      } catch {
        dispatchBuffer({ type: "error", message: "Received an invalid preview message." });
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
    return <PreviewPlayground theme={theme} />;
  }

  return (
    <main className="preview-shell" data-theme={theme}>
      {buffer.error !== null ? <PreviewError message={buffer.error} /> : null}
      <section className="preview-stage" aria-label="File preview">
        {buffer.visibleSlot !== null || buffer.pendingSlot !== null ? (
          <PreviewBuffer
            visibleSlot={buffer.visibleSlot}
            pendingSlot={buffer.pendingSlot}
            theme={theme}
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
    const themeParam = params.get("theme");

    return {
      path: params.get("path"),
      root: params.get("root"),
      theme: themeParam === "light" || themeParam === "dark"
        ? themeParam
        : readStoredPreviewTheme() ?? "dark",
    };
  }, []);

const previewThemeFromMessage = (data: unknown): PreviewTheme | null => {
  if (!isRecord(data) || data["type"] !== "heysnap:preview-theme") {
    return null;
  }

  return data["theme"] === "light" || data["theme"] === "dark" ? data["theme"] : null;
};

const createWatchMessage = (query: PreviewQuery): PreviewClientMessage => ({
  type: "watch",
  path: query.path ?? "",
  publicBasePath: getPreviewBasePath(),
  ...(query.root === null || query.root.length === 0 ? {} : { root: query.root }),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const notifyParentPreviewReady = (): void => {
  if (window.parent === window) {
    return;
  }

  window.parent.postMessage({ type: "heysnap:preview-ready" }, "*");
};

const readStoredPreviewTheme = (): PreviewTheme | null => {
  try {
    const stored = window.localStorage.getItem(PREVIEW_THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : null;
  } catch {
    return null;
  }
};

const writeStoredPreviewTheme = (theme: PreviewTheme): void => {
  try {
    window.localStorage.setItem(PREVIEW_THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore storage errors; live postMessage updates still drive the UI.
  }
};

const handlePreviewMessage = (
  message: PreviewServerMessage,
  dispatchBuffer: Dispatch<PreviewBufferAction>,
  bufferRef: RefObject<PreviewBufferState>,
  requestFreshSnapshot: () => void,
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
    case "workbookPatch": {
      const currentWorkbook = getCurrentWorkbook(bufferRef.current, message.path);

      if (currentWorkbook?.version !== message.baseVersion) {
        requestFreshSnapshot();
        return;
      }

      dispatchBuffer({ type: "workbookPatch", message });
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

const getCurrentWorkbook = (
  state: PreviewBufferState | undefined,
  path: string,
) => {
  const visibleItem = state?.visibleSlot?.item;
  if (visibleItem?.kind === "workbook" && visibleItem.data.path === path) {
    return visibleItem.data;
  }

  const pendingItem = state?.pendingSlot?.item;
  if (pendingItem?.kind === "workbook" && pendingItem.data.path === path) {
    return pendingItem.data;
  }

  return null;
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
    case "workbookPatch": {
      const visibleSlot = applyWorkbookPatchToSlot(state.visibleSlot, action.message);

      if (visibleSlot !== null) {
        return {
          visibleSlot,
          pendingSlot: state.pendingSlot,
          error: null,
        };
      }

      const pendingSlot = applyWorkbookPatchToSlot(state.pendingSlot, action.message);

      if (pendingSlot === null) {
        return { ...state, error: "Received a workbook patch before the workbook loaded." };
      }

      return {
        visibleSlot: state.visibleSlot,
        pendingSlot,
        error: null,
      };
    }
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

const applyWorkbookPatchToSlot = (
  slot: PreviewSlot | null,
  message: PreviewWorkbookPatchMessage,
): PreviewSlot | null => {
  if (slot?.item.kind !== "workbook" || slot.item.data.path !== message.path) {
    return null;
  }

  if (slot.item.data.version !== message.baseVersion) {
    return null;
  }

  const item: PreviewItem = {
    kind: "workbook",
    data: {
      ...slot.item.data,
      path: message.path,
      name: message.name,
      size: message.size,
      mtime: message.mtime,
      version: message.version,
      downloadUrl: message.downloadUrl,
      change: message.change,
      workbook: applyWorkbookPatch(slot.item.data.workbook, message.patch),
    },
  };

  return {
    documentKey: previewItemDocumentKey(item),
    versionKey: previewItemVersionKey(item),
    item,
  };
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
    {visibleSlot === null && pendingSlot !== null ? <PreviewLoading /> : null}
    {visibleSlot !== null ? (
      <PreviewBufferPane key={visibleSlot.documentKey} slot={visibleSlot} state="visible" theme={theme} />
    ) : null}
    {pendingSlot !== null ? (
      <PreviewBufferPane
        key={pendingSlot.documentKey}
        slot={pendingSlot}
        state={visibleSlot === null ? "initialPending" : "pending"}
        theme={theme}
        onReady={() => onReady(pendingSlot.versionKey)}
        onError={(previewError) => onError(pendingSlot.versionKey, previewError)}
      />
    ) : null}
  </div>
);

const PreviewBufferPane = ({
  slot,
  state,
  theme,
  onReady,
  onError,
}: {
  readonly slot: PreviewSlot;
  readonly state: "visible" | "pending" | "initialPending";
  readonly theme: PreviewTheme;
  readonly onReady?: () => void;
  readonly onError?: (error: Error) => void;
}): React.ReactElement => {
  const isVisible = state === "visible";
  const className = isVisible
    ? "preview-buffer-pane preview-buffer-pane-visible"
    : state === "initialPending"
      ? "preview-buffer-pane preview-buffer-pane-pending preview-buffer-pane-initial"
      : "preview-buffer-pane preview-buffer-pane-pending";

  return (
    <div className={className} aria-hidden={state === "pending" ? true : undefined}>
      <Previewer item={slot.item} theme={theme} onReady={onReady} onError={onError} />
    </div>
  );
};

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
    return [
      "workbook",
      item.data.path,
      String(item.data.version),
      String(item.data.mtime),
      String(item.data.size),
    ].join(":");
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
  <div className="preview-loading" aria-hidden="true" />
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
