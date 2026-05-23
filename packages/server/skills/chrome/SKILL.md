# Chrome Skill

Use this skill whenever the task needs the user's real browser rather than a headless or remote web fetch. This includes logging into websites, reading pages behind authentication, clicking through web apps, filling forms, checking browser-visible state, downloading from websites, or continuing work in the Chrome surface the user has open in HeySnap.

The user's dedicated Chrome window appears in `<current_ui_open_files>` as:

```json
{
  "filepath": "chrome",
  "isFocused": true
}
```

If that entry is present, Chrome is already open. If `isFocused` is true, the user is currently looking at the Chrome surface. Treat it like a strong context signal, similar to a focused file tab.

If the `chrome` entry is not present, you should still use this skill. Chrome commands will create or reconnect the dedicated browser window automatically when needed, so do not ask the user to open Chrome first.

Prefer this skill over generic web search or HTTP scraping when:

- The user asks you to work in a website or web app.
- The page may depend on login state, cookies, location, extensions, or a real browser.
- The user says they are looking at Chrome, the browser, a tab, or a page.
- The task requires clicking, typing, navigation, screenshots, JavaScript evaluation, or extracting visible page state.

Use care with destructive web actions. Read the page state first, verify targets before clicking, and avoid submitting purchases, financial transfers, account changes, or irreversible actions unless the user explicitly asked for that exact action.

# chrome CLI

```bash
chrome ....
```

## Global Options

These options are accepted by all browser-control commands.

| Option | Shape | Description |
| --- | --- | --- |
| `--timeout` | `--timeout <ms>` | Server `timeoutMs` field. Must be a positive integer. |
| `--json` | `--json` | Print the full CLI result envelope instead of human-readable output. |

## Output

Human output is the default. It is compact and intended for terminal use:

```text
2 tabs

* 123  Example Domain
     https://example.com/

  124  Search
     https://www.google.com/
```

Use `--json` for scripts:

```bash
chrome tabs list --json
```

JSON output shape:

```ts
type CliResult =
  | {
      ok: true;
      command: string;
      result: unknown;
      meta: {
        serverUrl: string;
        elapsedMs: number;
        clientRequestId?: string;
      };
    }
  | {
      ok: false;
      command: string;
      error: {
        code: string;
        message: string;
        details?: unknown;
      };
      meta: {
        serverUrl: string;
        elapsedMs: number;
        clientRequestId?: string;
        httpStatus?: number;
      };
    };
```

Exit codes:

| Code | Meaning |
| --- | --- |
| `0` | Request succeeded and `ok: true` was returned. |
| `1` | Server returned a valid browser-control failure. |
| `2` | Invalid CLI arguments. |
| `3` | Network/server unreachable. |
| `4` | Local CLI timeout while waiting for the server. |

## Tabs Commands

### `tabs list`

Lists tabs in the managed browser window.

```bash
chrome tabs list [--active] [global options]
```

Options:

| Option | Description |
| --- | --- |
| `--active` | Only return active tabs. |

Examples:

```bash
chrome tabs list
chrome tabs list --active --json
```

### `tabs new`

Creates one or more tabs in the managed browser window.

```bash
chrome tabs new [url...] [--inactive] [wait options] [global options]
```

Options:

| Option | Description |
| --- | --- |
| `--inactive` | Create the tab without activating it. |
| `--wait` | Wait for load when a URL is provided. |
| `--wait-until` | Wait until `complete`, `domcontentloaded`, or `networkIdle`. |
| `--load-timeout` | Timeout for the page load wait. |

Examples:

```bash
chrome tabs new
chrome tabs new https://example.com/ --wait
chrome tabs new https://example.com/ https://example.org/ --wait
chrome tabs new https://example.com/ --inactive --wait-until networkIdle --load-timeout 15000
```

### `tabs close`

Closes one or more managed-window tabs.

```bash
chrome tabs close <tabId> [tabId...] [global options]
```

Examples:

```bash
chrome tabs close 123
chrome tabs close 123 124 --json
```

### `tabs focus`

Activates a managed-window tab.

```bash
chrome tabs focus <tabId> [global options]
```

Example:

```bash
chrome tabs focus 123
```

### `tabs goto`

Navigates and activates a managed-window tab.

```bash
chrome tabs goto <tabId> <url> [wait options] [global options]
```

Examples:

```bash
chrome tabs goto 123 https://example.org/
chrome tabs goto 123 https://example.org/ --wait
chrome tabs goto 123 https://example.org/ --wait-until complete --load-timeout 15000
```

### `tabs refresh`

Reloads a tab.

```bash
chrome tabs refresh <tabId> [--bypass-cache] [wait options] [global options]
```

Options:

| Option | Description |
| --- | --- |
| `--bypass-cache` | Reload while bypassing browser cache. |

Examples:

```bash
chrome tabs refresh 123
chrome tabs refresh 123 --bypass-cache --wait
```

### `tabs back`

Navigates one entry back in a tab's history.

```bash
chrome tabs back <tabId> [wait options] [global options]
```

Examples:

```bash
chrome tabs back 123
chrome tabs back 123 --wait
```

### `tabs forward`

Navigates one entry forward in a tab's history.

```bash
chrome tabs forward <tabId> [wait options] [global options]
```

Examples:

```bash
chrome tabs forward 123
chrome tabs forward 123 --wait-until networkIdle --load-timeout 15000
```

### `tabs eval`

Evaluates JavaScript in a tab using the browser-control `tab.evaluate`
command.

```bash
chrome tabs eval <tabId> <expression> [--await-promise] [--no-return-by-value] [--eval-timeout <ms>] [file options] [global options]
chrome tabs eval <tabId> --file <script.js> [--await-promise] [--no-return-by-value] [--eval-timeout <ms>] [file options] [global options]
```


Options:

| Option | Description |
| --- | --- |
| `--await-promise` | Await a promise returned by the expression. |
| `--file` | Read the JavaScript expression from a file. |
| `--no-return-by-value` | Set `returnByValue: false`. Defaults to return-by-value. |
| `--eval-timeout` | Set the CDP evaluation timeout in milliseconds. |
| `--attach` | Add an attachment as `id:path`. Repeatable. |
| `--output` | Add an output target as `id:path`. Repeatable. |
| `--attachments` / `--attachments-file` | Pass full attachment metadata, including `name` and `mimeType`. |
| `--outputs` / `--outputs-file` | Pass full output metadata, including `mimeType`, `maxBytes`, and `overwrite`. |

## Request Attachments

Attachments let `tab.evaluate` work with files that exist inside the machine,
even though Chrome is running on the user's side. Attachment `path` values are
root-relative filesystem paths, using the same path model as the filesystem UI.

Limits: at most 10 files, at most 50 MiB per file, and at most 100 MiB total.
The server validates files before forwarding the browser-control request, then
serves request-scoped chunks over the existing browser-control websocket.

During `tab.evaluate`, the web client hydrates files into the page and exposes:

```ts
await window.__heysnapFiles.get(id);
await window.__heysnapFiles.getAll(ids);
await window.__heysnapFiles.setInputFiles(selectorOrElement, ids);
await window.__heysnapFiles.dropFiles(selectorOrElement, ids);
window.__heysnapFiles.clear(ids);
```

## Download Outputs

Outputs let `tab.evaluate` save bytes that page JavaScript can read back into
the machine filesystem. Output `path` values are root-relative filesystem paths,
using the same path model as the filesystem UI.

Limits: at most 10 files, and at most 100 MiB per file. `maxBytes` defaults to
100 MiB and cannot exceed 100 MiB. Existing files fail unless `overwrite: true`.
The server validates paths before forwarding the browser-control request, then
writes streamed chunks to a temp file and renames atomically after completion.

During `tab.evaluate`, the web client installs:

```ts
await window.__heysnapDownloads.save(id, source, options?);
window.__heysnapDownloads.clear(ids?);
```

`source` may be a `Response`, `Blob`, `File`, `ArrayBuffer`, typed array,
`DataView`, or string. This only works for bytes the page can read. Cross-origin
images, PDFs, or downloads without CORS may be visible in the browser but still
blocked from page JavaScript.

Example tab.eval downloads

```

await window.__heysnapDownloads.save('blob', await fetch(blobUrl));
await window.__heysnapDownloads.save('text', 'generated report text');
await window.__heysnapDownloads.save('pdf', await fetch('/invoice.pdf'))
await window.__heysnapDownloads.save('image', await fetch(document.querySelector('img').currentSrc))
```


Examples:

```bash
chrome tabs eval 123 'document.title'
chrome tabs eval 123 '({ href: location.href, title: document.title })' --await-promise
chrome tabs eval 123 --file ./scripts/read-page.js --await-promise --json
chrome tabs eval 123 "await window.__heysnapFiles.setInputFiles('input[type=file]', ['avatar'])" --attach avatar:assets/avatar.png
chrome tabs eval 123 "await window.__heysnapDownloads.save('text', 'hello')" --output text:downloads/text.txt --timeout 120000
```

### `tabs cdp`

Sends a raw Chrome DevTools Protocol command to a tab.

```bash
chrome tabs cdp <tabId> <method> [--params '{...}' | --params-file params.json] [global options]
```

Options:

| Option | Description |
| --- | --- |
| `--params` | JSON object for CDP command params. |
| `--params-file` | Read CDP command params from a JSON file. |

Examples:

```bash
chrome tabs cdp 123 Runtime.evaluate --params '{"expression":"document.title","returnByValue":true}'
chrome tabs cdp 123 Page.captureScreenshot --params '{"format":"png"}' --json
```

### `tabs screenshot`

Captures a screenshot from a tab and saves it inside the machine filesystem
root.

```bash
chrome tabs screenshot <tabId> <path> [screenshot options] [wait options] [global options]
```

Options:

| Option | Description |
| --- | --- |
| `--full-page` | Capture the full page. |
| `--clip` | Capture `x,y,width,height[,scale]`. Sets `captureMode: "clip"`. |
| `--capture-mode` | Set `viewport`, `fullPage`, or `clip`. |
| `--format` | Set `png`, `jpeg`, or `webp`. |
| `--png`, `--jpeg`, `--webp` | Format shortcuts. |
| `--quality` | JPEG/WebP quality from 1 to 100. |
| `--overwrite` | Replace an existing output file. |
| `--from-surface` | Set CDP `fromSurface`. |
| `--capture-beyond-viewport` | Set CDP `captureBeyondViewport`. |
| `--optimize-for-speed` | Set CDP `optimizeForSpeed`. |

Examples:

```bash
chrome tabs screenshot 123 screenshots/example.png
chrome tabs screenshot 123 screenshots/example-full.jpeg --full-page --jpeg --quality 85 --overwrite --wait
chrome tabs screenshot 123 screenshots/clip.webp --clip 0,0,600,400 --webp
```