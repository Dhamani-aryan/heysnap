# `web search`

Search the web via Firecrawl. Returns titles, URLs, and descriptions/snippets for one or more source types (`web`, `news`, `images`). This command does **not** scrape page content — for that, use the (forthcoming) `scrape` command on the URLs this returns.

## Synopsis

```
web search [query...] [flags]
```

- The query is the positional arguments joined with spaces.
- If no positional query is given **and stdin is piped**, the query is read
  from stdin (trimmed). Lets agents build queries dynamically without
  shell-escaping.

## Query operators

Pass these through verbatim in the query string — Firecrawl handles them:

| Operator | Effect | Example |
|---|---|---|
| `"..."` | Exact match | `"Firecrawl"` |
| `-term` | Exclude | `python -snake` |
| `site:` | Restrict to domain | `site:firecrawl.dev` |
| `-site:` | Exclude domain | `-site:reddit.com` |
| `filetype:` | File extension | `filetype:pdf` |
| `inurl:` / `allinurl:` | Word(s) in URL | `inurl:firecrawl` |
| `intitle:` / `allintitle:` | Word(s) in title | `intitle:firecrawl` |
| `related:` | Sites related to a domain | `related:firecrawl.dev` |
| `imagesize:WxH` | Exact image dimensions (with `-s images`) | `imagesize:1920x1080` |
| `larger:WxH` | Images at least this large | `larger:2560x1440` |

## Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `-n, --limit <N>` | int 1–100 | `10` | Max results. **Per source** when multiple sources.|
| `-s, --sources <list>` | csv | `web` | Any of `web`, `news`, `images` |
| `-c, --category <list>` | csv | — | Any of `github`, `research`, `pdf` |
| `--include-domain <d>` | repeatable | — | Restrict to hostname. Mutually exclusive with `--exclude-domain` |
| `--exclude-domain <d>` | repeatable | — | Exclude hostname |
| `-t, --time <range>` | enum | — | `hour`, `day`, `week`, `month`, `year` (sets `tbs=qdr:*`). Mutually exclusive with `--tbs`. Only affects `web` source |
| `--tbs <raw>` | string | — | Raw `tbs` (e.g. `cdr:1,cd_min:12/1/2024,cd_max:12/31/2024`) |
| `--sort-by-date` | bool | `false` | Appends `sbd:1` to whatever `tbs` resolves to (newest first) |
| `--location <str>` | string | — | e.g. `"San Francisco,California,United States"` |
| `--country <ISO>` | string | API default `US` | ISO country code |
| `--timeout <ms>` | int | `60000` | Request timeout |
| `--ignore-invalid-urls` | bool | `false` | Drop URLs that downstream Firecrawl endpoints would reject |
| `--json` | bool | auto | Force JSON output |
| `--pretty` | bool | auto | Force pretty output |
| `-q, --quiet` | bool | — | URLs only, one per line |
| `-h, --help` | bool | — | Print usage |

### Mutual exclusion rules

- `--include-domain` ⊕ `--exclude-domain`
- `--time` ⊕ `--tbs`

Violating either errors out with exit code `1` before any API call.

## Output

- **TTY** (interactive terminal) → pretty, numbered blocks grouped by source:
  ```
  # web (3)
  1. Title [category] (date if present)
     https://url
     Snippet/description
  ```
- **Pipe** (non-TTY stdout) → JSON, matching the Firecrawl `SearchData` shape:
  ```json
  { "web": [...], "news": [...], "images": [...] }
  ```
  Only the requested sources appear.
- `--json` / `--pretty` override the auto-detect.
- `-q, --quiet` always wins → just URLs, one per line. Perfect for chaining.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Success (including zero results) |
| `1` | Usage / validation error |
| `2` | API or network error |

## Examples

### Basic

```bash
web search "claude opus 4.7"
```

### Get JSON for an agent / script

```bash
web search "claude opus 4.7" --json
# auto-JSON kicks in here too:
web search "claude opus 4.7" | jq '.web[].url'
```

### News from the past week, newest first

```bash
web search "anthropic" -s news -t week --sort-by-date
```

### Mixed sources (limit applies per source)

```bash
web search "openai" -s web,news -n 5
# returns up to 5 web results AND up to 5 news results
```

### Filter by category

```bash
web search "web scraping" -c github,research -n 20
```

### Restrict to specific domains

```bash
web search "scraping guide" \
  --include-domain firecrawl.dev \
  --include-domain docs.firecrawl.dev
```

### Exclude domains

```bash
web search "python tutorial" \
  --exclude-domain reddit.com \
  --exclude-domain quora.com
```

### Geo-targeted search

```bash
web search "best restaurants" \
  --location "Berlin,Germany" \
  --country DE
```

### Image search at a specific size

```bash
web search "sunset imagesize:1920x1080" -s images -n 10
```

### Custom date range (raw `tbs`)

```bash
web search "firecrawl updates" \
  --tbs "cdr:1,cd_min:12/1/2024,cd_max:12/31/2024" \
  --sort-by-date
```

### Chain into another command

```bash
# Get 10 URLs for "rust async runtimes" and (eventually) scrape them all
web search "rust async runtimes" -n 10 -q | xargs -I{} web scrape {}
```

### Build a query dynamically via stdin

```bash
printf '%s' "$(cat ./query.txt)" | web search -n 5 --json
```

## Notes & gotchas

- `--time` / `--tbs` filters are applied **only to the `web` source** by
  Firecrawl. For time-bound news, query the web source with a `site:` operator
  (e.g. `site:techcrunch.com anthropic -t week`).
- `--limit` is **per source** when multiple sources are requested.
- Domain values must be **hostnames only** — no protocol, no path. `firecrawl.dev`
  is correct; `https://firecrawl.dev/` is not.
- **Image results have two URLs**, and the distinction matters:
  - `url` — the **source page** that hosts the image (e.g. `firecrawl.dev/brand`)
  - `imageUrl` — the **asset itself** (e.g. `firecrawl.dev/brand/logo.png`)

  `-q` emits `url` (falling back to `imageUrl` only if `url` is missing),
  which is what you want for piping into `scrape`. Image results also
  inline `imageWidth`, `imageHeight`, and `title` — no second call needed
  for that metadata.


  To **download the image bytes**: fetch `imageUrl` directly — `scrape`
  rejects binary content types (`image/*`, `video/*`). From EC2 or other
  datacenter IPs this works for most public CDNs but gets `403`'d by stock
  photo sites, social CDNs, and Cloudflare Bot Management on some
  publishers. Send realistic headers to recover most failures:
  ```bash
  curl -sO -H "User-Agent: Mozilla/5.0" -H "Referer: $page_url" "$image_url"
  ```
  See [`scrape.md`](./scrape.md#notes--gotchas) for the full caveat.

## See also

- [`cli.md`](./cli.md) — top-level CLI overview
