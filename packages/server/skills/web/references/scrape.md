# `web scrape`

Fetch a single URL and convert it to markdown, HTML, links, images, or a screenshot URL. Built for agents: large content is auto-saved to a temp file and only a preview is printed inline, so a 100k-token page won't blow up your context window.

## Synopsis

```
web scrape <url> [flags]
```

- Exactly one URL, passed positionally. No stdin fallback (URLs are short
  enough to pass as args, and reading stdin would conflict with `-q` piping).
- The URL is validated locally before any API call.

## Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--format <list>` | csv | `markdown` | Any of `markdown`, `html`, `rawHtml`, `links`, `images`, `screenshot` |
| `--wait <ms>` | int ≥0 | — | Delay before grabbing content (for JS-heavy pages). On top of Firecrawl's smart wait |
| `--timeout <ms>` | int | `60000` | Request timeout (max `300000`) |
| `--include-tags <list>` | csv | — | CSS selectors to keep |
| `--exclude-tags <list>` | csv | — | CSS selectors to drop |
| `--no-main-content` | bool | main-content is on | Disable the default header/nav/footer filter |
| `--full-page` | bool | `false` | Capture full-page screenshot (requires `screenshot` in `--format`) |
| `--country <ISO>` | string | API default `US` | ISO 3166-1 alpha-2 country code |
| `--lang <list>` | csv | — | Preferred languages, in order of priority (e.g. `en,en-US`) |
| `--max-chars <N>` | int ≥0 | `8000` | Preview cap for text formats |
| `--full` | bool | `false` | Print full content inline; skip the auto-save to disk |
| `--out <path>` | string | tmp | Save full content here. Treated as a **basename**; the extension is auto-added per format |
| `--json` | bool | auto | Force JSON envelope output |
| `--pretty` | bool | auto | Force pretty (human) output |
| `-q, --quiet` | bool | — | Raw content of the first requested format to stdout. No envelope, no truncation |
| `-h, --help` | bool | — | Print usage |

## Formats

All formats are **1 credit total per call** (the page is only scraped once).
LLM-billed formats (`question`, `extract`, `summary`, `highlights`, `branding`,
`audio`, `video`) are intentionally **not exposed** by this command.

| Format | Returns | Notes |
|---|---|---|
| `markdown` | Clean markdown of the page's main content | Default. Best for agent reading |
| `html` | Cleaned HTML (no `<script>`, `<style>`, etc.) | Respects `--include-tags`/`--exclude-tags`/`--no-main-content` |
| `rawHtml` | Exact unmodified HTML as received | No cleaning or filtering |
| `links` | Array of all link URLs on the page | Inline up to 200; rest goes to disk |
| `images` | Array of image URLs on the page | Inline up to 200; rest goes to disk |
| `screenshot` | A signed URL to a PNG | URL **expires in 24h**. Use `--full-page` for full-page capture |

## Output

The envelope is consistent regardless of which/how many formats you ask for:

```json
{
  "url": "https://example.com",
  "final_url": "https://example.com/",
  "title": "Example Domain",
  "status": 200,
  "content_type": "text/html",
  "credits_used": 1,
  "formats": {
    "markdown": {
      "chars": 47213,
      "truncated": true,
      "preview": "<first 8000 chars>",
      "saved_to": "/tmp/heysnap-scrape/example.com-ab12cd34ef.md"
    },
    "links": {
      "count": 12,
      "items": ["https://...", "..."],
      "truncated": false
    },
    "screenshot": {
      "url": "https://storage.googleapis.com/...signed...",
      "expires_in": "24h"
    }
  }
}
```

- `final_url` reflects redirects (may differ from the requested `url`).
- Each format object **always carries the same shape per type**, so agents can
  destructure predictably: `env.formats.markdown.preview`,
  `env.formats.links.items`, `env.formats.screenshot.url`.

### Anti-context-pollution behavior

This is the whole point. By default:

- **Small content** (≤ `--max-chars`) → full content goes in `preview`,
  nothing is written to disk.
- **Large content** (> `--max-chars`) → full content is written to
  `$TMPDIR/heysnap-scrape/<host>-<hash>.<ext>`, `preview` holds the first
  `--max-chars`, and `saved_to` points at the file. Agents can `Read` the file
  on demand without spending another credit.
- **`--full`** forces full content inline. No file is written **unless**
  `--out` is also passed.
- **`--out <path>`** always saves, regardless of size. Treated as a basename
  with the extension auto-added per format (`./page` → `./page.md`,
  `./page.html`, `./page.links.json`). Same `--out` works for multi-format
  requests — each format gets its own file.
- **Arrays** (`links`, `images`) inline up to 200 items; if the page has more,
  the inline `items` is truncated and the full list is JSON-saved to disk.

### Default save location

```
$TMPDIR/heysnap-scrape/<hostname>-<short-sha1(url)>.<ext>
```

Re-scraping the same URL overwrites the same file. Extensions per format:

| Format | Extension |
|---|---|
| `markdown` | `.md` |
| `html` | `.html` |
| `rawHtml` | `.raw.html` |
| `links` | `.links.json` |
| `images` | `.images.json` |
| `screenshot` | `.screenshot.txt` (contains the URL; only written when `--out` is passed) |

### Output mode resolution

| Context | Default | Override |
|---|---|---|
| TTY (interactive) | pretty | `--json`, `-q` |
| Pipe (non-TTY) | JSON envelope | `--pretty`, `-q` |

- **`-q, --quiet`** outputs the raw content of the **first** format in
  `--format`. No envelope, no truncation — if the content was truncated for
  the envelope, quiet mode re-reads the saved file to give you the complete
  output. Use it for `web scrape <url> -q > page.md`.
- For `links`/`images`, `-q` prints one item per line.
- For `screenshot`, `-q` prints the signed URL only.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Usage / validation error |
| `2` | API or network error |

## Examples

### Basic — read a page

```bash
web scrape https://firecrawl.dev
```

### Save the markdown straight to a file

```bash
web scrape https://firecrawl.dev -q > page.md
```

### Get only the links (URL discovery, low tokens)

```bash
web scrape https://firecrawl.dev --format links --json | jq '.formats.links.items[]'
```

### Multiple formats in one call (still 1 credit)

```bash
web scrape https://example.com --format markdown,html,links
```

### Render-heavy SPA — wait for JS, then capture

```bash
web scrape https://app.example.com \
  --wait 2000 \
  --format markdown,screenshot --full-page
```

### Surgical extraction with CSS selectors

```bash
web scrape https://news.site/article \
  --include-tags "article,h1,h2" \
  --exclude-tags ".ads,.related"
```

### Save everything to a known location

```bash
web scrape https://example.com \
  --format markdown,html,links \
  --out ./snapshots/example
# writes ./snapshots/example.md, ./snapshots/example.html, ./snapshots/example.links.json
```

### Geo-targeted scrape

```bash
web scrape https://example.de --country DE --lang de,en
```

### Inline the whole page (for short pages only — don't do this with big ones)

```bash
web scrape https://example.com --full --json
```

### Chain after `search`

```bash
# Scrape the top 5 results for a query
web search "rust async runtimes" -n 5 -q \
  | xargs -I{} web scrape {} --format markdown
```

### Bigger preview window when you actually want more context

```bash
web scrape https://blog.example.com/post --max-chars 20000
```

## Notes & gotchas

- **Binary URLs aren't scrapable.** 
  To get the **page** an image lives on, scrape its `url` field from a
  `search -s images` result (not `imageUrl`). To get the **image bytes**,
  fetch `imageUrl` directly — but note the EC2/datacenter caveat:

  Most public CDNs (CloudFront, Cloudflare, Google CDN, S3, GitHub raw, Wikimedia, most brand assets) serve fine from AWS IPs. Some hosts — stock photo sites, social CDNs (Instagram/X), Cloudflare-protected publishers, anything with hotlink protection — return `403` to datacenter IP ranges. Send realistic headers to recover most of these:
  ```bash
  curl -sO \
    -H "User-Agent: Mozilla/5.0" \
    -H "Referer: $SOURCE_PAGE_URL" \
    "$IMAGE_URL"
  ```
  If the asset CDN still blocks you, `scrape` cannot help — it can't download binary bytes through Firecrawl's proxies. You'd need a residential proxy service. For agent workflows, treat occasional image fetch failures as expected and move on rather than building proxy fallbacks.
- `--no-main-content` is rarely what you want — it brings back nav/footer
  noise. Use `--include-tags`/`--exclude-tags` for finer control.
- `rawHtml` is huge on most modern sites. Prefer `html` (cleaned) or
  `markdown` unless you specifically need the original DOM.
- The default save dir (`$TMPDIR/heysnap-scrape/`) is **not auto-cleaned**.
  Your OS will eventually clear it; if you scrape a lot, `rm -rf` it
  occasionally.
- Same URL re-scraped → same `saved_to` path (overwrites). Useful for cache-like
  flows. If you need distinct snapshots, pass `--out`.
- Multiple formats in one call still — there's no
  reason to scrape twice if you might want both markdown and links.

