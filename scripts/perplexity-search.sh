#!/usr/bin/env bash
# Holdfast Protocol — Perplexity AI Search CLI
#
# Thin wrapper that delegates to perplexity-search.py in the same directory.
# Requires python3 to be on PATH.
#
# Usage:
#   PERPLEXITY_API_KEY=pplx-xxx ./scripts/perplexity-search.sh --query "your question"
#   PERPLEXITY_API_KEY=pplx-xxx ./scripts/perplexity-search.sh \
#       --query "latest Solana audit findings" \
#       --domain arxiv.org --recency week --format json
#
# Options:
#   --query     REQUIRED  The search query
#   --model               Perplexity model (default: sonar-pro)
#   --domain              Restrict search to this domain (e.g. arxiv.org)
#   --recency             Recency filter: day, week, month, year
#   --format              Output format: json or markdown (default: markdown)
#   -h, --help            Show help
#
# Environment:
#   PERPLEXITY_API_KEY    Required.  Your Perplexity API key.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$SCRIPT_DIR/perplexity-search.py" "$@"
