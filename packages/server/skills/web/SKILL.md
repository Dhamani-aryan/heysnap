---
name: "web"
description: "A small, agent-friendly CLI for quick web searches and research. Use this to quickly get search information and results. Exposes - search, scrape and research commands. Use when need to find something, get content of a url or research deeply something on the internet quickly. For any other web tasks use the chrome skill."
---

# Web Skill

An easy to use cli to get data from the web. Use when need to find something, get content of a url or research something on the internet quickly. Auth Configured automatically.

# web CLI

## Conventions (apply to every command)

- **Data goes to stdout, diagnostics to stderr** — pipes stay clean.
- **Output auto-switches by context**: TTY → pretty, pipe → JSON. Override with
  `--json`, `--pretty`, or `-q/--quiet`. Quiet mode is pipe-friendly raw output
  — the exact shape depends on the command (e.g. `search -q` prints URLs one
  per line; `scrape -q` prints the page content).
- **Exit codes**: `0` ok · `1` usage/validation error · `2` API/network error.
  `research` adds `3` for "loop ended without producing a report" (hit
  `--max-iterations` or the agent gave up without calling `write_report`).
- **`--help` / `-h`** on any command prints its full reference.
- **`--`** ends flag parsing; everything after is positional (useful for
  queries that start with `-`).

## Commands

### `search` — web search

Search the web and get titles, URLs, and snippets back. Supports Google-style
operators (`site:`, `"..."`, `-term`, `filetype:`, `inurl:`, `intitle:`,
`related:`, `imagesize:`, `larger:`) verbatim in the query.

```bash
# Quick search, pretty output
web search "claude opus 4.7"

# Pipe straight into another tool — auto-JSON
web search "site:arxiv.org transformers" -n 20 | jq '.web[].url'
```

Full reference: [`references/search.md`](./references/search.md)

### `scrape` — fetch a single URL as markdown / HTML / links / screenshot

Pull one URL and get back clean content. Large pages are auto-saved to a temp file and only a preview is printed inline, so a 100k-token page won't pollute an agent's context window — agents can read the `saved_to` path on demand.

```bash
# Quick read, pretty output
web scrape https://firecrawl.dev

# Save the markdown straight to a file
web scrape https://firecrawl.dev -q > page.md

# Pipe after search: top 5 results → scrape each one
web search "rust async runtimes" -n 5 -q \
  | xargs -I{} web scrape {} --format markdown

# Multiple formats in one call (still 1 credit)
web scrape https://example.com --format markdown,links,screenshot --full-page
```

Full reference: [`references/scrape.md`](./references/scrape.md)

### `research` — agentic deep-dive on a topic

Spin up an LLM agent that searches, scrapes, and synthesizes a multi-section markdown report on a topic. Output is saved to a file (default under `/tmp/web-research/`); the path is the only thing written to stdout. Use when need to go research 10-30 pages get info. Research can take anywhere from couple to minutes to upto 10 minutes.

```bash
# Default run — ~5–15 sources, report written under /tmp/web-research/
web research "current state of small LLMs in 2026"

# Quick scoping run with a tight iteration cap
web research "What is llms.txt?" -i 5

# Pipe-friendly: stdout is just the path
report=$(web research "MCP adoption" -q)
glow "$report"

# Long topic via stdin, custom output path
cat prompt.txt | web research -o ./report.md
```

Live progress streams to stderr as the agent works:

```
→ iteration 2 (context: 5058 tokens)
  scrape: https://www.anthropic.com/news/model-context-protocol
          ↳ Extract what MCP is, when it was introduced...
    ✓ relevance=high, 32 findings
```

Full reference: [`references/research.md`](./references/research.md)
