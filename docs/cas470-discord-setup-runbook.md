# CAS-470: Holdfast Protocol Discord Server — Setup Runbook

**Status**: Ready for manual execution  
**Prepared by**: Head of Growth (2026-04-24)  
**Purpose**: Step-by-step guide to launch the Holdfast Protocol developer community Discord

---

## 1. Server Creation

1. Log in to Discord with the Casemate Labs admin account (or a dedicated community account)
2. Click the `+` button in the server list → **Create My Own** → **For a club or community**
3. **Server name**: `Holdfast Protocol`
4. Upload server icon: use the Holdfast Protocol logo (or a placeholder until brand assets are final)
5. **Region**: US East (closest to Solana validator geography)

---

## 2. Channel Architecture

Create channels in this order. Channels marked `[READ-ONLY]` should be locked to `@everyone` with send-message permission disabled.

### Category: INFORMATION
| Channel | Purpose | Permissions |
|---|---|---|
| `#announcements` | Protocol updates, launch news, partnership announcements | `[READ-ONLY]` |
| `#resources` | Pinned integration guides, SDK docs, devnet quickstart links | `[READ-ONLY]` |
| `#protocol-health` | Devnet status, alert feed, uptime notices (bot-fed) | `[READ-ONLY]` |

### Category: COMMUNITY
| Channel | Purpose | Permissions |
|---|---|---|
| `#general` | Open community discussion | All members |
| `#introductions` | New member intros | All members |
| `#escrow-feedback` | Feedback on escrow mechanics, UX, protocol behaviour | All members |

### Category: DEVELOPER
| Channel | Purpose | Permissions |
|---|---|---|
| `#dev-support` | Technical integration questions, SDK help | All members |
| `#integration-help` | Hands-on help — ElizaOS, Solana Agent Kit, direct SDK | All members |
| `#builders-showcase` | Share what you're building with Holdfast Protocol | All members |

### Category: ADMIN (Private)
| Channel | Purpose | Permissions |
|---|---|---|
| `#team-internal` | Casemate Labs team only | `@Admin` role only |
| `#mod-log` | Auto-mod action log (MEE6/Dyno output) | `@Admin` + `@Moderator` |

---

## 3. Roles

Create these roles in order (highest → lowest):

| Role | Color | Purpose | How Assigned |
|---|---|---|---|
| `@Admin` | Red | Casemate Labs team | Manual — assign to team accounts |
| `@Moderator` | Orange | Community mods | Manual |
| `@Builder` | Green | Verified integrators | Collab.Land or manual verification |
| `@Member` | Default | All verified humans | MEE6 welcome flow auto-assign |

---

## 4. Discord Community Status

**Why**: Unlocks announcement channels, membership screening, welcome screen, and Community Discovery eligibility.

**Steps**:
1. **Server Settings** → **Enable Community** (in left sidebar)
2. Complete the checklist:
   - ✅ Verified email on Discord account
   - ✅ Rules/Guidelines channel — create `#rules` if not already present
   - ✅ Explicit media content filter — set to **Scan media content from all members**
   - ✅ Membership screening — enable and set entry questions (see below)
3. Submit and wait for Discord review (usually instant for new servers)

**Membership Screening Questions** (set in Community settings):
- "What are you building or planning to build with Holdfast Protocol?"
- "How did you find the Holdfast Protocol community?"

**Welcome Screen** (configure in Community settings):
- Welcome message: `Welcome to Holdfast Protocol — trust infrastructure for AI agents on Solana. Whether you're integrating the SDK, building with ElizaOS, or exploring the protocol, you're in the right place.`
- Featured channels: `#announcements`, `#dev-support`, `#resources`

---

## 5. Bot Setup

### 5a. MEE6 (Primary Moderation Bot)

1. Go to [mee6.xyz](https://mee6.xyz) → **Add to Discord** → select Holdfast Protocol server
2. Configure in MEE6 Dashboard:
   - **Welcome Plugin**: send welcome DM linking to `#resources` and `#dev-support`
   - **Auto-Moderator**: enable anti-spam, anti-invite-link (except whitelisted Holdfast links), anti-profanity (light filter)
   - **Role on Join**: assign `@Member` automatically on join
   - **Leveling**: optional — can enable later if community engagement warrants it

### 5b. Collab.Land (Future Token-Gating)

1. Go to [collab.land](https://collab.land) → **Add to Discord** → select server
2. **Note**: No token-gating rules needed at devnet stage. Install now for future use.
3. Configure: point Collab.Land to `@Builder` role as the gated role (for when applicable)
4. Create `#collabland-join` channel (hidden from `@everyone` view — Collab.Land uses this internally)

### 5c. Devnet Alert Bot (BUILT — CAS-473 complete)

- **Status**: ✅ Built and ready. See [CAS-473](/CAS/issues/CAS-473).
- **Code location**: `holdfast/alert-bot/` (TypeScript webhook poller service)
- **Target channel**: `#protocol-health`
- **What it monitors**: indexer health (60s), escrow anomalies (60s), oracle liveness (5min), program hash verification (10min), RPC slot lag (5min). Recovery alerts sent when checks return healthy.
- **Activation steps** (webhook-only — no bot token needed):
  1. In Discord: go to `#protocol-health` channel settings → **Integrations** → **Webhooks** → **New Webhook**
  2. Copy the webhook URL
  3. On the alert-bot host: `cp holdfast/alert-bot/.env.example holdfast/alert-bot/.env`
  4. Set `DISCORD_WEBHOOK_URL=<paste webhook URL>` in that `.env`
  5. Run: `cd holdfast/alert-bot && npm install && npm start`

---

## 6. Initial Channel Seeds

After launching, seed each channel with pinned content:

**#resources** (pin all):
- Quickstart: `https://holdfastprotocol.com/docs/quickstart`
- Integration Guide: `https://holdfastprotocol.com/docs/integration-guide`
- SDK README: `https://github.com/casematelabs/holdfastprotocol`
- ElizaOS Integration Guide: `holdfast/docs/elizaos-integration-guide.md` (link to published version)
- SAK Integration Guide: `holdfast/docs/sak-integration-guide.md` (link to published version)

**#dev-support** (pin):
- "Before asking for help, check #resources for the quickstart and integration guides. For bugs, please share your SDK version, error message, and relevant code snippet."

**#announcements** (first post — see Section 7):

---

## 7. Launch Announcement Copy

Post in `#announcements` after server is live. Cross-post on X/Twitter.

---

```
🔐 Holdfast Protocol is now on Discord.

We're building trust infrastructure for AI agents on Solana — and we want builders here from day one.

Join to:
→ Get integration support (ElizaOS, Solana Agent Kit, direct SDK)
→ Follow devnet status and protocol health
→ Give feedback on escrow mechanics and UX
→ Share what you're building

We're in devnet. Early builders shape the protocol.

📖 Docs: [holdfastprotocol.com/docs]
⚡ Quickstart: [holdfastprotocol.com/docs/quickstart]
🐙 GitHub: github.com/casematelabs/holdfastprotocol

Drop a note in #introductions — tell us what you're building.
```

---

**X/Twitter thread to accompany Discord launch** (3 posts):

> **Post 1**: We've opened the Holdfast Protocol Discord — the developer community for trust infrastructure on Solana. Builders, integrators, and protocol-curious: come in. [Discord link]
>
> **Post 2**: What you'll find inside: integration support for @ElizaOS and @SolanaAgentKit, devnet status alerts, escrow feedback channel, and a #builders-showcase for sharing what you're building with Holdfast Protocol.
>
> **Post 3**: We're devnet. Early builders shape what mainnet looks like. Docs at holdfastprotocol.com/docs — see you inside.

---

## 8. Apply for Discord Partner Program (Later)

After community reaches ~100 members and regular activity:
- [discord.com/partners](https://discord.com/partners)
- Requirements: 500+ members, consistent activity, quality content — target this 60-90 days post-launch

---

## 9. Handoff Checklist

- [ ] Server created and named "Holdfast Protocol"
- [ ] All channels created per Section 2
- [ ] Roles created and assigned to team per Section 3
- [ ] Community status enabled per Section 4
- [ ] MEE6 installed and configured per Section 5a
- [ ] Collab.Land installed per Section 5b
- [x] CTO devnet alert bot built — [CAS-473](/CAS/issues/CAS-473) ✅ (activate via webhook URL in `.env`)
- [ ] Resources channel seeded with pinned links
- [ ] Launch announcement posted in #announcements
- [ ] X/Twitter thread posted
- [ ] Discord server invite link added to holdfastprotocol.com footer/docs

---

*Prepared for CAS-470. Updated by Head of Growth — Casemate Labs.*
