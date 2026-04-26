#!/usr/bin/env bash
# Holdfast Protocol — Devnet Program Health Check
#
# Verifies both Holdfast Protocol programs are deployed and executable on Solana devnet.
# Optionally compares deployed binary hashes against known-good baselines.
# Posts an alert comment to the configured Paperclip issue on any failure.
#
# Usage:
#   ./scripts/devnet-health-check.sh
#
# Environment variables:
#   SOLANA_RPC_URL          Solana RPC endpoint (default: https://api.devnet.solana.com)
#   EXPECTED_HOLDFAST_HASH  SHA-256 of dumped Holdfast ELF — set after first verified deploy
#   EXPECTED_ESCROW_HASH    SHA-256 of dumped Escrow ELF — set after first verified deploy
#   PAPERCLIP_API_URL       Paperclip API base URL (required for alerting)
#   PAPERCLIP_API_KEY       Paperclip JWT (required for alerting)
#   PAPERCLIP_TASK_ID       Issue ID to receive alerts (default: CAS-373)
#   GITHUB_RUN_ID           Injected by GitHub Actions for run links
#   GITHUB_REPOSITORY       Injected by GitHub Actions for run links

set -euo pipefail

RPC="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"
HOLDFAST_PROGRAM="D6mUa4wGtFyLyJorMfxoKvA9ybohjUSsfw88t66ATxg"
ESCROW_PROGRAM="BNxA76z6vjQYtUJXGpH8qjA3wHvtAAqGqL6rvVWH6b3H"
ALERT_ISSUE="${PAPERCLIP_TASK_ID:-HOL-20}"

FAIL=0
ALERT_LINES=""

ts() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }

add_alert() { ALERT_LINES="${ALERT_LINES}"$'\n'"- $1"; }

rpc_get_account() {
  curl -s --max-time 20 -X POST "$RPC" \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getAccountInfo\",\"params\":[\"$1\",{\"encoding\":\"base64\"}]}"
}

check_program() {
  local label="$1" program_id="$2" expected_hash="${3:-}"

  echo ""
  echo "  Checking $label ($program_id)..."

  local resp
  if ! resp=$(rpc_get_account "$program_id" 2>&1); then
    echo "    ❌ curl failed: $resp"
    add_alert "❌ **$label**: curl to devnet RPC failed"
    FAIL=1
    return
  fi

  # Check for JSON-RPC error
  if echo "$resp" | jq -e '.error' > /dev/null 2>&1; then
    local err
    err=$(echo "$resp" | jq -r '.error.message // "unknown RPC error"')
    echo "    ❌ RPC error: $err"
    add_alert "❌ **$label** ($program_id): RPC error — \`$err\`"
    FAIL=1
    return
  fi

  local value
  value=$(echo "$resp" | jq -r '.result.value // "null"')

  if [ "$value" = "null" ]; then
    echo "    ❌ Account not found — program may be undeployed"
    add_alert "❌ **$label** ($program_id): account not found on devnet — program may be undeployed"
    FAIL=1
    return
  fi

  local executable lamports
  executable=$(echo "$resp" | jq -r '.result.value.executable')
  lamports=$(echo "$resp" | jq -r '.result.value.lamports')

  if [ "$executable" != "true" ]; then
    echo "    ❌ Account exists but is NOT executable (lamports=$lamports)"
    add_alert "❌ **$label** ($program_id): account exists but not executable"
    FAIL=1
    return
  fi

  echo "    ✅ Deployed and executable (lamports=$lamports)"

  # Binary hash check via solana CLI (skipped if CLI not installed)
  if command -v solana > /dev/null 2>&1; then
    local dump_path
    dump_path="/tmp/holdfast-health-${program_id:0:8}.so"

    if solana program dump --url "$RPC" "$program_id" "$dump_path" > /dev/null 2>&1; then
      local actual_hash
      actual_hash=$(sha256sum "$dump_path" | awk '{print $1}')
      rm -f "$dump_path"

      if [ -n "$expected_hash" ]; then
        if [ "$actual_hash" = "$expected_hash" ]; then
          echo "    ✅ Binary hash matches expected (${actual_hash:0:16}…)"
        else
          echo "    ⚠️  Binary hash CHANGED"
          echo "       expected: $expected_hash"
          echo "       actual:   $actual_hash"
          echo "       This may indicate an untracked upgrade was deployed to devnet."
          add_alert "⚠️  **$label** binary hash changed — expected \`${expected_hash:0:16}…\` got \`${actual_hash:0:16}…\`. Confirm this was an intentional upgrade and update the secret."
          FAIL=1
        fi
      else
        echo "    ℹ️  Binary hash: $actual_hash"
        echo "       Set EXPECTED_HOLDFAST_HASH / EXPECTED_ESCROW_HASH to enable hash-change detection."
      fi
    else
      echo "    ⚠️  solana program dump failed; skipping hash check"
    fi
  else
    echo "    ℹ️  Solana CLI not in PATH; skipping binary hash check"
  fi
}

# ── Run checks ────────────────────────────────────────────────────────────────

echo "======================================================="
echo "  Holdfast Protocol — Devnet Health Check"
echo "  $(ts)"
echo "  RPC: $RPC"
echo "======================================================="

check_program "Holdfast (vaultpact)"        "$HOLDFAST_PROGRAM" "${EXPECTED_HOLDFAST_HASH:-}"
check_program "Escrow (vaultpact_escrow)"   "$ESCROW_PROGRAM"   "${EXPECTED_ESCROW_HASH:-}"

echo ""
echo "======================================================="

if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ All checks passed at $(ts)"
  echo "======================================================="
  exit 0
fi

echo "  ❌ HEALTH CHECK FAILED at $(ts)"
echo "======================================================="

# ── Post Paperclip alert ──────────────────────────────────────────────────────

if [ -z "${PAPERCLIP_API_KEY:-}" ] || [ -z "${PAPERCLIP_API_URL:-}" ]; then
  echo "PAPERCLIP_API_KEY / PAPERCLIP_API_URL not set — skipping alert"
  exit 1
fi

RUN_LINK=""
if [ -n "${GITHUB_RUN_ID:-}" ] && [ -n "${GITHUB_REPOSITORY:-}" ]; then
  RUN_LINK=" · [CI run](https://github.com/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID})"
fi

COMMENT_BODY=$(cat <<BODY
## 🚨 Devnet Health Check Failed

**Time:** $(ts)${RUN_LINK}

### Failures
${ALERT_LINES}

### Action Required

- Check [Holdfast Explorer](https://explorer.solana.com/address/${HOLDFAST_PROGRAM}?cluster=devnet) and [Escrow Explorer](https://explorer.solana.com/address/${ESCROW_PROGRAM}?cluster=devnet) for program status
- If a hash change was detected, confirm the upgrade was intentional and update \`EXPECTED_HOLDFAST_HASH\` / \`EXPECTED_ESCROW_HASH\` GitHub secrets
- If a program is missing, re-deploy per the [devnet deployment runbook](https://github.com/${GITHUB_REPOSITORY:-org/repo}/blob/main/holdfast/docs/devnet-deployment-runbook.md)
BODY
)

curl -s -X POST "${PAPERCLIP_API_URL}/api/issues/${ALERT_ISSUE}/comments" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg body "$COMMENT_BODY" '{body: $body}')" \
  -o /dev/null \
  && echo "Alert posted to ${ALERT_ISSUE}" \
  || echo "Warning: failed to post Paperclip alert"

exit 1
