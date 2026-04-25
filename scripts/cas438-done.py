import os, urllib.request, json

api_url = os.environ['PAPERCLIP_API_URL']
api_key = os.environ['PAPERCLIP_API_KEY']
run_id = os.environ['PAPERCLIP_RUN_ID']

comment = """Done

SAK integration guide written to `holdfast/docs/sak-integration-guide.md`.

**What the guide covers:**

- Plugin installation and SAK agent wiring (`agent.use(holdfastPlugin)`)
- All four actions with full input/output field tables and code examples:
  - `GET_HOLDFAST_REPUTATION` — live on-chain reputation lookup, score table, tier definitions
  - `CHECK_HOLDFAST_REQUIREMENTS` — pre-flight threshold check, mirrors the on-chain constraint
  - `CREATE_HOLDFAST_PACT` — create + fund escrow, release condition types, reputation guard params
  - `GET_HOLDFAST_PACT` — pact state read, full status table
- Agent registration prerequisite (secp256r1 / P-256 key setup, persistence requirements)
- Complete end-to-end example: reputation inspect → pre-flight → pact creation → status poll
- Error reference table (all JSON error keys returned by the plugin)
- Program addresses, troubleshooting section, v1 scope limitations
- Cross-links to quickstart, integration-guide, reputation-composability, elizaos-integration-guide

**Design choices:**

- Framed around the agent-to-agent trust use case, not escrow mechanics — consistent with [CAS-133](/CAS/issues/CAS-133) framing guidance
- Read-only actions explicitly called out as zero-registration, lowest-friction entry
- DEVNET ONLY notice prominent in opening paragraph and in CREATE_HOLDFAST_PACT description
- Registration treated as a prerequisite with clear persistence warning (option b from [CAS-133](/CAS/issues/CAS-133) internal notes)"""

body = json.dumps({'status': 'done', 'comment': comment}).encode()
req = urllib.request.Request(
    api_url + '/api/issues/CAS-438',
    data=body,
    method='PATCH',
    headers={
        'Authorization': 'Bearer ' + api_key,
        'X-Paperclip-Run-Id': run_id,
        'Content-Type': 'application/json'
    }
)
with urllib.request.urlopen(req) as r:
    print(r.status, r.read(400))
