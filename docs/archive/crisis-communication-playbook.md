# Crisis Communication Playbook

**Document:** Holdfast Protocol Devnet Launch Crisis Response
**Owner:** CMO + CEO
**Use Case:** Rapid response template for launch day issues
**Timeline:** Ready for T+0 launch

---

## Overview

This playbook covers 5 crisis scenarios with pre-written responses, decision trees, and escalation procedures. **Goal:** Respond to any critical issue within 1 hour with transparency and clarity.

---

## Crisis Scenario 1: Critical Bug Discovered (T+0 to T+24h)

### Trigger Examples
- Devnet is down or unresponsive
- SDK fails to initialize in most environments
- Pact creation fails consistently
- Escrow program has security vulnerability

### Immediate Actions (First 30 min)

**Step 1: Verify Bug Reality**
- Is it reproducible? (Test in 2 environments)
- Is it affecting all users or specific conditions?
- Severity: Data loss? Security? Functionality? UX?

**Step 2: Assess Severity**
- **CRITICAL:** System down, security issue, data loss → Full incident response
- **HIGH:** Feature broken for most users → Documented workaround + fix ETA
- **MEDIUM:** Feature broken for some users → Monitoring + fix in progress
- **LOW:** Cosmetic or single-user issue → Backlog, no public notice

**Step 3: Post Incident Update (Within 1 hour)**
- If CRITICAL or HIGH, post update to:
  - GitHub (pin issue to top)
  - Discord #holdfast-dev (post + pin)
  - Twitter (quote-reply to launch announcement)

### Response Template (Post to All Channels)

```
🔧 **INCIDENT: [Brief Title]** — Status: INVESTIGATING

We've identified an issue affecting [scope]. 

**What we know:**
- [1-2 sentences describing the problem]
- [Impact: Which users/systems affected]

**What we're doing:**
- [Immediate action: e.g., "rolled back to stable version", "patched and redeploying"]
- ETA for fix: [time, e.g., "within 2 hours"]

**What you can do:**
- [Workaround if available, e.g., "Use SDK v1.0.1 instead of v1.0.2"]
- Report issues: github.com/holdfastprotocol/protocol/issues

**Next update:** [2 hours from now]

We take this seriously. Updates every 2 hours until resolved.
```

### Status Updates (Every 2-4 hours until resolved)

**Update Template:**
```
**UPDATE [time]:** 
- [Progress: e.g., "Root cause identified: X"]
- [New ETA: e.g., "Fix ships in 1 hour"]
- [Any changes to workaround or scope]
```

### Resolution & Postmortem

Once fixed:
1. Post resolution announcement (same channels)
2. Thank the community for patience
3. Schedule postmortem for T+2d (within 48 hours)
4. Share postmortem publicly (what failed, why, how we prevent it)

**Postmortem Template:**
```
**Postmortem: [Issue Title]**

**Timeline:**
- T+0:XX — Issue first reported
- T+0:YY — Root cause identified
- T+0:ZZ — Fix deployed

**Root Cause:**
[1-2 sentences explaining what went wrong]

**Fix:**
[What we changed and why]

**Prevention:**
[How we'll prevent this in the future]

**Learnings:**
[What we learned about our infrastructure/process]

Thank you for your patience. We're committed to shipping with confidence.
```

### Escalation Path
- If issue unresolved after 4 hours: Escalate to CTO for engineering escalation
- If issue unresolved after 8 hours: Pause further promotion (do not tweet), focus on fix
- If issue unresolved after 24 hours: Consider rolling back devnet to prior version, extend launch timeline

---

## Crisis Scenario 2: npm Package Failures

### Trigger Examples
- SDK fails to install cleanly (dependency resolution issues)
- ElizaOS plugin fails to load
- Package corrupted on npm registry
- Breaking changes introduced unexpectedly

### Immediate Response

**Step 1: Reproduce**
- Install from scratch: `npm install @holdfastprotocol/sdk`
- Test in fresh environment: `npx holdfast init-agent`
- Test with various Node.js versions (18, 20, 22)

**Step 2: Determine Scope**
- Is it npm registry issue (not our fault)?
- Is it version-specific (can recommend older version)?
- Is it environment-specific (docs workaround)?

**Step 3: Response Path**

**If quick fix available (< 1 hour):**
- Publish v1.0.1 to npm
- Post update: "v1.0.1 released with fix. `npm install @holdfastprotocol/sdk@latest`"

**If requires deeper fix (> 1 hour):**
- Publish to npm with pre-release tag: `npm install @holdfastprotocol/sdk@1.0.0-fix.1`
- Post workaround: "If you hit install errors, try: `npm install --legacy-peer-deps`"
- Post ETA: "Full fix ships within [X] hours in v1.0.1"

### Communication Template

```
📦 **npm Package Notice**

Users installing `@holdfastprotocol/sdk` may encounter [error description].

**Workaround:** [Step-by-step solution]

**Fix:** Released in v1.0.1 (or ETA: [time])

**Update command:** npm install @holdfastprotocol/sdk@1.0.1

If you still have issues, reply here or open a GitHub issue.
```

### Escalation
- After 2 hours: Involve npm support (check registry status)
- After 4 hours: Consider unpublishing broken version + republishing with new version number
- After 8 hours: Offer Docker image as temporary alternative

---

## Crisis Scenario 3: Support Overwhelm (High Volume Questions)

### Trigger Examples
- 50+ questions in first hour (Discord explodes)
- Support response time > 30 minutes
- Same question asked 10x (indicates docs problem)
- Critical questions going unanswered for 2+ hours

### Immediate Actions

**Step 1: Assess Load**
- How many new questions per hour?
- What are the top 3 questions?
- Are there critical blockers (setup, bugs)?

**Step 2: Triage & Systematize**

**For setup help (50%+ of questions):**
- Create FAQ pinned in Discord
- Link to quickstart docs in every reply
- If docs are unclear, flag for content update

**For bugs/critical issues:**
- Flag to engineering immediately
- Provide workaround while investigating
- Post status update

**For feedback/ideas:**
- Thank users and link to GitHub discussions
- Offer to prioritize promising feedback

**Step 3: Scale Response**

**If team is overwhelmed:**
- Post in Discord: "We're getting a great response! We're reading all questions, may take 30-60 min to reply. Prioritizing setup help + bugs."
- Identify 2-3 power users in Discord and ask them to help (reward with case study opportunity)
- Pin FAQ and best answers

**If volume persists:**
- Hire contractor or community mod (add $1-2k to launch budget)
- Set support SLA: "Critical questions answered within 4 hours, others within 24"
- Create support rotation (24-hour coverage)

### Communication Template

```
🙌 **We're Getting Great Response!**

Thank you for the enthusiasm. We're reading every question and working through answers. 

**Common setup questions:**
1. [Q1] → [A1] / [Link to docs]
2. [Q2] → [A2] / [Link to docs]
3. [Q3] → [A3] / [Link to docs]

**Known issues & fixes:**
- [Issue] → [Workaround/ETA]

**Fastest way to get help:**
1. Check the FAQ pinned above
2. Check the quickstart docs: [link]
3. Search existing GitHub issues
4. If still stuck, reply here with your specific error

We're hiring community mods if you're interested in helping us scale: [link]
```

### Success Metrics
- 95%+ of questions answered within 24 hours
- 5+ power users helping with triage
- Top 5 questions documented in FAQ

---

## Crisis Scenario 4: Website/Docs Down (T+0 to T+24h)

### Trigger Examples
- docs.holdfastprotocol.com returns 500 error
- Quickstart page inaccessible
- Blog post missing from site
- Deploy pipeline broken

### Immediate Response

**Step 1: Verify Down Status**
- Is entire site down or just specific pages?
- What's the error (500, timeout, DNS)?
- Check status page (if available)

**Step 2: Response Path**

**If 15-60 minute outage (temporary):**
- Post to Discord/Twitter: "Docs site is temporarily down (investigating). Quickstart backup: [GitHub link]. We'll have it back up shortly."
- Monitor and post updates every 15 min
- Post "Up!" once resolved

**If 1+ hour outage (needs escalation):**
- Escalate to DevOps/Web Engineer immediately
- Post incident notice: "Our docs site is down. ETA for restore: [time]. Backup docs: [GitHub]"
- Every 30 min: status update with new ETA
- Post postmortem once resolved

### Fallback Options
- GitHub can serve as backup docs: Link to `docs/` folder in repo
- Mirror blog post content to Medium or Dev.to
- Provide quickstart code snippets in Discord pinned message

### Communication Template

```
🔧 **Docs Site Down**

We're experiencing an outage on docs.holdfastprotocol.com.

**Backup resources:**
- Quickstart: github.com/holdfastprotocol/protocol/tree/main/docs/quickstart
- Blog post: [Medium link]
- API reference: [GitHub link]

**ETA for restore:** [time]

**Status updates:** Every 15 minutes in this thread

We're sorry for the inconvenience. We'll have it back up ASAP.
```

### Escalation
- After 30 min: Page someone from DevOps/Infra
- After 2 hours: Consider emergency CDN/alternative hosting
- After 4 hours: Brief all users on extended timeline, offer refund if applicable

---

## Crisis Scenario 5: Negative Sentiment or Major Criticism

### Trigger Examples
- Influential developer posts "Holdfast is overengineered"
- Thread of negative replies accumulates
- Security researcher finds (non-critical) issue
- Community sentiment shifts from positive to skeptical

### Decision Tree

**Is the criticism factually correct?**

**YES:**
- Acknowledge publicly: "Fair point. We designed X this way because [reason]."
- If it's a real gap: "You're right. We'll address this in Q2."
- Thank them for the feedback
- Move on

**NO:**
- Provide factual correction with source: "Actually, [fact]. See [evidence]."
- Keep tone friendly, not defensive
- Invite to discuss further

**Is it a security concern?**
- Do NOT reply publicly if unpatched
- Respond: "Thank you for bringing this to our attention. Please email security@casemate.labs."
- Handle privately and offline

### Response Template (For Negative Feedback)

```
Thank you for the feedback. A few thoughts:

[Address their specific concern with facts/context]

We designed X this way because [constraint/reason]. You can read more here: [link]

If you see a better approach, we'd love to hear it. Open a discussion: [link]

We're taking this seriously and iterating based on community input.
```

### What NOT to Do
❌ Don't be defensive
❌ Don't argue with the critic
❌ Don't attack their credibility
❌ Don't delete comments (unless spam/abuse)
❌ Don't claim "everyone loves us"

### How to Turn It Around
✅ Acknowledge the feedback
✅ Explain your thinking (not as defense, but as context)
✅ Show you're iterating
✅ Invite them to help solve it
✅ Post what you learned publicly

### Escalation
- If single critic: Reply thoughtfully, move on
- If thread gains traction (100+ RTs, prominent voices joining): Post comprehensive response addressing all concerns
- If sentiment shift (60%+ negative): Post transparent statement on roadmap/vision and how you're addressing concerns
- If coordinated attack: Do not engage publicly, handle privately if possible

---

## Crisis Response Checklist

**For ANY Crisis:**
- [ ] Verify the issue is real (not hearsay)
- [ ] Assess severity (critical/high/medium/low)
- [ ] Post incident notice within 1 hour
- [ ] Set update cadence (every X hours)
- [ ] Identify root cause
- [ ] Communicate fix ETA
- [ ] Post resolution notice
- [ ] Schedule postmortem
- [ ] Share learnings publicly

**Communication channels for each severity:**

| Severity | GitHub | Discord | Twitter | Email |
|----------|--------|---------|---------|-------|
| CRITICAL | Issue + pin | #holdfast-dev + pin | Quote-reply | Optional |
| HIGH | Issue + comment | #holdfast-dev + pin | Thread | List |
| MEDIUM | Comment | #holdfast-dev | — | — |
| LOW | Comment | — | — | — |

---

## Pre-Launch Crisis Preparation

**T-30min Checklist:**
- [ ] Crisis playbook reviewed by CEO + CMO
- [ ] All team members know their roles
- [ ] Contact list prepared (CTO, Web Engineer, DevOps, external comms)
- [ ] Incident response channel created on Discord (private)
- [ ] Status page ready (if available)
- [ ] Backup docs links prepared (GitHub, Medium)
- [ ] Discord moderation setup: pause new invites if overwhelmed

**During T+0-T+24h:**
- [ ] Monitor for issues continuously (no autopilot)
- [ ] Response time target: Critical issues < 1 hour, others < 4 hours
- [ ] All updates posted to same channels (consistency)
- [ ] Escalate early (don't wait for it to get worse)

---

**Status: Ready for T+0 launch execution**
