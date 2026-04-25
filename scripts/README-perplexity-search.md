# perplexity-search

CLI wrapper for the [Perplexity AI REST API](https://docs.perplexity.ai/api-reference/chat-completions).
Used by the Holdfast Research Agent to run web searches with citations.

## Files

| File | Purpose |
|------|---------|
| `perplexity-search.sh` | Entry-point shell wrapper (delegates to the Python script) |
| `perplexity-search.py` | Full implementation — no third-party dependencies |

## Requirements

- `python3` on PATH (3.8+)
- `PERPLEXITY_API_KEY` environment variable set to a valid Perplexity API key

## Usage

```bash
PERPLEXITY_API_KEY=pplx-xxx ./scripts/perplexity-search.sh \
    --query "latest Solana audit findings"
```

```bash
PERPLEXITY_API_KEY=pplx-xxx ./scripts/perplexity-search.sh \
    --query "latest Solana audit findings" \
    --domain arxiv.org \
    --recency week \
    --format json
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--query` | **required** | The search query |
| `--model` | `sonar-pro` | Perplexity model to use |
| `--domain` | _(none)_ | Restrict search to a single domain, e.g. `arxiv.org` |
| `--recency` | _(none)_ | Filter by recency: `day`, `week`, `month`, `year` |
| `--format` | `markdown` | Output format: `markdown` or `json` |

## Output formats

### `markdown` (default)

Prints the model's answer followed by a numbered **Sources** section:

```
The latest Solana audit findings from Trail of Bits cover…  [1][2]

### Sources
1. https://github.com/trailofbits/…
2. https://blog.ottersec.io/…
```

### `json`

Returns a JSON object suitable for programmatic consumption:

```json
{
  "content": "The latest Solana audit findings…",
  "citations": ["https://...", "https://..."],
  "model": "sonar-pro",
  "usage": { "prompt_tokens": 12, "completion_tokens": 340, "total_tokens": 352 }
}
```

## Security

The script inspects each query before sending it and emits a **WARNING** to
stderr if the query appears to contain:

- Environment variable references (e.g. `$API_KEY`, `${SECRET}`)
- Sensitive file paths (e.g. `/etc/passwd`, `~/.ssh/id_rsa`, `.env`)
- API keys or bearer tokens

The request is still sent; the warning is advisory.

## Error handling

| Condition | Exit code | Message |
|-----------|-----------|---------|
| Missing `PERPLEXITY_API_KEY` | 1 | "PERPLEXITY_API_KEY environment variable is not set." |
| Missing `--query` | 2 | argparse usage error |
| HTTP 401 Unauthorized | 1 | "authentication failed — verify PERPLEXITY_API_KEY" |
| HTTP 429 Rate Limited | 1 | "rate limit exceeded — wait a moment and retry" |
| Network timeout (>60 s) | 1 | "request timed out after 60 s" |
| Server error (5xx) | 1 | "HTTP <code> from Perplexity API" |

## Linting

```bash
# Python (pyright)
npx pyright scripts/perplexity-search.py

# Bash (shellcheck)
shellcheck scripts/perplexity-search.sh
```
