# `web research`

Run an **agentic research loop** on a topic. The agent searches the web, scrapes promising sources, and produces a structured, well-cited markdown report saved to disk. Unlike `search` and `scrape`, this command is itself an LLM agent — it decides what to look up next based on what it finds.

## Synopsis

```
web research [topic...] [flags]
```

- The topic is the positional arguments joined with spaces.
- If no positional topic is given **and stdin is piped**, the topic is read
  from stdin (trimmed). Useful for long multi-paragraph prompts.

## Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `-i, --max-iterations <N>` | int > 0 | `30` | Max agent turns. Each turn is one Responses API call plus any tool calls it issues. |
| `--token-budget <N>` | int > 0 | `350000` | Soft cap on the agent's input-token count. When exceeded, the next turn forces `write_report`. |
| `--agent-model <id>` | string | `gpt-5.4-mini` | Main loop model. On Azure, this is a deployment name. |
| `--extractor-model <id>` | string | `gpt-5.4-nano` | Per-scrape summarizer. On Azure, this is a deployment name. |
| `-o, --out <path>` | path | `/tmp/web-research/<slug>-<ts>.md` | Where to write the markdown report. Parent dirs are created. |
| `-q, --quiet` | bool | — | Suppress live progress on stderr |
| `-h, --help` | bool | — | Print usage |

### Output paths

When `--out` is omitted:

```
/tmp/web-research/<slug>-<YYYY-MM-DD_HH-MM-SS>.md
```

- `<slug>` is the topic, lowercased, non-alphanumerics collapsed to `-`,
  capped at 60 characters. Empty/garbage topics fall back to `research`.
- Timestamp is UTC.

## Output

- **stdout**: the absolute path of the saved report (one line). Pipe-friendly.
- **stderr** (unless `-q`): live progress as the agent runs:

  ```
  Researching: <topic>
  Output:      /tmp/web-research/...

  → iteration 1 (context: 733 tokens)
    search: "Anthropic Model Context Protocol MCP documentation"
      ✓ 20 results
    search: "MCP adoption status partners"
      ✓ 20 results

  → iteration 2 (context: 5058 tokens)
    scrape: https://www.anthropic.com/news/model-context-protocol
            ↳ Extract what MCP is, when it was introduced, the problem it solves...
      ✓ relevance=high, 32 findings
    scrape: https://github.com/modelcontextprotocol
            ↳ Extract indicators of ecosystem activity...
      ✓ relevance=high, 18 findings

  → iteration 3 (context: 12822 tokens)
    ...

  → iteration 5 (context: 23634 tokens)
    write_report...
      ✓ ok

  ■ stopped: report
  ```

  Per-tool result lines show what mattered:
  - `search` → number of results
  - `scrape` → `relevance=<high|medium|low|none>, N findings`
  - any tool → `✗ error: ...` if it failed; the agent then continues with
    the error fed back as the tool output.

### Report shape

The written markdown follows this structure:

```markdown
# <title>

> Research topic: <original topic>
> Generated: <ISO timestamp>

## Overview
<2–4 paragraphs, executive summary>

## <Section heading>
<prose with inline [https://url] citations>

**Sources:**
- https://...
- https://...

... more sections ...

## Key URLs
1. [Title](https://url)
   Why this source matters in one sentence.
2. ...

## Open Questions
- <unresolved aspect>
- ...
```

`Key URLs` and `Open Questions` sections are omitted when the agent produces
none.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Report produced and written |
| `1` | Usage / validation error / missing API key |
| `2` | API, network, or file-write error |
| `3` | No report produced (loop hit `--max-iterations` or agent gave up without a tool call) |

## Examples

### Basic

```bash
web research "current state of small LLMs in 2026"
# stdout: /tmp/web-research/current-state-of-small-llms-in-2026-2026-05-13_17-41-24.md
```

### Pipe the output path into another tool

```bash
report=$(web research "Anthropic MCP adoption" -q)
glow "$report"          # render in the terminal
cat "$report" | pbcopy  # copy to clipboard
```

### Long, multi-paragraph topic via stdin

```bash
cat <<'EOF' | web research -o ./report.md
Compare the production-readiness of the Model Context Protocol vs OpenAI's
function-calling tool spec. Cover: governance, ecosystem breadth, SDK
coverage, and notable enterprise adopters.
EOF
```

### Tight loop, small budget — quick scoping run

```bash
web research "What is llms.txt?" -i 5 --token-budget 50000
```

### Custom models (Azure deployment names)

```bash
web research "post-training methods 2026" \
  --agent-model my-mini-deployment \
  --extractor-model my-nano-deployment
```

### Quiet mode for scripts

```bash
report=$(web research "claude code release notes" -q)
test -s "$report" && echo "wrote $(wc -l <"$report") lines to $report"
```
