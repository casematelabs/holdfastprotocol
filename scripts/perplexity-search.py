#!/usr/bin/env python3
"""Perplexity AI Search CLI wrapper.

Calls the Perplexity REST API (sonar-pro model by default) and returns results
with numbered citations.  Requires no third-party packages — only Python stdlib.

Usage:
    PERPLEXITY_API_KEY=pplx-xxx ./scripts/perplexity-search.py --query "your question"
    PERPLEXITY_API_KEY=pplx-xxx python3 scripts/perplexity-search.py \\
        --query "latest Solana audit findings" \\
        --domain arxiv.org --recency week --format json

Environment:
    PERPLEXITY_API_KEY   Required.  Your Perplexity API key.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from typing import Any

PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions"
DEFAULT_MODEL = "sonar-pro"

_SYSTEM_PROMPT = (
    "Be precise and concise. "
    "Cite sources inline using numbered references [1], [2], etc. "
    "at the end of relevant sentences. List all citations at the end."
)

# (pattern, human-readable label) — checked against the query before sending
_SENSITIVE_PATTERNS: list[tuple[str, str]] = [
    (r"\$[A-Za-z_][A-Za-z0-9_]+|\$\{[A-Za-z_]", "environment variable reference"),
    (r"(?:/etc/|/root/|~/\.ssh/|~/\.aws/|\.env\b)", "sensitive file path"),
    (
        r"(?:sk-[A-Za-z0-9]{20,}|bearer\s[A-Za-z0-9._-]{10,}|api[_-]?key\s*[=:]\s*\S{8,})",
        "API key or token",
    ),
]


def check_query_security(query: str) -> None:
    for pattern, label in _SENSITIVE_PATTERNS:
        if re.search(pattern, query, re.IGNORECASE):
            print(
                f"WARNING: query may contain a {label} — verify no secrets are embedded",
                file=sys.stderr,
            )


def build_payload(
    query: str,
    model: str,
    domain: str | None,
    recency: str | None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": query},
        ],
    }
    if domain:
        payload["search_domain_filter"] = [domain]
    if recency:
        payload["search_recency_filter"] = recency
    return payload


def call_api(api_key: str, payload: dict[str, Any]) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        PERPLEXITY_API_URL,
        data=data,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))  # type: ignore[no-any-return]
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        if exc.code == 401:
            print(
                "Error: authentication failed — verify PERPLEXITY_API_KEY is correct.",
                file=sys.stderr,
            )
        elif exc.code == 429:
            print(
                "Error: rate limit exceeded — wait a moment and retry.",
                file=sys.stderr,
            )
        elif exc.code == 400:
            print(f"Error: bad request — {body}", file=sys.stderr)
        else:
            print(f"Error: HTTP {exc.code} from Perplexity API — {body}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as exc:
        print(f"Error: could not reach Perplexity API — {exc.reason}", file=sys.stderr)
        sys.exit(1)
    except TimeoutError:
        print("Error: request timed out after 60 s.", file=sys.stderr)
        sys.exit(1)


def format_output(data: dict[str, Any], fmt: str) -> None:
    if "error" in data:
        err = data["error"]
        msg = err.get("message", str(err)) if isinstance(err, dict) else str(err)
        print(f"API Error: {msg}", file=sys.stderr)
        sys.exit(1)

    choices: list[dict[str, Any]] = data.get("choices", [])
    if not choices:
        print("Error: no content in API response.", file=sys.stderr)
        sys.exit(1)

    content: str = choices[0].get("message", {}).get("content", "")
    citations: list[str] = data.get("citations", [])

    if fmt == "json":
        result: dict[str, Any] = {
            "content": content,
            "citations": citations,
            "model": data.get("model", ""),
            "usage": data.get("usage", {}),
        }
        print(json.dumps(result, indent=2))
    else:
        print(content)
        if citations:
            print()
            print("### Sources")
            for i, url in enumerate(citations, 1):
                print(f"{i}. {url}")


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="perplexity-search",
        description="Search via Perplexity AI and return results with citations.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  PERPLEXITY_API_KEY=pplx-xxx ./scripts/perplexity-search.py \\\n"
            '      --query "latest Solana audit findings"\n'
            "  PERPLEXITY_API_KEY=pplx-xxx ./scripts/perplexity-search.py \\\n"
            '      --query "latest Solana audit findings" \\\n'
            "      --domain arxiv.org --recency week --format json\n"
        ),
    )
    parser.add_argument("--query", required=True, help="The search query (required)")
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help=f"Perplexity model to use (default: {DEFAULT_MODEL})",
    )
    parser.add_argument(
        "--domain",
        default=None,
        help="Restrict search to a specific domain, e.g. arxiv.org",
    )
    parser.add_argument(
        "--recency",
        default=None,
        choices=["day", "week", "month", "year"],
        help="Recency filter for search results",
    )
    parser.add_argument(
        "--format",
        default="markdown",
        choices=["json", "markdown"],
        dest="fmt",
        help="Output format (default: markdown)",
    )
    args = parser.parse_args()

    api_key = os.environ.get("PERPLEXITY_API_KEY", "")
    if not api_key:
        print(
            "Error: PERPLEXITY_API_KEY environment variable is not set.",
            file=sys.stderr,
        )
        sys.exit(1)

    check_query_security(args.query)

    payload = build_payload(args.query, args.model, args.domain, args.recency)
    response = call_api(api_key, payload)
    format_output(response, args.fmt)


if __name__ == "__main__":
    main()
