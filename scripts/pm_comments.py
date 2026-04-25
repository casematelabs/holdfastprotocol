import json, urllib.request, os, sys

api_url = os.environ['PAPERCLIP_API_URL']
api_key = os.environ['PAPERCLIP_API_KEY']
run_id = os.environ['PAPERCLIP_RUN_ID']

def post_comment(issue_id, body):
    payload = json.dumps({'body': body}).encode()
    req = urllib.request.Request(
        f'{api_url}/api/issues/{issue_id}/comments',
        data=payload,
        headers={
            'Authorization': f'Bearer {api_key}',
            'X-Paperclip-Run-Id': run_id,
            'Content-Type': 'application/json'
        },
        method='POST'
    )
    try:
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read())
            print(f'  OK: {result.get("id")}')
            return result
    except urllib.error.HTTPError as e:
        body_text = e.read().decode()
        print(f'  ERROR {e.code}: {body_text}')
        return None

def patch_issue(issue_id, data):
    payload = json.dumps(data).encode()
    req = urllib.request.Request(
        f'{api_url}/api/issues/{issue_id}',
        data=payload,
        headers={
            'Authorization': f'Bearer {api_key}',
            'X-Paperclip-Run-Id': run_id,
            'Content-Type': 'application/json'
        },
        method='PATCH'
    )
    try:
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read())
            print(f'  PATCH OK: {result.get("identifier")} status={result.get("status")}')
            return result
    except urllib.error.HTTPError as e:
        body_text = e.read().decode()
        print(f'  PATCH ERROR {e.code}: {body_text}')
        return None


# --- CAS-327: Final escalation — Apr 24 cutoff is TOMORROW ---
print('Posting CAS-327 escalation...')
cas327_id = 'c692f54f-4a04-4d4e-b57f-9365e8cc3678'
comment_327 = """## ESCALATION — FINAL CUTOFF: Apr 24 (tomorrow)

**Today: 2026-04-23. Tomorrow is the localnet fallback cutoff.**

PM set Apr 24 as the decision gate: if the devnet deployer wallet is not funded by Apr 24, the demo video ([CAS-295](/CAS/issues/CAS-295)) proceeds on localnet and Slide 9 of the deck ([CAS-296](/CAS/issues/CAS-296)) must be updated accordingly.

**Required action (board/CEO only):**
1. Visit faucet.solana.com (GitHub sign-in required)
2. Send **5 SOL** to: `2TH4VxNqPdzDMX2guhEfDvmmLstnLN2BpcyvUb8bjrkd`
3. Reply confirming — CTO deploys immediately

**This is the final escalation before localnet fallback is confirmed.**

- [CAS-369](/CAS/issues/CAS-369) (smoke test) remains blocked until resolved
- [CAS-295](/CAS/issues/CAS-295) Video Editor begins recording Apr 28 — decision needed by Apr 24
- Conference: May 4–5 (11 days away)

If no board action by Apr 24, PM will unblock CAS-295 for localnet recording on Apr 24."""
post_comment(cas327_id, comment_327)


# --- CAS-295: Alert Video Editor about Apr 24 decision gate ---
print('Posting CAS-295 alert...')
cas295_id = '0d6e4e3f-2429-4e52-884a-88a788f17585'
comment_295 = """## Decision gate: Apr 24 (tomorrow)

[CAS-327](/CAS/issues/CAS-327) (devnet wallet funding) remains blocked after 3+ days of escalation.

**Decision for Video Editor:** PM will confirm by Apr 24 whether to proceed on devnet or localnet.

- **If board funds wallet by Apr 24:** CTO redeploys, Video Editor records live devnet tx as planned
- **If no board action by Apr 24:** Video Editor proceeds with localnet recording April 28

Recording quality and production value remain the same either way — only the Slide 9 claim changes (live devnet vs localnet demo). PM will post confirmation here by end of day Apr 24.

No action needed from you now — just flagging the timeline."""
post_comment(cas295_id, comment_295)


# --- CAS-363: Escalate permissions blocker to board ---
print('Posting CAS-363 escalation...')
cas363_id = '28aeda79-65bd-4a5f-8f59-19d195981016'
comment_363 = """## Board Action Required — Agent Permission Blocker

Full-Stack Developer ([CAS-363](/CAS/issues/CAS-363)) has completed all notification system wiring but is **blocked by harness permission settings** — the agent cannot run `git add`, `git commit`, or `node` commands.

**Work that is ready to commit (11 files):**
- `app/components/NotificationContext.tsx`, `NotificationCenter.tsx`, `NotificationToast.tsx`, `AlertBanner.tsx`
- `app/dashboard/layout.tsx` (wired notification system)
- `app/dashboard/escrow/DisputeModal.tsx`
- `app/dashboard/custody/page.tsx`, `escrow/page.tsx`, `reputation/page.tsx` (real indexer data)
- `app/layout.tsx` (meta tags)
- `lib/indexer.ts` (typed API client)

**Fix required** — add to `.claude/settings.json` in the project root:
```json
{
  "permissions": {
    "allow": [
      "Bash(git add *)",
      "Bash(git commit *)",
      "Bash(node -e *)",
      "Bash(node -p *)"
    ]
  }
}
```

Once added, the Full-Stack Developer can resume and complete the commit immediately. This unblocks CAS-363 and the dashboard notification feature."""
post_comment(cas363_id, comment_363)

print('All comments posted.')
