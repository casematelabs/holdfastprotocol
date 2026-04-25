#!/usr/bin/env bash
# Safe Paperclip issue update helper.
# Uses Python for JSON construction to guarantee valid UTF-8 (no null bytes).
# Usage:
#   scripts/paperclip-issue-update.sh --issue-id "$ISSUE_ID" --status done <<'MD'
#   Your markdown comment here
#   MD
#
# Options:
#   --issue-id ID      Issue UUID or identifier (required)
#   --status STATUS    New status (optional: todo, in_progress, in_review, done, blocked, cancelled)
#   --priority PRI     New priority (optional: critical, high, medium, low)
#   --assignee ID      New assignee agent ID (optional)

set -euo pipefail

ISSUE_ID=""
STATUS=""
PRIORITY=""
ASSIGNEE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --issue-id) ISSUE_ID="$2"; shift 2 ;;
    --status) STATUS="$2"; shift 2 ;;
    --priority) PRIORITY="$2"; shift 2 ;;
    --assignee) ASSIGNEE="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$ISSUE_ID" ]]; then
  echo "Error: --issue-id is required" >&2
  exit 1
fi

COMMENT=""
if [[ ! -t 0 ]]; then
  COMMENT=$(cat)
fi

API_URL="${PAPERCLIP_API_URL:?PAPERCLIP_API_URL not set}"
API_KEY="${PAPERCLIP_API_KEY:?PAPERCLIP_API_KEY not set}"
RUN_ID="${PAPERCLIP_RUN_ID:-}"

PAYLOAD=$(python3 -c "
import json, sys
payload = {}
status = '''${STATUS}'''
priority = '''${PRIORITY}'''
assignee = '''${ASSIGNEE}'''
comment = sys.stdin.read()
if status: payload['status'] = status
if priority: payload['priority'] = priority
if assignee: payload['assigneeAgentId'] = assignee
if comment.strip(): payload['comment'] = comment.strip()
# Ensure no null bytes survive into the JSON
output = json.dumps(payload, ensure_ascii=False)
output = output.replace('\x00', '')
sys.stdout.write(output)
" <<< "$COMMENT")

CURL_ARGS=(
  -s -X PATCH
  "${API_URL}/api/issues/${ISSUE_ID}"
  -H "Authorization: Bearer ${API_KEY}"
  -H "Content-Type: application/json; charset=utf-8"
)

if [[ -n "$RUN_ID" ]]; then
  CURL_ARGS+=(-H "X-Paperclip-Run-Id: ${RUN_ID}")
fi

CURL_ARGS+=(-d "$PAYLOAD")

RESPONSE=$(curl "${CURL_ARGS[@]}")
HTTP_STATUS=$?

if [[ $HTTP_STATUS -ne 0 ]]; then
  echo "Error: curl failed with exit code $HTTP_STATUS" >&2
  echo "$RESPONSE" >&2
  exit 1
fi

echo "$RESPONSE"
