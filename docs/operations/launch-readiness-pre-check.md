# Launch Readiness Pre-Check Checklist

**Document:** Holdfast Protocol Devnet Launch — Final Verification Before T+0
**Owner:** CTO + CMO + Web Engineer
**Use Case:** Execute immediately when HOL-20 CI/CD deployment completes, before T+0 sequence starts
**Timeline:** T-30min (30 minutes before blog publish)

---

## Pre-Check Gate (Do Not Proceed Without 100% Green)

This checklist verifies that devnet is actually live and all systems are ready. Execute in order. **Stop and escalate if ANY check fails.**

---

## Part 1: Devnet Deployment Verification (CTO)

**Gate:** All checks must pass before proceeding to Part 2.

### 1.1 Core Services Status

**Check:** Devnet RPC node responding
```bash
curl -s https://api.devnet.holdfastprotocol.com/health | jq '.status'
# Expected: "green" or "ok"
```
✅ Status: ___________
⏱️ Timestamp: ___________

**Check:** VaultPact program on-chain
```bash
solana program show <PROGRAM_ID> --url devnet
# Expected: Program deployed, status active
```
✅ Verified: ☐ Yes ☐ No
⏱️ Timestamp: ___________

**Check:** Escrow program on-chain
```bash
solana program show <ESCROW_PROGRAM_ID> --url devnet
# Expected: Program deployed, status active
```
✅ Verified: ☐ Yes ☐ No
⏱️ Timestamp: ___________

### 1.2 SDK Installation & Testing

**Check:** @holdfastprotocol/sdk installs cleanly
```bash
npm install @holdfastprotocol/sdk --registry https://registry.npmjs.org/
# Expected: No errors, latest version installed
```
✅ Version installed: ___________
✅ Installation success: ☐ Yes ☐ No
⏱️ Timestamp: ___________

**Check:** Quickstart example runs without error
```bash
npx holdfast init-agent --test
# Expected: Successfully creates test pact
```
✅ Test pact created: ☐ Yes ☐ No
✅ On-chain transaction: ☐ Confirmed ☐ Pending ☐ Failed
⏱️ Timestamp: ___________

**Check:** ElizaOS plugin installs and loads
```bash
npm install @holdfastprotocol/eliza-plugin
# Expected: No dependency conflicts, plugin loads
```
✅ Plugin version: ___________
✅ ElizaOS integration: ☐ Working ☐ Broken
⏱️ Timestamp: ___________

### 1.3 Critical Path Smoke Tests

**Check:** Create pact → Lock escrow → Verify on-chain
```bash
# Execute quickstart tutorial end-to-end
# Expected: All steps succeed, no errors
```
✅ Pact created: ☐ Yes ☐ No
✅ Escrow locked: ☐ Yes ☐ No
✅ On-chain verified: ☐ Yes ☐ No
❌ Errors found: ___________

**Check:** Reputation lookup works
```bash
holdfast reputation <agent-address> --devnet
# Expected: Returns agent reputation score
```
✅ Reputation score: ___________
✅ Working: ☐ Yes ☐ No
⏱️ Timestamp: ___________

---

## Part 2: Website & Documentation Verification (Web Engineer)

**Gate:** All checks must pass before proceeding to Part 3.

### 2.1 Documentation Site

**Check:** Docs site is accessible
```bash
curl -s https://docs.holdfastprotocol.com/ -o /dev/null -w "%{http_code}\n"
# Expected: 200
```
✅ HTTP status: ___________
✅ Site accessible: ☐ Yes ☐ No
⏱️ Timestamp: ___________

**Check:** Quickstart page loads correctly
```bash
curl -s https://docs.holdfastprotocol.com/quickstart | grep -c "npm install"
# Expected: 1 or more matches
```
✅ Quickstart present: ☐ Yes ☐ No
✅ Code examples visible: ☐ Yes ☐ No
⏱️ Timestamp: ___________

**Check:** API reference pages load
```bash
curl -s https://docs.holdfastprotocol.com/api | grep -c "endpoint"
# Expected: 1 or more matches
```
✅ API docs present: ☐ Yes ☐ No
⏱️ Timestamp: ___________

**Check:** Blog post is staged and ready
```bash
# Verify blog post is in CMS, set to publish, not yet published
```
✅ Blog post found: ☐ Yes ☐ No
✅ Status: ___________
✅ Ready to publish: ☐ Yes ☐ No
⏱️ Timestamp: ___________

### 2.2 GitHub Repository

**Check:** README is current with devnet badge
```bash
curl -s https://raw.githubusercontent.com/holdfastprotocol/protocol/main/README.md | grep -i "devnet"
# Expected: 1 or more mentions
```
✅ Devnet badge present: ☐ Yes ☐ No
⏱️ Timestamp: ___________

**Check:** GitHub repo is accessible and public
```bash
curl -s https://api.github.com/repos/holdfastprotocol/protocol | jq '.private'
# Expected: false
```
✅ Public repository: ☐ Yes ☐ No
✅ Stargazers count: ___________
⏱️ Timestamp: ___________

**Check:** Quickstart tutorial is in docs
```bash
curl -s https://raw.githubusercontent.com/holdfastprotocol/protocol/main/docs/quickstart.md | wc -l
# Expected: 50+ lines
```
✅ Quickstart doc present: ☐ Yes ☐ No
✅ Line count: ___________
⏱️ Timestamp: ___________

---

## Part 3: Social & Community Setup Verification (CMO)

**Gate:** All checks must pass before proceeding to Part 4.

### 3.1 Twitter/X Account

**Check:** @holdfastprotocol account exists and is verified
```bash
# Visit https://twitter.com/holdfastprotocol
```
✅ Account accessible: ☐ Yes ☐ No
✅ Account verified: ☐ Yes ☐ No
✅ Current follower count: ___________
⏱️ Timestamp: ___________

**Check:** Account has no recent posts (ready for launch thread)
```bash
# Verify last post is >2 days old
```
✅ Clean posting history: ☐ Yes ☐ No
✅ Last post date: ___________
⏱️ Timestamp: ___________

**Check:** Twitter/X analytics are accessible
```bash
# Log in to @holdfastprotocol account and verify analytics dashboard loads
```
✅ Analytics accessible: ☐ Yes ☐ No
✅ Real-time data loading: ☐ Yes ☐ No
⏱️ Timestamp: ___________

### 3.2 Discord Community

**Check:** Discord server exists and is configured
```bash
# Visit Discord invite link
```
✅ Server accessible: ☐ Yes ☐ No
✅ #holdfast-dev channel present: ☐ Yes ☐ No
✅ Member count: ___________
⏱️ Timestamp: ___________

**Check:** Discord welcome message is ready
```bash
# Verify #announcements channel has placeholder message ready
```
✅ Channel ready: ☐ Yes ☐ No
✅ Permissions correct: ☐ Yes ☐ No
⏱️ Timestamp: ___________

**Check:** Moderation team invited
```bash
# Verify moderators have appropriate roles
```
✅ Mods invited: ☐ Yes ☐ No
✅ Permissions granted: ☐ Yes ☐ No
⏱️ Timestamp: ___________

---

## Part 4: Content & Messaging Verification (CMO + CEO)

**Gate:** All checks must pass before proceeding to T+0.

### 4.1 Blog Post Content

**Check:** T+0 blog post is final and ready
```bash
# CEO reviews blog post content, messaging, code examples
```
✅ Content reviewed by CEO: ☐ Yes ☐ No
✅ Final approval given: ☐ Yes ☐ No
✅ Publication URL tested: ☐ Yes ☐ No
⏱️ Timestamp: ___________

### 4.2 Twitter Thread

**Check:** All 8 tweets are drafted and final
```bash
# CEO reviews Twitter thread for messaging consistency
```
✅ Tweet 1 (announcement): ☐ Ready ☐ Needs edit
✅ Tweet 2-8 (thread): ☐ Ready ☐ Needs edit
✅ All links tested: ☐ Yes ☐ No
⏱️ Timestamp: ___________

### 4.3 CEO Messaging

**Check:** CEO has reviewed talking points
```bash
# CEO confirms familiarity with talking points and messaging pillars
```
✅ Reviewed: ☐ Yes ☐ No
✅ Comfortable with messaging: ☐ Yes ☐ No
✅ Questions answered: ☐ Yes ☐ No
⏱️ Timestamp: ___________

---

## Part 5: Execution Readiness (All Teams)

**Gate:** All checks must pass before executing T+0 sequence.

### 5.1 Permissions & Access

**Check:** CMO has blog CMS access
```bash
# CMO tests login to docs.holdfastprotocol.com CMS
```
✅ CMS access working: ☐ Yes ☐ No
⏱️ Timestamp: ___________

**Check:** CMO has Twitter @holdfastprotocol access
```bash
# CMO verifies can post to @holdfastprotocol
```
✅ Twitter access working: ☐ Yes ☐ No
⏱️ Timestamp: ___________

**Check:** CTO has npm publish access
```bash
# CTO verifies npm token for @holdfastprotocol packages
```
✅ npm access working: ☐ Yes ☐ No
⏱️ Timestamp: ___________

**Check:** Web Engineer has GitHub repo push access
```bash
# Web Engineer verifies can push to holdfastprotocol/protocol
```
✅ GitHub access working: ☐ Yes ☐ No
⏱️ Timestamp: ___________

### 5.2 Team Alignment

**Check:** All team members on launch call
```bash
# Verify CMO, CEO, CTO, Web Engineer are all on same call/chat
```
✅ Team gathered: ☐ Yes ☐ No
✅ Assignments confirmed: ☐ Yes ☐ No
⏱️ Timestamp: ___________

**Check:** Escalation path confirmed
```bash
# Team confirms: who escalates if critical bug? Who makes final calls?
```
✅ Escalation path clear: ☐ Yes ☐ No
✅ Decision maker identified: ___________
⏱️ Timestamp: ___________

**Check:** Monitoring setup verified
```bash
# CMO confirms metrics dashboard is open and monitoring tools are ready
```
✅ Dashboards ready: ☐ Yes ☐ No
✅ Export automation ready: ☐ Yes ☐ No
⏱️ Timestamp: ___________

---

## Final Gate: Launch Go/No-Go Decision

### Pre-Check Summary

| Part | Status | Owner | Go/No-Go |
|------|--------|-------|----------|
| 1. Devnet Deployment | ☐ Pass ☐ Fail | CTO | ☐ Go ☐ No-Go |
| 2. Website & Docs | ☐ Pass ☐ Fail | Web Eng | ☐ Go ☐ No-Go |
| 3. Social & Community | ☐ Pass ☐ Fail | CMO | ☐ Go ☐ No-Go |
| 4. Content & Messaging | ☐ Pass ☐ Fail | CMO + CEO | ☐ Go ☐ No-Go |
| 5. Execution Readiness | ☐ Pass ☐ Fail | All | ☐ Go ☐ No-Go |

### Final Decision

**Go/No-Go:** ☐ **GO** ☐ **NO-GO**

**Decision made by:** ___________
**Timestamp:** ___________
**Reason (if No-Go):** ___________

---

## If No-Go: Immediate Actions

1. Document exact failure point and root cause
2. Escalate to CEO immediately
3. Post status update on HOL-217
4. Identify fix timeline
5. Set new pre-check date

---

## If Go: Proceed to T+0

Execute Launch Day SOP (document-launch-day-sop.md) immediately:
- T+0:00 — Publish blog
- T+0:05 — Start Twitter thread
- T+0:15 — Post Discord announcement
- T+0:20 — Submit plugin to registry
- T+0:25 — Verify GitHub README

**Good luck. Let's launch this thing.** 🚀

---

**Status: Ready to use as T-30min gate for T+0 sequence**
