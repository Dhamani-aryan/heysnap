# Browser Control POST API

This API lets an internal program on the machine call the machine server, which
forwards the request to the connected `apps/web` browser-control websocket
client. The web client talks to the Chrome extension, then returns the result
through the same request path.

## Endpoint

Local machine server:

```http
POST http://127.0.0.1:4000/browser-control/requests
Content-Type: application/json
```

When called from inside a Docker machine container, use the same URL:

```sh
curl -sS -X POST http://127.0.0.1:4000/browser-control/requests \
  -H 'content-type: application/json' \
  --data '{"command":"getTabs","params":{},"timeoutMs":10000}'
```

## Request Envelope

```ts
type BrowserControlPostRequest = BrowserControlCommand & {
  targetUserId?: string;
  timeoutMs?: number;
  clientRequestId?: string;
  attachments?: BrowserControlAttachment[];
};

type BrowserControlAttachment = {
  id: string;
  path: string;
  name?: string;
  mimeType?: string;
};
```

Fields:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `command` | string | yes | One of the commands below. |
| `params` | object | command-dependent | Command payload. `getTabs` and `createNewTab` may omit it. |
| `targetUserId` | string | no | Routes to the latest connected browser client for that user. If omitted, routes to the latest connected browser client. |
| `timeoutMs` | number | no | Positive number. Defaults to `30000`; max is `300000`. |
| `clientRequestId` | string | no | Caller-provided trace id. It is forwarded through the websocket frame but is not currently echoed in the HTTP response. |
| `attachments` | array | no | Request-scoped files from the machine filesystem root. V1 hydrates attachments only for `tab.evaluate`. |

All tab commands are scoped to the managed Chrome window remembered by the web
client. If no `windowId` exists in the web client's browser-window store, the
web client opens one before executing the command.

## Request Attachments

Attachments let `tab.evaluate` work with files that exist inside the machine,
even though Chrome is running on the user's side. Attachment `path` values are
root-relative filesystem paths, using the same path model as the filesystem UI.

Limits: at most 10 files, at most 50 MiB per file, and at most 100 MiB total.
The server validates files before forwarding the browser-control request, then
serves request-scoped chunks over the existing browser-control websocket.

Example:

```json
{
  "command": "tab.evaluate",
  "params": {
    "tabId": 123,
    "expression": "await window.__heysnapFiles.setInputFiles('input[type=file]', ['avatar'])"
  },
  "attachments": [
    {
      "id": "avatar",
      "path": "assets/avatar.png",
      "mimeType": "image/png"
    }
  ],
  "timeoutMs": 120000
}
```

During `tab.evaluate`, the web client hydrates files into the page and exposes:

```ts
await window.__heysnapFiles.get(id);
await window.__heysnapFiles.getAll(ids);
await window.__heysnapFiles.setInputFiles(selectorOrElement, ids);
await window.__heysnapFiles.dropFiles(selectorOrElement, ids);
window.__heysnapFiles.clear(ids);
```

## Response Envelope

Successful command:

```ts
type BrowserControlSuccess<T> = {
  ok: true;
  result: T;
};
```

Command or routing failure:

```ts
type BrowserControlFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};
```

The endpoint usually returns HTTP `200` for valid request envelopes, including
browser/extension failures. Invalid request bodies return HTTP `400` with
`ok: false` and `error.code = "INVALID_REQUEST"`.

Common errors:

| Code | Meaning |
| --- | --- |
| `CHROME_NOT_CONNECTED` | No browser-control websocket client is connected. Open the machine workspace in Chrome. |
| `BROWSER_CONTROL_TIMEOUT` | The connected browser client did not respond before `timeoutMs`. |
| `BROWSER_CONTROL_CANCELLED` | The HTTP request was cancelled before completion. |
| `BROWSER_WINDOW_UNAVAILABLE` | Chrome is connected, but the managed browser window could not be opened. |
| `BROWSER_EXECUTOR_UNAVAILABLE` | The web workspace has no browser executor available. |
| `BROWSER_EXECUTOR_ERROR` | The web client or extension command failed. |
| `BROWSER_ATTACHMENTS_UNSUPPORTED` | Attachments were used with a command other than `tab.evaluate`, or without the workspace browser executor. |
| `BROWSER_ATTACHMENT_CHANGED` | An attachment changed after request validation and before chunk streaming completed. |
| `BROWSER_OUTPUTS_UNSUPPORTED` | Output streaming was used without the workspace browser executor. |
| `BROWSER_OUTPUT_TOO_LARGE` | A screenshot output exceeded the configured file-size limit. |
| `BROWSER_OUTPUT_INCOMPLETE` | The browser client responded before finishing the screenshot output stream. |
| `INVALID_REQUEST` | Request JSON or params failed server validation. |

## Shared Result Types

Chrome tab objects are returned directly from the extension for some commands.
Chrome may add or omit fields by platform/version, so CLI code should tolerate
extra fields.

```ts
type ChromeTab = {
  id?: number;
  windowId?: number;
  index?: number;
  active?: boolean;
  highlighted?: boolean;
  selected?: boolean;
  pinned?: boolean;
  url?: string;
  pendingUrl?: string;
  title?: string;
  status?: "loading" | "complete" | string;
  favIconUrl?: string;
  width?: number;
  height?: number;
  incognito?: boolean;
  discarded?: boolean;
  audible?: boolean;
  mutedInfo?: unknown;
  [key: string]: unknown;
};

type ManagedWindowRecord = {
  windowId: number;
  tabId: number;
  url: string;
  createdAt: string;
  updatedAt: string;
};

type ManagedWindowTab = {
  id: number;
  windowId: number;
  index: number;
  active: boolean;
  title: string;
  url: string;
  favIconUrl?: string;
  status?: string;
};

type ManagedWindowTabState = {
  window: ManagedWindowRecord;
  tabs: ManagedWindowTab[];
};

type WaitForLoad =
  | boolean
  | {
      timeoutMs?: number;
      waitUntil?: "domcontentloaded" | "complete" | "networkIdle";
    };

type LoadWaitResult = {
  waited: true;
  waitUntil: "domcontentloaded" | "complete" | "networkIdle";
  tabId: number;
  href: string;
  title: string;
  readyState: string;
  resourceCount: number;
  elapsedMs: number;
};
```

## Commands

### `getTabs`

Lists tabs in the managed browser window. The web client always uses the
managed `windowId` from its store.

```ts
type GetTabsRequest = {
  command: "getTabs";
  params?: {
    active?: boolean;
    currentWindow?: boolean;
    windowId?: number;
  };
};

type GetTabsResponse = BrowserControlSuccess<ChromeTab[]>;
```

Notes:

- `active` filters to active tabs.
- `windowId` is accepted by the machine server for compatibility, but the web
  client overrides it with the managed window id.

Example:

```json
{
  "command": "getTabs",
  "params": {},
  "timeoutMs": 10000
}
```

### `createNewTab`

Creates one or more tabs in the managed browser window.

```ts
type CreateNewTabRequest = {
  command: "createNewTab";
  params?: (CreateNewTabTarget & { waitForLoad?: WaitForLoad }) |
    {
      tabs: CreateNewTabTarget[];
      waitForLoad?: WaitForLoad;
    };
};

type CreateNewTabTarget = {
  url?: string;
  active?: boolean;
  windowId?: number;
  index?: number;
  openerTabId?: number;
};

type CreateNewTabResponse = BrowserControlSuccess<{
  tabs: ChromeTab[];
  windowId: number;
  loads?: LoadWaitResult[];
}>;
```

Notes:

- If `params` is omitted, a blank/new-tab tab is created.
- You may pass a single tab object or `{ "tabs": [...] }`.
- `windowId` is accepted by the machine server for compatibility, but the web
  client creates tabs in the managed window id from its store.
- `waitForLoad` applies after each created tab with a URL. The response includes
  `loads` in the same order as the created tabs that were waited on; blank tabs
  are not waited on.

Example:

```json
{
  "command": "createNewTab",
  "params": {
    "tabs": [
      {
        "url": "https://example.com/",
        "active": true
      }
    ],
    "waitForLoad": {
      "waitUntil": "complete",
      "timeoutMs": 15000
    }
  },
  "timeoutMs": 20000
}
```

### `closeTab`

Closes one or more tabs in the managed browser window.

```ts
type CloseTabRequest = {
  command: "closeTab";
  params:
    | { tabId: number }
    | { tabIds: number[] };
};

type CloseTabResponse = BrowserControlSuccess<ManagedWindowTabState>;
```

Notes:

- Pass exactly one of `tabId` or `tabIds`.
- If multiple tab ids are passed, the returned result is the managed window
  state after the final close.
- If the last managed tab is closed, the extension opens a replacement new tab.

Example:

```json
{
  "command": "closeTab",
  "params": {
    "tabIds": [123]
  }
}
```

### `tab.focus`

Activates a tab in the managed browser window.

```ts
type TabFocusRequest = {
  command: "tab.focus";
  params: {
    tabId: number;
  };
};

type TabFocusResponse = BrowserControlSuccess<ManagedWindowTabState>;
```

Example:

```json
{
  "command": "tab.focus",
  "params": {
    "tabId": 123
  }
}
```

### `tab.goTo`

Navigates and activates a managed-window tab.

```ts
type TabGoToRequest = {
  command: "tab.goTo";
  params: {
    tabId: number;
    url: string;
    waitForLoad?: WaitForLoad;
  };
};

type TabGoToResponse = BrowserControlSuccess<
  ManagedWindowTabState & {
    load?: LoadWaitResult;
  }
>;
```

Notes:

- Without `waitForLoad`, the response may arrive while Chrome reports the tab
  as `loading`.
- If the current tab is a restricted `chrome://` page and `managedWindow.navigate`
  cannot run from that context, the web client falls back to the extension's
  `tabs.update` command and still returns the managed window/tab state.
- `waitForLoad: true` waits for `document.readyState === "complete"`.
- `waitForLoad.waitUntil = "domcontentloaded"` waits for `interactive` or
  `complete`.
- `waitForLoad.waitUntil = "networkIdle"` waits for `complete` and a stable
  resource count for a short idle window.

Example:

```json
{
  "command": "tab.goTo",
  "params": {
    "tabId": 123,
    "url": "https://example.org/",
    "waitForLoad": {
      "waitUntil": "complete",
      "timeoutMs": 15000
    }
  },
  "timeoutMs": 20000
}
```

### `tab.refresh`

Reloads a tab.

```ts
type TabRefreshRequest = {
  command: "tab.refresh";
  params: {
    tabId: number;
    bypassCache?: boolean;
    waitForLoad?: WaitForLoad;
  };
};

type TabRefreshResponse = BrowserControlSuccess<{
  reloaded: true;
  tabId: number;
  load?: LoadWaitResult;
}>;
```

Example:

```json
{
  "command": "tab.refresh",
  "params": {
    "tabId": 123,
    "bypassCache": false,
    "waitForLoad": true
  }
}
```

### `tab.back`

Navigates one entry back in a tab's CDP navigation history.

```ts
type TabBackRequest = {
  command: "tab.back";
  params: {
    tabId: number;
    waitForLoad?: WaitForLoad;
  };
};

type TabHistoryResponse = BrowserControlSuccess<
  | {
      navigated: true;
      direction: "back" | "forward";
      entry: {
        id: number;
        url?: string;
        title?: string;
      };
      result: unknown;
      tabId: number;
      load?: LoadWaitResult;
    }
  | {
      navigated: false;
      reason: "NO_BACK_HISTORY" | "NO_FORWARD_HISTORY";
      currentIndex: number;
      tabId: number;
    }
>;
```

Example:

```json
{
  "command": "tab.back",
  "params": {
    "tabId": 123,
    "waitForLoad": true
  }
}
```

### `tab.forward`

Navigates one entry forward in a tab's CDP navigation history.

```ts
type TabForwardRequest = {
  command: "tab.forward";
  params: {
    tabId: number;
    waitForLoad?: WaitForLoad;
  };
};

type TabForwardResponse = TabHistoryResponse;
```

Example:

```json
{
  "command": "tab.forward",
  "params": {
    "tabId": 123,
    "waitForLoad": {
      "waitUntil": "networkIdle",
      "timeoutMs": 15000
    }
  }
}
```

### `tab.evaluate`

Evaluates JavaScript in a tab and returns the evaluated value directly. This is
a convenience wrapper around CDP `Runtime.evaluate`.

```ts
type TabEvaluateRequest = {
  command: "tab.evaluate";
  params: {
    tabId: number;
    expression: string;
    awaitPromise?: boolean;
    returnByValue?: boolean;
    timeoutMs?: number;
  };
};

type TabEvaluateResponse = BrowserControlSuccess<
  | {
      ok: true;
      result: unknown;
    }
  | {
      ok: false;
      exceptionDetails: unknown;
    }
>;
```

Notes:

- `returnByValue` defaults to `true`.
- If the expression throws, the command itself still returns `ok: true` at the
  browser-control envelope level, with `result.ok = false` and CDP
  `exceptionDetails` inside the result.

Example: read URL, title, and page metadata.

```json
{
  "command": "tab.evaluate",
  "params": {
    "tabId": 123,
    "expression": "({ href: location.href, title: document.title, description: document.querySelector('meta[name=\"description\"]')?.content ?? null })",
    "awaitPromise": true
  },
  "timeoutMs": 10000
}
```

Example response:

```json
{
  "ok": true,
  "result": {
    "ok": true,
    "result": {
      "href": "https://example.com/",
      "title": "Example Domain",
      "description": null
    }
  }
}
```

### `tab.screenshot`

Captures a screenshot from a tab through CDP and saves it inside the machine
filesystem root. Screenshot bytes are streamed back to the machine server over
the browser-control websocket and are not returned in the HTTP response.

```ts
type TabScreenshotRequest = {
  command: "tab.screenshot";
  params: {
    tabId: number;
    path: string;
    captureMode?: "viewport" | "fullPage" | "clip";
    clip?: { x: number; y: number; width: number; height: number; scale?: number };
    format?: "png" | "jpeg" | "webp";
    quality?: number;
    overwrite?: boolean;
    waitForLoad?: WaitForLoad;
    fromSurface?: boolean;
    captureBeyondViewport?: boolean;
    optimizeForSpeed?: boolean;
  };
};

type TabScreenshotResponse = BrowserControlSuccess<{
  tabId: number | null;
  path: string;
  format: "png" | "jpeg" | "webp";
  mimeType: string;
  size: number;
  overwritten: boolean;
}>;
```

Notes:

- `path` is filesystem-root-relative. Parent folders are created automatically.
- Existing files fail unless `overwrite` is `true`.
- `format` is inferred from `.png`, `.jpg`, `.jpeg`, or `.webp`; otherwise it
  defaults to `png`. If provided, it must match the extension.
- `captureMode` defaults to `viewport`. `fullPage` uses CDP layout metrics and
  `captureBeyondViewport`. `clip` requires `clip`.
- `quality` is valid only for `jpeg` and `webp`.

Example: capture the visible viewport.

```json
{
  "command": "tab.screenshot",
  "params": {
    "tabId": 123,
    "path": "screenshots/example.png"
  },
  "timeoutMs": 30000
}
```

Example: capture a full-page JPEG and replace any previous file.

```json
{
  "command": "tab.screenshot",
  "params": {
    "tabId": 123,
    "path": "screenshots/example-full.jpeg",
    "captureMode": "fullPage",
    "quality": 85,
    "overwrite": true,
    "waitForLoad": true
  },
  "timeoutMs": 60000
}
```

Example response:

```json
{
  "ok": true,
  "result": {
    "tabId": 123,
    "path": "screenshots/example.png",
    "format": "png",
    "mimeType": "image/png",
    "size": 42891,
    "overwritten": false
  }
}
```

### `tab.cdp`

Sends a Chrome DevTools Protocol command to a tab. The extension auto-attaches
for the command and detaches afterward when it owns the attachment.

```ts
type TabCdpRequest = {
  command: "tab.cdp";
  params: {
    tabId: number;
    method: string;
    params?: Record<string, unknown>;
  };
};

type TabCdpResponse = BrowserControlSuccess<unknown>;
```

Example: read page URL and title.

```json
{
  "command": "tab.cdp",
  "params": {
    "tabId": 123,
    "method": "Runtime.evaluate",
    "params": {
      "expression": "({ href: location.href, title: document.title })",
      "returnByValue": true
    }
  },
  "timeoutMs": 15000
}
```

Example response:

```json
{
  "ok": true,
  "result": {
    "result": {
      "type": "object",
      "value": {
        "href": "https://example.com/",
        "title": "Example Domain"
      }
    }
  }
}
```

Example: click using CDP input events.

```json
{
  "command": "tab.cdp",
  "params": {
    "tabId": 123,
    "method": "Input.dispatchMouseEvent",
    "params": {
      "type": "mousePressed",
      "x": 500,
      "y": 300,
      "button": "left",
      "clickCount": 1
    }
  }
}
```

Follow with:

```json
{
  "command": "tab.cdp",
  "params": {
    "tabId": 123,
    "method": "Input.dispatchMouseEvent",
    "params": {
      "type": "mouseReleased",
      "x": 500,
      "y": 300,
      "button": "left",
      "clickCount": 1
    }
  }
}
```

## Full Union

```ts
type BrowserControlCommand =
  | GetTabsRequest
  | CreateNewTabRequest
  | CloseTabRequest
  | TabFocusRequest
  | TabBackRequest
  | TabForwardRequest
  | TabGoToRequest
  | TabRefreshRequest
  | TabEvaluateRequest
  | TabScreenshotRequest
  | TabCdpRequest;
```

## CLI Implementation Notes

- Before controlling the browser, call `getTabs` and handle
  `CHROME_NOT_CONNECTED` by telling the user to open the machine workspace in
  Chrome.
- Treat every response as `BrowserControlSuccess<T> | BrowserControlFailure`.
- Prefer using returned `tab.id` values from `getTabs` or `createNewTab`.
- For navigation, prefer `waitForLoad` on `createNewTab`, `tab.goTo`,
  `tab.back`, `tab.forward`, and `tab.refresh` when the next CLI step depends
  on the final page state.
- Prefer `tab.evaluate` over raw `tab.cdp` `Runtime.evaluate` for normal page
  extraction.
- `tab.cdp` is intentionally powerful. Keep CLI affordances narrow where
  possible, and expose raw CDP only to trusted internal callers.
