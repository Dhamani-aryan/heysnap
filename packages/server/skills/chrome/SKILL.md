---
name: "chrome"
description: "Control the user's dedicated Chrome window through an agent-friendly CLI. Use this skill for browser tasks, authenticated websites, user-visible web workflows, or when the HeySnap UI context includes filepath \"chrome\". The browser runs on the user's device, so it can use the user's logged-in sessions, extensions, cookies, location/IP, and real browser state. If Chrome is not already open, browser commands can create the dedicated window automatically. Prefer this skill for most of web related tasks except for quick web searches (use web skill for that)."
---

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

The primary command namespace is `chrome tabs ...`.

Aliases are also supported:

| Primary | Alias |
| --- | --- |
| `chrome tabs list` | `chrome tabs` |
| `chrome tabs ...` | `chrome tab ...` |
| `chrome tabs new` | `chrome new-tab` |
| `chrome tabs close` | `chrome close-tab` |
| `chrome tabs focus` | `chrome focus-tab` |
| `chrome tabs goto` | `chrome goto` |
| `chrome tabs refresh` | `chrome refresh` |
| `chrome tabs back` | `chrome back` |
| `chrome tabs forward` | `chrome forward` |
| `chrome tabs eval` | `chrome eval` |
| `chrome tabs cdp` | `chrome cdp` |

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

Creates a tab in the managed browser window.

```bash
chrome tabs new [url] [--inactive] [wait options] [global options]
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
chrome tabs eval <tabId> <expression> [--await-promise] [--no-return-by-value] [--eval-timeout <ms>] [global options]
chrome tabs eval <tabId> --file <script.js> [--await-promise] [--no-return-by-value] [--eval-timeout <ms>] [global options]
```

Options:

| Option | Description |
| --- | --- |
| `--await-promise` | Await a promise returned by the expression. |
| `--file` | Read the JavaScript expression from a file. |
| `--no-return-by-value` | Set `returnByValue: false`. Defaults to return-by-value. |
| `--eval-timeout` | Set the CDP evaluation timeout in milliseconds. |

Examples:

```bash
chrome tabs eval 123 'document.title'
chrome tabs eval 123 '({ href: location.href, title: document.title })' --await-promise
chrome tabs eval 123 --file ./scripts/read-page.js --await-promise --json
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