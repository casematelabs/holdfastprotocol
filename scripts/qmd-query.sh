#!/bin/bash
# qmd-query.sh — Convenience wrapper for qmd memory recall.
# Usage: scripts/qmd-query.sh "your semantic query"
# Resolves paths from company root (assumes script runs from workspace root)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPANY_ROOT="C:/Users/controller/.paperclip/instances/default/companies/cc44a537-4622-4a79-9ef8-0a66c3b8b3e0"
QMD_DB="$COMPANY_ROOT/.qmd"
QMD_BIN="C:/Users/controller/AppData/Roaming/Python/Python314/Scripts/qmd.exe"

if [ ! -f "$QMD_BIN" ]; then
  echo "ERROR: qmd binary not found at $QMD_BIN" >&2
  exit 1
fi

"$QMD_BIN" --db-path "$QMD_DB" search --collection agent-memory --query "$*"
