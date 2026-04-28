# Holdfast Protocol: Crisis Communication Playbook
## Launch Contingency Response Framework

**Document Status:** Draft for CEO Approval  
**Owner:** CMO (Lead) | CEO (Tone Approval)  
**Last Updated:** 2026-04-28  
**Next Review:** Post-Launch (72h, 7d checkpoints)

---

## Table of Contents
1. [Decision Tree](#decision-tree)
2. [Escalation Contacts & Procedures](#escalation-contacts--procedures)
3. [Communication Channels](#communication-channels)
4. [Crisis Scenarios & Templates](#crisis-scenarios--templates)
5. [Post-Incident Process](#post-incident-process)
6. [Key Principles](#key-principles)

---

## Decision Tree

```
CRISIS DETECTED
    │
    ├─ Is it a SMART CONTRACT / DATA LOSS issue?
    │  └─→ SCENARIO 1: Critical Bug (Smart Contract Vulnerability)
    │      Actions: 1h incident notice → 2-4h updates → postmortem
    │
    ├─ Are PACKAGE INSTALLS FAILING at scale?
    │  └─→ SCENARIO 2: NPM Package Install Failures
    │      Actions: Troubleshooting guide → rollback assessment → developer comms
    │
    ├─ Is DISCORD/GITHUB FLOODED with support questions?
    │  └─→ SCENARIO 3: Community Support Overwhelmed
    │      Actions: Triage → FAQ response → mod escalation → resource reallocation
    │
    ├─ Is WEBSITE/ONBOARDING DOWN or severely degraded?
    │  └─→ SCENARIO 4: Infrastructure / Website Outage
    │      Actions: Incident notice → manual setup guide → ETA updates
    │
    └─ Is there NEGATIVE SENTIMENT / CRITICISM emerging?
       └─→ SCENARIO 5: Reputation / Sentiment Crisis
           Actions: Assess severity → decide engage/ignore → escalate if needed
```

### How to Use This Tree
1. **Identify the root cause** — what are users actually experiencing?
2. **Map to the scenario** — use the decision tree
3. **Follow the scenario playbook** — use templates and cadence below
4. **Escalate if unsure** — contact CEO immediately

---

## Escalation Contacts & Procedures

### On-Call Crisis Team

| Role | Person | Contact | Authority |
|------|--------|---------|-----------|
| **CEO** | [Name] | [Email/Phone] | Final approval on all external comms; reputation decisions |
| **CTO** | [Name] | [Email/Phone] | Technical validation; rollback decisions; incident severity |
| **CMO** | [Name/You] | [Email/Phone] | Comms lead; message drafting; public channel management |
| **Community Lead** | [Name] | [Email/Phone] | Discord/GitHub triage; mod coordination; user support |

### Escalation Triggers

- **Immediate CEO Escalation** (within 15 min):
  - Smart contract vulnerability confirmed
  - Data loss or fund impact
  - Public security advisory issued
  - Negative sentiment trending (10k+ mentions)

- **CTO + CEO Together**:
  - Any bug affecting mainnet deployment
  - Decision to rollback or pause
  - Public technical postmortem needed

- **CMO Only** (can act autonomously):
  - FAQ responses, mod guidance
  - Developer troubleshooting guides
  - Positive community engagement

### Contact Protocol
1. **Slack Channel:** `#crisis-response` (monitored by all)
2. **If Slack is down:** Direct call/text to CEO + CTO
3. **Escalation cadence:** Re-sync every 30-60 min during active incident

---

## Communication Channels

### Priority Order for Public Announcements
1. **Twitter/X** (fastest reach to ecosystem) — CEO approval required
2. **Discord Announcements** (direct to community) — CMO can post, notify CEO
3. **GitHub Status** (for SDK/package issues) — CTO + CMO
4. **Email** (affected devs only, if data breach) — CEO approval required
5. **Official Blog** (postmortems only, after incident resolved)

### Channel Access & Permissions
- **Twitter:** CEO, CMO
- **Discord:** CMO, Community Lead, Mods
- **GitHub:** CTO, CMO
- **Email:** CEO (approval), CMO (drafting)
- **Blog:** CMO (drafting), CEO (approval)

### Message Templates by Channel

**Twitter (initial announcement):**
- Keep to 280 characters
- Include: "We're investigating [issue]. Updates every 2h. Discord: [link]"
- Tone: factual, urgent, direct to mitigation steps

**Discord (ongoing updates):**
- Use announcement channel for official updates
- Use pinned thread for FAQ/status
- Response from Community Lead or CMO
- Tone: transparent, apologetic if needed, action-oriented

**GitHub (package issues):**
- Post in release discussion
- Include: workaround steps, expected fix ETA, rollback instructions
- Tone: technical, clear instructions

---

## Crisis Scenarios & Templates

### SCENARIO 1: Critical Bug Discovered (Smart Contract Vulnerability)

**Severity Indicators:**
- Funds at risk or already lost
- Smart contract exploit detected
- Data loss or unauthorized access
- Security audit failure at launch

**Timeline & Actions:**

#### T+0 to T+1h: Incident Announcement
**Goal:** Acknowledge, prevent further damage, set expectations

**Twitter Template:**
```
⚠️ We've identified a smart contract issue affecting [component]. 
We're pausing [feature] to investigate and protect user funds.
Full status update every 2h. Discord: [link] for real-time updates.
Thank you for your patience.
```

**Discord Announcement:**
```
🔴 **INCIDENT: Smart Contract Issue Under Investigation**

At [TIME UTC], we identified and paused [feature] to investigate a potential vulnerability.

**What we're doing:**
- Paused affected contracts to prevent further impact
- Pulling together CTO + security team
- Status updates every 2 hours

**What you should do:**
- Do NOT interact with [affected contracts]
- Monitor this channel for updates
- Reach out to mods if you have direct fund concerns

**Next update:** [TIME + 2h UTC]
```

**Internal Slack:**
```
@here Critical incident: [description]
CTO leading investigation. 
Update cadence: every 2h starting [TIME].
Comms handling external messaging.
```

#### T+2h to T+N: Ongoing Status Updates
**Cadence:** Every 2-4 hours until resolved  
**Format:** Short update in Discord announcement thread, quote-retweet on Twitter

**Status Update Template:**
```
**Update [#1] — [TIME UTC]**
- Investigation progress: [identify root cause / fix status]
- Impact scope: [affected users / funds]
- Estimated fix ETA: [time or "still determining"]
- Next update: [TIME + 2h]

*We know this is stressful. We're moving as fast as safely possible.*
```

#### T+resolved to T+24h: Fix Deployment & Validation
**Actions:**
- Deploy hotfix to testnet (public validation)
- CTO confirms fix resolves issue
- Deploy to mainnet
- Announce resolution in Discord + Twitter

**Resolution Announcement Template:**
```
**INCIDENT RESOLVED**

The issue has been fixed and deployed. [Component] is now [paused/running normally].

**What happened:** [1-2 sentence technical summary]
**Root cause:** [brief explanation]
**Impact:** [users affected / funds at risk] — none were lost
**Next steps:** Full postmortem in 48h. Security audit before full feature launch.

We apologize for the disruption. Your trust is critical to us.
```

#### T+24-48h: Postmortem
**Audience:** Internal + Public (transparent)  
**Format:** Blog post + Discord discussion

**Postmortem Template:**
```
# [Date] Incident Postmortem: [Feature Name]

## Timeline
- [TIME]: Issue detected by [method]
- [TIME]: Feature paused; investigation began
- [TIME]: Root cause identified
- [TIME]: Fix deployed and validated
- [TIME]: Incident declared resolved

## Root Cause
[Technical explanation of what went wrong]

## Impact
- Duration: [X minutes]
- Users affected: [X]
- Funds at risk: $0 (mitigation worked)

## Resolution
[How we fixed it]

## Prevention
[What we're changing to prevent this again]
- Enhanced contract testing (by [date])
- Security audit scope expanded (by [date])
- Monitoring alerts added (deployed [date])

## Lessons Learned
1. [Key insight]
2. [Key insight]

We're grateful for the community's patience and trust.
```

---

### SCENARIO 2: NPM Package Install Failures at Scale

**Severity Indicators:**
- `npm install` errors on new projects
- Critical dependency broken
- Registry connectivity issues
- Build failures affecting 50%+ of developers

**Timeline & Actions:**

#### T+0: Detection & Initial Diagnosis
**Goal:** Assess scope and communicate quickly

**Internal Slack:**
```
@here Package install issue detected.
Scope: [% of users affected, error message]
CTO diagnosing root cause. Quick update in 15 min.
```

**GitHub Release Discussion (if v1.0.0 release):**
```
⚠️ **Known Issue: Package Install Failing**

Some users are experiencing npm install errors with the latest version.

**Workaround:** 
[Include specific npm command or instructions]

**We're working on a fix and expect an update within [time].**

Affected? Please reply with your Node version + error message.
```

#### T+15min: Root Cause Identified

**If fixable in <1h:**
```
**GitHub Update:**
Fix identified. We're testing and expect a patch release in [time].

**Temporary workaround:**
[Include explicit steps]
```

**If rollback needed:**
```
**GitHub + Twitter:**
We've identified the issue in v1.0.1 and are rolling back to v1.0.0.
You may need to manually downgrade:
npm install holdfast-protocol@1.0.0

New release with fix coming in [time].
```

#### T+resolution: Release & Confirmation
**GitHub Release Notes:**
```
## v1.0.2 (Hotfix)

**Fixed:** Package install error from v1.0.1 ([#issue])
**Breaking changes:** None
**Action required:** `npm install holdfast-protocol@latest`

Apologies for the disruption. Thanks for your patience.
```

**Discord Announcement:**
```
✅ **Package Install Issue Fixed**

v1.0.2 is now live with the fix. Run:
\`\`\`
npm install holdfast-protocol@latest
\`\`\`

If you're still seeing issues, reply here with your error.
```

---

### SCENARIO 3: Community Support Overwhelmed (Discord/GitHub)

**Severity Indicators:**
- Discord receives 100+ messages/hour in support channels
- GitHub issues backlog > 50 unresponded
- Response time > 4 hours
- Mods burning out / escalations rising

**Timeline & Actions:**

#### Phase 1: Triage & Assess (T+0 to T+1h)

**Community Lead Checklist:**
- [ ] Count active support threads
- [ ] Identify if common theme (same bug, FAQ, wrong setup)
- [ ] Check mod capacity
- [ ] Determine if need to pull team members from other work

**Slack Update:**
```
@here Support surge detected.
Active threads: [#]. Common issues: [list top 3].
Activating triage protocol. CTO/CMO/Community on standby.
```

#### Phase 2: FAQ & Auto-Response (T+1h to T+4h)

**If 70%+ of questions are the same:**

**Discord Pinned Thread:**
```
📌 **COMMON QUESTIONS — Start Here**

**Q: [Most common question]**
A: [Answer]

**Q: [2nd most common]**
A: [Answer]

**Q: [3rd most common]**
A: [Answer]

**Still stuck?** Reply in #support and tag @support-mods
```

**Auto-response for new support threads:**
```
Thanks for reaching out! Before we jump in, check the pinned message above — 
your question might already be answered.

If not, please include:
- Node/npm version
- Error message (full output if possible)
- Steps to reproduce

We'll be with you shortly.
```

#### Phase 3: Resource Reallocation (if ongoing)

**CMO + CEO Decision:**
- Pull 1 engineer from non-critical work to support
- CMO writes FAQ blog post (deflect common questions)
- Enable trusted community members as temp mods

**Announcement in Discord:**
```
We're seeing a surge in questions — that's great! 
We've brought on extra support capacity and will be faster to respond going forward.
Thanks for your patience as we scale.
```

#### Phase 4: Follow-up (after surge clears)

**Blog Post (by CMO):**
- Address top 10 questions
- Link to docs/examples
- Reduce future support load

**GitHub Issues:**
- Add FAQ/duplicate tags
- Auto-close duplicates with link to master thread
- Improve docs based on most-asked questions

---

### SCENARIO 4: Website / Onboarding Down

**Severity Indicators:**
- `holdfast.dev` returns 5xx or timeouts
- Onboarding docs unreachable
- Developer guides offline
- Signup flow broken (if applicable)

**Timeline & Actions:**

#### T+0 to T+15min: Incident Announced

**Twitter:**
```
⚠️ We're aware that holdfast.dev is temporarily unavailable.
Our team is investigating. Most developers can still use the SDK directly — 
see workaround: [link to GitHub raw docs]
Updates every 15 min.
```

**Discord Announcement:**
```
🚨 **Website Temporarily Unavailable**

**What's down:** Documentation site (holdfast.dev)
**What still works:** NPM package, Discord, GitHub examples
**ETA to fix:** We're working on it

**In the meantime:**
- [Link to GitHub docs raw](https://raw.githubusercontent.com/...)
- [Quick start in pinned thread](Discord link)
- Questions? Ask in #support, we're monitoring closely
```

#### T+15min to T+resolution: Status Updates & Workarounds

**Manual Setup Guide (posted in Discord):**
```
**Getting Started Without the Website**

1. Install: npm install holdfast-protocol
2. Setup vault: [code snippet]
3. Initialize escrow: [code snippet]
4. Deploy: [CLI command]

Full examples: [GitHub repo]/examples

Stuck? Paste your error here.
```

**Status Updates (every 15 min):**
```
**Update [#2] — [TIME UTC]**
- Investigating hosting/DNS issue
- CDN status: [checking]
- Estimated fix: [time or "still determining"]
```

#### T+resolution: All-Clear

**Twitter + Discord:**
```
✅ **holdfast.dev is back online**
All systems operational. No data loss.
We apologize for the disruption.
```

**Post-Incident:**
- Add redundant CDN
- Document downtime process
- Update incident runbook

---

### SCENARIO 5: Negative Sentiment / Criticism Emerging

**Severity Indicators:**
- Critical tweets accumulating (10k+ mentions in 2 hours)
- "scam" / "rug pull" accusations appearing
- Major influencer/investor criticizing publicly
- Organized FUD campaign detected

**Assessment Framework:**

| Severity | Indicator | Response Owner | Action |
|----------|-----------|----------------|--------|
| **Low** | <100 mentions, isolated critic | CMO only | Document, monitor, do not engage publicly |
| **Medium** | 500-2k mentions, specific concern | CMO + CTO | Assess validity, draft response, get CEO approval |
| **High** | 2k+ mentions, emerging theme | CEO + CMO + CTO | Full response; potentially public statement |
| **Critical** | 10k+ mentions OR security audit failure claimed | CEO + Board | All-hands response; consider external comms firm |

#### Low Severity: Documentation & Monitoring
**CMO Action:**
```
Slack update:
Monitoring: [criticism description]
Validity: [legitimate concern / misinformation]
Plan: [ignore / monitor / respond privately if asked]
```

**When to engage:**
- User has legitimate concern + directly mentions you
- Question in comments (answer once, don't debate)
- Do NOT start arguments in replies

#### Medium Severity: Validate & Respond
**CMO + CTO Assessment (30 min):**
1. Is the criticism technically valid?
2. Is it a misunderstanding or real issue?
3. Can we address it without major changes?

**Draft Response Template:**
```
@[critic] Thanks for raising this. 

Here's what we're doing about [concern]:
[Specific action or explanation]

If you'd like to discuss further, DM us or join our Discord:
[link]

We appreciate the feedback.
```

**Get CEO Approval before posting.**

**Post Strategy:**
- Reply directly to the critique (one response, factual)
- Do NOT delete or block
- Offer to continue conversation privately
- Do NOT start quote-tweet wars

#### High Severity: Statement & Transparency
**CEO + CMO Decision:**
1. Is this a real issue we need to fix?
2. Is this misinformation we need to correct?
3. Do we need a public statement?

**If real issue:**
```
Twitter statement (CEO approval):
We're aware of concerns around [topic].
Here's what we're doing:
1. [Action]
2. [Action]
3. [Timeline]

Full transparency post coming [date].
```

**If misinformation:**
```
We've seen claims about [false claim].
Here are the facts:
- [Clarification]
- [Link to evidence]
- [Link to technical docs]

We're committed to trust through transparency.
```

**Follow-up:**
- Blog post with full context
- Technical walkthrough (if needed)
- AMA in Discord (if major concern)

#### Critical Severity: All-Hands Response
**CEO Decision Only:**
- May involve external communications firm
- Possible external audit to regain trust
- Full transparency report
- Consider pausing launch if needed to address

**Your role:** Execute CMO tasks (documentation, comms), escalate all strategic decisions to CEO.

---

## Post-Incident Process

### Immediate (24-48 hours)
- [ ] Incident declared resolved (public announcement)
- [ ] Postmortem published (if Scenario 1, 2, or 4)
- [ ] Lessons documented internally
- [ ] Crisis team debriefs (Slack thread)

### Short-term (1 week)
- [ ] Root cause fix deployed
- [ ] Monitoring/alerts added
- [ ] Docs updated to prevent repeat
- [ ] FAQ blog post live (if Scenario 3 or 5)

### Medium-term (30 days)
- [ ] All preventive measures implemented
- [ ] Runbook updated
- [ ] Crisis team training (if new scenario)
- [ ] Post-incident retro meeting

### Tracking
Keep a **Crisis Incident Log** (spreadsheet or GitHub project):
- Date
- Scenario type
- Root cause
- Resolution time
- Preventive measures
- Post-incident status

---

## Key Principles

1. **Speed > Perfection**
   - First communication within 15 min of detection
   - Frequent small updates > silence > massive delayed update
   - "We don't know yet" is acceptable

2. **Transparency Builds Trust**
   - Acknowledge the problem immediately
   - Share what you know, what you don't, and your plan
   - Admit mistakes; explain how you'll prevent repeat

3. **Community First**
   - Respond to affected developers before general comms
   - Empower mods and community members
   - Thank the community for patience

4. **CEO Approval Before External**
   - All Twitter/blog posts need CEO signoff
   - CMO can post operational Discord updates autonomously
   - When in doubt, escalate

5. **Clear Escalation**
   - Know when to involve CTO vs. CEO vs. both
   - Use #crisis-response Slack; don't DM chaos
   - Sync every 30-60 min during active incident

6. **Document Everything**
   - Crisis timeline goes in postmortem
   - Decisions captured for future reference
   - FAQs live forever in docs/blog

---

## Appendix: Contact Sheet

**Print this and keep on desk during launch week:**

```
CEOto: [Name] | [Email] | [Phone]
CTO: [Name] | [Email] | [Phone]
CMO (You): [Name] | [Email] | [Phone]
Community Lead: [Name] | [Email] | [Phone]

Crisis Slack: #crisis-response
Fallback: Group call (calendar link)

Monitoring Links:
- Twitter: [Search URL]
- Discord: [Invite link]
- GitHub: [Releases page]
- Website Health: [Status page]
```

---

**Document Version:** 1.0 DRAFT  
**Status:** Awaiting CEO Approval  
**Next Revision:** Post-Launch Review (72h)
