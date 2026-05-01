#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

fail() {
  echo "quickstart-drift: $1" >&2
  exit 1
}

search_contains() {
  local pattern="$1"
  local file="$2"
  if command -v rg >/dev/null 2>&1; then
    rg -n --fixed-strings "$pattern" "$file" >/dev/null
  else
    grep -nF "$pattern" "$file" >/dev/null
  fi
}

require_contains() {
  local file="$1"
  local pattern="$2"
  local label="$3"
  if ! search_contains "$pattern" "$file"; then
    fail "$label missing in $file: $pattern"
  fi
}

require_not_contains() {
  local file="$1"
  local pattern="$2"
  local label="$3"
  if search_contains "$pattern" "$file"; then
    fail "$label unexpected in $file: $pattern"
  fi
}

require_contains "docs/dev/quickstart.md" "@holdfastprotocol/sdk@devnet" "devnet install tag"
require_contains "holdfast/docs/quickstart.md" "@holdfastprotocol/sdk@devnet" "devnet install tag"
require_contains "holdfast/sdk/README.md" "@holdfastprotocol/sdk@devnet" "devnet install tag"
require_contains "app/docs/quickstart/page.tsx" "@holdfastprotocol/sdk@devnet" "devnet install tag"
require_contains "examples/holdfast-quickstart/README.md" "under 15 minutes" "quickstart duration claim"
require_contains "holdfast/sdk/README.md" "examples/quickstart.ts" "sdk quickstart script link"
require_contains "docs/dev/quickstart.md" "holdfast/docs/quickstart.md" "canonical quickstart link"
require_contains "docs/dev/quickstart.md" "holdfast/sdk/examples/quickstart.ts" "canonical quickstart script link"

require_not_contains "app/docs/quickstart/page.tsx" "under 5 minutes" "stale duration claim"
require_not_contains "examples/holdfast-quickstart/README.md" "under 5 minutes" "stale duration claim"

require_contains "holdfast/docs/quickstart.md" "required for auto-release" "timed keeper requirement"
require_contains "app/docs/quickstart/page.tsx" "Timed pacts require a keeper for auto-release" "timed keeper warning"
require_contains "examples/holdfast-quickstart/README.md" "run the reference keeper" "timed keeper guidance"

echo "quickstart-drift: OK"
