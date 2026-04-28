# Launch Day SOP (Standard Operating Procedure)

**Document:** Holdfast Protocol Devnet Launch Day Execution
**Owner:** CMO
**Use Case:** Any team member can follow these steps to execute T+0 sequence
**Timeline:** ~30 minutes from CEO approval to all content live

---

## Pre-Launch (T-30min)

### 1. Final Status Check
**Owner:** CTO
- [ ] Confirm devnet is green (all three services responding)
- [ ] Confirm smoke tests pass
- [ ] Confirm `npx holdfast init-agent` works
- [ ] Confirm `/status` page shows green

**Owner:** Web Engineer
- [ ] Confirm blog post is staged and ready to publish
- [ ] Confirm Twitter thread is in drafts (not posted)
- [ ] Confirm Discord announcement is in drafts (not posted)
- [ ] Confirm plugin npm package is ready for publish

**Owner:** CMO
- [ ] Confirm CEO approval is confirmed (no blockers)
- [ ] Gather team on launch channel
- [ ] Confirm everyone has their assignments

---

## T+0: Publish Sequence (Execute in Order)

**CRITICAL: Do NOT skip steps or reorder. The sequence matters for algorithm optimization.**

### Step 1: Publish Blog Post (CMO, ~5 min)
**Responsible:** CMO
**Timing:** T+0 start

1. Log into docs.holdfastprotocol.com CMS
2. Publish blog post (title: "Holdfast Protocol Devnet Live: Introducing Machine-Verifiable AI Agent Contracts")
3. Confirm post is live and discoverable
4. Grab blog URL (will need for Twitter thread)

**Success criteria:** Blog post accessible at docs.holdfastprotocol.com/blog/devnet-launch

**Backup plan:** If CMS is down, publish to Medium first, update Twitter with Medium link

---

### Step 2: Post Twitter/X Thread (CMO, ~10 min)
**Responsible:** CMO
**Timing:** T+5 (5 minutes after blog published)

1. Open X/Twitter as @holdfastprotocol
2. Draft and post **Tweet 1** (announcement hook)
   - Include blog URL from Step 1
   - Include devnet badge emoji (🔧)
   - Wait 2-3 minutes

3. Post **Tweet 2-8** in sequence, 2-3 minutes apart
   - Do NOT post all at once (algorithm penalizes bulk posts)
   - Include visuals where possible (devnet screenshot, diagram)
   - Threads help with engagement

**Thread outline:**
- Tweet 1: Launch announcement + blog link
- Tweet 2: What is Holdfast (problem statement)
- Tweet 3: Pacts + Escrow + Reputation primitives
- Tweet 4: Developer value prop (no over-collateralization)
- Tweet 5: Code example (5-minute pact creation)
- Tweet 6: Ecosystem integrations (ElizaOS, AgentKit)
- Tweet 7: Roadmap (devnet now, Q3 mainnet)
- Tweet 8: Call-to-action (join Discord, try SDK)

**Timing:** Space out approximately 2-3 minutes per tweet = 14-21 minutes total

**Success criteria:** All 8 tweets posted, thread is discoverable, first tweet has >100 impressions within 30 min

**Backup plan:** If X is down, post to LinkedIn instead with same messaging

---

### Step 3: Post ElizaOS Discord Announcement (CMO, ~5 min)
**Responsible:** CMO
**Timing:** T+15 (15 minutes after blog published)

1. Log into ElizaOS Discord server
2. Navigate to #plugins channel
3. Post announcement:
   - Headline: "Holdfast Protocol - Machine-Verifiable Contracts for AI Agents"
   - Include: plugin npm package name, devnet badge, key features
   - Include: GitHub repo link, quickstart docs link
   - Include: Call-to-action ("Install and try it, we're in #holdfast-dev for questions")
4. Pin the announcement in #plugins

**Template:**
```
🤖 **Holdfast Protocol — Devnet Launch**

Introducing trustless contracts for autonomous AI agents.

📦 **Get Started:**
- npm install @holdfastprotocol/eliza-plugin
- Docs: holdfastprotocol.com/quickstart
- Questions? Join #holdfast-dev or create an issue

🔗 Key Features:
- Machine-readable pacts agents can verify
- On-chain escrow (no over-collateralization)
- Transparent reputation tracking

⚡ Status: Devnet live | External audit: Q2 | Mainnet: Q3

[GitHub] [Docs] [Discord]
```

**Success criteria:** Message posted, pinned, visible to ElizaOS community

---

### Step 4: Submit Plugin to ElizaOS Registry (CTO, ~10 min)
**Responsible:** CTO or DevRel
**Timing:** T+20 (parallel to or after Discord post)

1. Ensure @holdfastprotocol/eliza-plugin is published to npm
2. Submit plugin to ElizaOS plugin registry:
   - Go to: [ElizaOS plugin registry](https://github.com/elizaOS/eliza-plugins)
   - Create PR or submit form with:
     - Plugin name: @holdfastprotocol/eliza-plugin
     - Description: "Machine-verifiable contracts for AI agents"
     - NPM URL: https://www.npmjs.com/package/@holdfastprotocol/eliza-plugin
     - GitHub repo: https://github.com/holdfastprotocol/eliza-plugin
     - Author: Casemate Labs
3. If registry maintainers are responsive, request fast-track approval

**Success criteria:** Plugin submitted to registry, npm package is discoverable

---

### Step 5: Verify GitHub README & Badge (Web Engineer, ~5 min)
**Responsible:** Web Engineer
**Timing:** T+25

1. Go to: https://github.com/holdfastprotocol/protocol
2. Verify README has devnet badge:
   ```
   ![Status](https://img.shields.io/badge/status-devnet-yellow)
   ![Status](https://img.shields.io/badge/mainnet-coming--q3--2026-lightgrey)
   ```
3. Verify quickstart link in README points to docs.holdfastprotocol.com/quickstart
4. Verify all links are working (not 404s)

**Success criteria:** README is current, badges display correctly, all links work

---

## T+1h: Monitoring Pass (CMO + CEO, ~15 min)

**Owner:** CMO + CEO
**Timing:** 60 minutes after blog published

### Check-in Checklist
- [ ] GitHub Issues: any new setup errors reported?
- [ ] Twitter: mentions and replies (track sentiment)
- [ ] Discord #holdfast-dev: are users asking questions?
- [ ] npm: any install errors or dependency issues?
- [ ] Website: /quickstart page accessible? Onboarding flow working?

### Response Actions
- [ ] Reply to every support question within 2-4 hours
- [ ] If critical issue found, post incident update immediately
- [ ] Retweet positive mentions from community
- [ ] Pin helpful answers in Discord

### Metrics to Record
- Twitter thread impressions (as of T+1h)
- GitHub stars gained (delta from baseline)
- npm downloads for @holdfastprotocol/sdk and @holdfastprotocol/eliza-plugin
- Discord member joins (delta)

---

## T+24h: Metrics Snapshot (CMO, ~30 min)

**Owner:** CMO
**Timing:** 24 hours after blog published

### Data Collection
Collect all metrics from [HOL-217#document-metrics](/HOL/issues/HOL-217#document-metrics):
- Twitter: impressions, engagement, new followers (thread aggregate)
- npm: downloads (cumulative and 24h)
- GitHub: stars gained, new issues filed
- Discord: member joins, activity level
- Website: page views, bounce rate, onboarding completion
- Qualitative: sentiment, ecosystem signals, support load, bugs

### Reporting
Post snapshot to [HOL-217](/HOL/issues/HOL-217) with:
- Summary (1-2 paragraphs)
- Metrics table
- Qualitative observations
- Next actions recommendation

---

## Contingency: If Issue Arises

### Critical Bug Discovered (T+0 to T+24h)
1. Post incident update within 1 hour
2. Temporarily pause Twitter/Discord promotion
3. Update status every 2-4 hours
4. Post postmortem once fixed

### Slow Adoption Signal (T+7d assessment)
1. Analyze bottleneck: docs? technical issues? awareness?
2. Re-target messaging toward specific use cases
3. Reach out to ecosystem partners for co-promotion
4. Plan smaller, focused campaigns

### Strong Adoption Signal (T+7d assessment)
1. Scale support: consider community mods or paid support
2. Accelerate partnership outreach (all three tiers in parallel)
3. Plan next content push: case studies, advanced features
4. Allocate dev resources to ecosystem integrations

---

## Responsible Parties & Permissions

| Step | Owner | Permissions Needed |
|------|-------|------------------|
| 1. Blog publish | CMO | Docs site CMS access |
| 2. Twitter thread | CMO | @holdfastprotocol X/Twitter account |
| 3. Discord announcement | CMO | ElizaOS Discord moderator access |
| 4. Plugin registry submit | CTO/DevRel | GitHub PR permissions, npm publish access |
| 5. README verification | Web Engineer | GitHub repo read access |
| T+1h monitoring | CMO + CEO | Twitter/Discord/GitHub read access |
| T+24h metrics | CMO | Analytics tools read access, Paperclip write access |

---

## Timing Summary

| Time | Task | Owner | Duration |
|------|------|-------|----------|
| T+0 | Publish blog | CMO | 5 min |
| T+5 | Start Twitter thread (Tweet 1) | CMO | — |
| T+7-26 | Post remaining tweets (2-8) | CMO | ~21 min |
| T+15 | Post Discord announcement | CMO | 5 min |
| T+20 | Submit plugin to registry | CTO | 10 min |
| T+25 | Verify README + badges | Web Engineer | 5 min |
| T+60 | Monitoring pass | CMO + CEO | 15 min |
| T+1440 | Metrics snapshot | CMO | 30 min |

**Total active time:** ~30 minutes (T+0 to T+30)
**Peak load:** T+5 to T+26 (Twitter thread posting)

---

## Success Criteria (Launch Complete)

✅ Blog post live and discoverable
✅ Twitter thread posted (all 8 tweets)
✅ Discord announcement posted and pinned
✅ Plugin submitted to registry
✅ GitHub README verified
✅ No critical issues reported (T+1h)
✅ Metrics snapshot collected (T+24h)

If all 7 criteria met, launch is successful. Proceed with T+2d Phase 2 content push.
