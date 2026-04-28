# Holdfast Protocol — AI Agent Conference NYC Speaker Pitch Deck
## "Trust Infrastructure for Autonomous AI Agents"

**Conference:** AI Agent Conference NYC — Agentic Engineering Track
**Format:** 5-minute lightning talk
**Date:** May 4–5, 2026 | New York Hilton Midtown
**Prepared by:** Head of Growth | CAS-296
**Status:** DRAFT — for CEO review by April 30, 2026
**Final deck due:** May 2, 2026

> **Branding note:** All slides use Holdfast Protocol identity — dark background (#0D1117), primary accent (#14F195 Solana green), secondary accent (#9945FF Solana purple), monospace font for code, Inter/Geist for body copy. Casemate Labs wordmark in footer of every slide. Deck master to be produced in Google Slides from this content.

---

## Slide 1 — Title

### Visual
- Full-bleed dark background
- Holdfast Protocol logotype centred, large
- Tagline below: **"Trust infrastructure for autonomous AI agents on Solana."**
- Bottom strip: AI Agent Conference NYC • May 4-5, 2026 • Casemate Labs

### Slide text
```
Holdfast Protocol

Trust infrastructure for autonomous AI agents on Solana.

────────────────────────────────────────────
AI Agent Conference NYC  ·  May 4–5, 2026
Casemate Labs  ·  holdfastprotocol.com
```

### Speaker Notes
> Open with a beat of silence. Let the slide breathe.
>
> "Today I'm going to show you the missing accountability layer for the agent economy. Five minutes. Three primitives. One devnet you can use today."
>
> Pace: slow, confident. Do not rush the title slide — it sets the register for the whole talk. Stay on it for 5–8 seconds before advancing.

---

## Slide 2 — The Problem

### Visual
- Split layout: left column = problem statement; right column = illustration (agent icon connected to SOL/USD flow, with a question mark over it)
- Red accent on the core tension phrase

### Slide text
```
Agents are moving real money.
There is no standard for what happens
when they go wrong.

  ▸ AI agents executing transactions autonomously
  ▸ Signing transactions with software keys in .env files
  ▸ No verifiable identity
  ▸ No on-chain track record
  ▸ No enforceable consequences for failure
```

### Speaker Notes
> "AI agents are executing transactions, managing funds, and settling contracts without human intervention right now. The Colosseum AI hackathon alone produced 21,000 agents in February. These agents are making real decisions with real money."
>
> "But the infrastructure they run on was never designed for this. Agents authenticate with software keys stored in environment variables. One compromised service and your agent's signing key is gone. There's no standard for 'who is this agent', 'can it be trusted', or 'what happens if it cheats.'"
>
> "That's not a small gap. That's the missing accountability layer for the entire agent economy."

---

## Slide 3 — The Trust Gap (What's Missing)

### Visual
- Three-column layout, each column a "gap" card in dark tile style
- Gaps: Identity / Reputation / Enforcement
- Each card has an icon (key, chart, lock) and a single line stating the unsolved problem

### Slide text
```
The trust gap has three parts:

┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   IDENTITY      │  │   REPUTATION    │  │   ENFORCEMENT   │
│                 │  │                 │  │                 │
│ Who is this     │  │ Has this agent  │  │ What happens    │
│ agent, really?  │  │ behaved before? │  │ when it fails?  │
│                 │  │                 │  │                 │
│ Software keys   │  │ No on-chain     │  │ No programmable │
│ can be copied.  │  │ track record.   │  │ settlement.     │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### Speaker Notes
> "The trust gap is actually three problems layered on top of each other."
>
> "First: identity. A software key tells you nothing about whether an agent can be trusted — it can be copied, stolen, or spoofed."
>
> "Second: reputation. There's no on-chain track record. You can't know whether the agent you're about to trust has ever successfully completed anything before."
>
> "Third: enforcement. Even if you could verify identity and reputation, there's no programmable settlement layer — no way to lock funds, define release conditions, and resolve disputes with on-chain finality."
>
> "Holdfast Protocol solves all three."

---

## Slide 4 — Introducing Holdfast Protocol

### Visual
- Dark card with Holdfast Protocol logotype top-left
- Three primitive icons in a horizontal row with connecting arrows: Identity → Reputation → Escrow
- Subtitle: "Three composable primitives. Native on Solana."
- Bottom badge: "Devnet live"

### Slide text
```
Holdfast Protocol

Three composable primitives for AI agent trust.
Native on Solana.

  [ Identity ]  →  [ Reputation ]  →  [ Escrow ]

Hardware-attested    On-chain oracle      Programmable
agent identities     (CPI-readable)       settlement

──────────────────────────────────────────────────────
Devnet live  ·  npm install @holdfastprotocol/sdk@devnet
```

### Speaker Notes
> "Holdfast Protocol is trust infrastructure for autonomous AI agents on Solana. It gives autonomous agents three things they've never had before: a verifiable identity, an on-chain reputation score, and a programmable escrow contract they cannot break."
>
> "Each primitive is independent but composable. You can read an agent's reputation before accepting any pact. You can gate escrow creation on a minimum reputation score. The chain enforces it, not a centralized service."
>
> "All three are live on devnet today."
>
> Advance quickly to the next slide — you have 5 minutes total. Don't linger on overview.

---

## Slide 5 — Primitive 1: Identity

### Visual
- Dark tile with key/hardware security icon
- Left: code block showing registration call
- Right: diagram: P-256 key → secp256r1 precompile → AgentWallet PDA (Solana)

### Slide text
```
Identity
Hardware-attested agent identities on Solana.

  Agent generates a secp256r1 (P-256) keypair
  ↓
  Same primitive: hardware security keys, Apple Secure Enclave, WebAuthn
  ↓
  Holdfast Protocol anchors this key on-chain via Solana's native
  secp256r1 precompile (SIMD-48)
  ↓
  AgentWallet PDA — permanently on-chain, verifiable by anyone

  "Not a software key in an .env file.
   A hardware-bound identity on Solana."
```

### Speaker Notes
> "The identity primitive uses secp256r1 — P-256 — the same elliptic curve used by hardware security keys, Apple Secure Enclave, and WebAuthn. This is a hardware-rootable key. It can't be trivially copied."
>
> "When an agent registers with Holdfast Protocol, it generates a P-256 keypair and proves possession on-chain using Solana's native secp256r1 precompile — SIMD-48. That's an instruction-level primitive, not a smart contract. The attestation is verified in the same instruction as the program execution. No separate round-trip."
>
> "Full TPM and TEE hardware attestation — integrating with our Hardline Protocol — is on the roadmap. What's live today is secp256r1 self-attestation. It's already meaningfully stronger than any software key."
>
> Time check: you should be at ~1:20 on the clock here.

---

## Slide 6 — Primitive 2: Reputation

### Visual
- Reputation score gauge graphic (0–10000bp, needle at 5200)
- Timeline showing score updates as on-chain transactions
- CPI icon: "Any Solana program can read this"

### Slide text
```
Reputation
On-chain reputation oracle.

  Score: 0 – 10,000 basis points  (5,000 = neutral)
  ↓ Updated by: the protocol escrow program (not a human)
  ↓ Every pact outcome posted on-chain: fulfilled or disputed
  ↓ Score decays lazily toward neutral when inactive

  Readable by any Solana program via CPI — one account read.
  No oracle fee. No bridge. No trust assumption.

  const ok = await client.reputation.meetsRequirements(agentPubkey, {
    minScore: 6000,
    minTier: VerifTier.Attested,
    minPacts: 3,
  });
```

### Speaker Notes
> "The reputation primitive is an on-chain oracle with a simple, auditable design. Scores run from 0 to 10,000 basis points — 5,000 is neutral. Every time an agent fulfills or disputes a pact, the escrow settlement program — a program PDA, not a human — posts a signed reputation update."
>
> "There's no centralized reputation manipulation possible. The oracle authority is a program account. The whole history is on-chain, auditable by anyone."
>
> "The killer feature: because the reputation account is a PDA, any other Solana program can read it via CPI. One account read. No oracle fee, no bridge, no cross-chain message. If your DeFi protocol wants to gate agent access based on reputation score, that's a single line of code."
>
> "Scores decay lazily toward neutral when an agent is inactive — a simple, transparent design choice to prevent permanent reputation from stale accounts."

---

## Slide 7 — Primitive 3: Escrow

### Visual
- Lifecycle diagram: Create Pact → Fund → Release → [Dispute] → Resolve
- Lock icon with SOL amount
- Timeline showing dispute window countdown

### Slide text
```
Escrow
Programmable settlement for AI agent commerce.

  Task-based, milestone-gated, or time-locked release conditions.
  Funds lock at pact initiation.
  Release opens a 7-day dispute window.
  Disputes trigger arbiter resolution with on-chain finality.

  Reputation gating built in:
  ↓ Pre-flight checks counterparty score before any funds move
  ↓ If threshold not met → ReputationThresholdNotMet error
     (before fees, before commitment)

  "The agent can't just walk away.
   The chain holds it accountable."
```

### Speaker Notes
> "The escrow primitive is programmable settlement. You define release conditions at creation time: task-based, milestone-gated, or time-locked. Funds lock at pact initiation. When the condition is met, releasing a pact opens a dispute window before final settlement."
>
> "The three primitives compose naturally. When you create a pact, you can require a minimum reputation threshold for the counterparty. The SDK runs a pre-flight check before the transaction hits the chain — if the counterparty doesn't qualify, you get a clean error before any fees are paid."
>
> "The dispute path has on-chain finality. An arbiter — a multisig or another program — resolves disputes and the outcome posts back to the reputation oracle. Bad behavior has real, on-chain consequences."
>
> Time check: you should be at about ~2:30 on the clock here.

---

## Slide 8 — Why Solana

### Visual
- Side-by-side comparison: EVM-based attestation vs Holdfast Protocol on Solana
- Highlighted stats: "~400ms finality" / "<$0.001 per tx" / "Native secp256r1 precompile"

### Slide text
```
Why Solana — not EVM?

  EVM (EAS, forks)          │  Holdfast Protocol on Solana
  ──────────────────────────┼──────────────────────────────
  Cross-contract call        │  Same instruction as execution
  EVM gas per verification   │  Sub-cent per operation
  12-second block time       │  ~400ms finality
  Bridge required for        │  Native-CPI composability
  non-EVM agents             │  from day one

  Agents running hundreds of transactions per hour:
  EVM gas costs compound. Solana costs do not.

  Solana's secp256r1 precompile (SIMD-48):
  attestation verified at the instruction level — no oracle hop.
```

### Speaker Notes
> "Why Solana? Two reasons: cost and composability."
>
> "EAS and its EVM derivatives are general-purpose attestation layered on Ethereum. They work — but the design shows it. Attestation records are separate from the execution environment. Verification requires cross-contract calls with EVM gas overhead. At 12-second block times and real gas costs, that's a real constraint for agent economies."
>
> "Holdfast Protocol is Solana-native. The secp256r1 precompile is an instruction-level primitive — attestation is verified in the same instruction as the program call. Transaction finality is ~400ms at a fraction of a cent. For agents signing dozens of transactions per hour, that cost difference compounds quickly."
>
> "And the composability story: any Solana program can read agent reputation via a single CPI account read. No oracle fee, no bridge, no cross-chain message. That means the Solana DeFi and agent ecosystem can integrate Holdfast Protocol from day one."

---

## Slide 9 — Live Demo

### Visual
- Full-bleed slide with demo video embed (or QR code if live video embed not possible in slides format)
- Terminal output overlay showing the three-stage demo flow
- Small disclaimer banner at bottom: "Pre-audit software. Devnet only."

### Slide text
```
Live Devnet Demo

  Stage 1: Register agent wallet
  → Generate secp256r1 keypair
  → registerAgentWallet tx confirmed on Solana devnet

  Stage 2: Oracle reputation update
  → initReputation (score: 5000 bp, neutral)
  → updateReputation +200bp after fulfilled pact
  → Score: 5200 / 10000 on-chain

  Stage 3: SDK attestation query
  → client.reputation.get(agentPubkey)
  → Clean attestation report: score, tier, history

  [ WATCH DEMO — 4 min ]   →  [ link / QR ]

  ⚠  Pre-audit software. Devnet only. Not for production.
```

### Speaker Notes
> "Let me show you what this looks like in practice. This is a real Solana devnet run — not a simulation."
>
> [If showing live demo video]: "We're going to watch a 90-second clip. Watch for three moments: the registerAgentWallet transaction landing in a real Solana block, the oracle reputation update with the score ticking from 5000 to 5200, and the SDK query returning a clean attestation report."
>
> [If not playing video, advance through slides quickly]: "The full demo is available at the QR code — I'd encourage you to run it yourself. It takes about 5 minutes from npm install to your first on-chain agent registration."
>
> "Everything you see is live on devnet. Program ID is in the explorer. The SDK is on npm right now."
>
> Note: Coordinate with Video Editor agent to have demo video ready by April 28. Embed as a linked thumbnail or QR code pointing to the hosted video. Do NOT attempt to autoplay embedded video — use a still frame + QR code as fallback.
>
> Time check: you should be at ~3:30 on the clock here.

---

## Slide 10 — Current State

### Visual
- Status table with green/yellow/grey indicators
- Operator dashboard screenshot (small, bottom right)
- "Devnet live" badge prominent

### Slide text
```
What's live today:

  ✅  Reputation read/write on devnet
  ✅  Escrow create / fund / release on devnet
  ✅  secp256r1 self-attestation (localnet confirmed; devnet precompile active, program redeployment in progress)
  ✅  @holdfastprotocol/sdk@0.2.0-devnet.1 published to npm
  ✅  Operator dashboard (devnet) — reputation, escrow, custody views
  ✅  Off-chain indexer deployed (indexer.devnet.holdfastprotocol.com)

  🔜  Hardware TPM / TEE attestation (Hardline cross-CPI) — Q4 2026
  🔜  Mainnet deployment — after external security audit (in progress)
  🔜  Protocol fees on production usage

  No token. Revenue: protocol fees on real usage.
```

### Speaker Notes
> "Here's exactly what's live and what's not — no overclaiming."
>
> "The SDK is published. The programs are on devnet. The operator dashboard is running. You can install, connect a devnet wallet, register an agent identity, and read your reputation score today."
>
> "What's not live: full hardware TPM/TEE attestation — that requires our Hardline Protocol cross-CPI integration, which is roadmap for Q4. Mainnet deployment is gated on the external security audit, which is in progress now."
>
> "No token. The business model is protocol fees on real usage — registrations, escrow settlements. That's the plan when mainnet launches."
>
> "We're telling you exactly what's done and what isn't. That's the kind of team you want to build on."

---

## Slide 11 — Competitive Differentiation

### Visual
- Comparison table: three columns (Holdfast Protocol, EAS/forks, Vouch, Warden)
- Key differentiators highlighted in green
- Bottom quote in large type

### Slide text
```
How we're different:

                    Holdfast      EAS/forks    Vouch        Warden
  ─────────────────────────────────────────────────────────────────
  On-chain          ✅ Solana     ✅ EVM        ❌ Off-chain  Partial
  enforcement
  Hardware          ✅ P-256/     ❌            ❌ SSH/       ✅ MPC
  attestation       TPM roadmap               Ed25519
  Reputation        ✅ On-chain   ❌            Social graph  ❌
  oracle            CPI-readable
  Programmable      ✅ Escrow     ❌            ❌            Partial
  settlement        + dispute
  Solana-native     ✅            ❌            ❌            ❌
  AI agent focus    ✅            General       IdP/DevOps    Enterprise

  "They built the badge. We built the vault."
```

### Speaker Notes
> "There are three names you'll hear compared to us: EAS, Vouch, and Warden."
>
> "EAS is general-purpose attestation on EVM. It's not designed for AI agent use cases, it's not on Solana, and it has no escrow or financial enforcement. Different product."
>
> "Vouch is an off-chain identity tool. Python library, SSH keys, Git commit signing, DIDs. It gives an agent a verified ID badge. It cannot hold assets, slash stake, or resolve a dispute. We actually see Vouch as a potential integration partner — a Vouch DID could feed a Holdfast Protocol agent registration. If you're talking to their team here, tell them we want to connect."
>
> "Warden does enterprise MPC key management. Useful for custodying keys. Not designed for on-chain agent trust or AI agent commerce."
>
> "Our moat: Solana-native hardware attestation, on-chain reputation, and programmable escrow in a single composable stack. No one else is doing that."

---

## Slide 12 — Ecosystem Fit

### Visual
- Ecosystem map with Holdfast Protocol at the centre, spokes to: ElizaOS, Solana Agent Kit, Olas, Jupiter, Drift, Phantom/Backpack
- Each integration labeled with the value proposition

### Slide text
```
Built for the Solana AI agent ecosystem:

  Agent Frameworks
  ├─ ElizaOS          → Holdfast plugin: agent identity + escrow
  ├─ Solana Agent Kit → Native Holdfast Protocol actions
  └─ Olas / Autonolas → Attestation for autonomous services

  DeFi Protocols
  ├─ Jupiter          → Agent-gated routing limits (reputation check)
  ├─ Drift            → Agent identity + risk attestation for perps
  └─ Jito             → Validator-side agent trust

  Wallet Providers
  └─ Phantom / Backpack / Solflare → Wallet adapter integration

  "If your protocol uses agents, Holdfast Protocol
   is the accountability layer you're missing."
```

### Speaker Notes
> "We're building for the Solana AI agent ecosystem, not against it."
>
> "We have integration proposals in progress with ElizaOS and Solana Agent Kit — both of which allow any agent running on those frameworks to register with Holdfast Protocol in a single SDK call. We want to talk to the teams here this week."
>
> "Olas / Autonolas is on our integration roadmap as a planned integration target — we have a detailed proposal drafted but have not yet started formal conversations with their team. If you see the Olas or Valory team here, say: 'Olas is a protocol we're actively pursuing for integration — we'd love to connect.' Do not say 'we're working with Olas' or imply an active partnership."
>
> "For DeFi protocols: if you're allowing agents to execute trades or manage positions on your platform, Holdfast Protocol's reputation oracle is a CPI call away. You can gate agent access to high-risk operations on a minimum reputation score before any funds move."
>
> "We're here specifically to meet builders. If you're in the agent framework or DeFi protocol space and you need an accountability layer, we want to work with you before mainnet."

---

## Slide 13 — Call to Action

### Visual
- High contrast, clean slide — dark background, white text
- Large npm install command, prominent
- Three CTAs in equal columns
- QR code to holdfastprotocol.com / npm package

### Slide text
```
Build with Holdfast Protocol today.

  npm install @holdfastprotocol/sdk@devnet

  ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
  │  Try the SDK         │  │  Partner with us     │  │  Follow for mainnet  │
  │                      │  │                      │  │                      │
  │  devnet · no token   │  │  ElizaOS · SAK ·     │  │  Audit in progress   │
  │  no mainnet risk     │  │  DeFi protocols       │  │  Mainnet post-audit  │
  │                      │  │                      │  │                      │
  │  holdfastprotocol    │  │  Talk to us today    │  │  @CasemateLabs       │
  │  .com/docs           │  │  at the conference   │  │  for updates         │
  └──────────────────────┘  └──────────────────────┘  └──────────────────────┘

  [ QR code ]  holdfastprotocol.com
```

### Speaker Notes
> "Three things I want you to do in the next 48 hours."
>
> "One: install the SDK. It's `npm install @holdfastprotocol/sdk@devnet`. It connects to devnet. There's no mainnet risk. Register an agent identity. Query a reputation score. Tell us what's broken."
>
> "Two: if you're building an agent framework or a DeFi protocol that uses agents, come find us at the conference. We're actively looking for integration partners before mainnet. That's an opportunity to shape the standard."
>
> "Three: follow @CasemateLabs for the audit timeline and mainnet launch. The audit is in progress. When it's done, this goes to mainnet. You want to be building on it before that happens."
>
> "The programs are live. The SDK is published. Devnet is open. The accountability layer for the agent economy — let's build it together."
>
> Time check: you should be at exactly 5:00 here. End on this slide.

---

## Slide 14 — Q&A / Contact

### Visual
- Minimal — logotype centred, contact details
- Soft Holdfast Protocol branded background

### Slide text
```
Holdfast Protocol
Trust infrastructure for autonomous AI agents on Solana.

  Casemate Labs
  holdfastprotocol.com
  @CasemateLabs
  npm: @holdfastprotocol/sdk@devnet

  ⚠  Pre-audit software. Devnet only.
     Not for mainnet or production use.
     External security audit in progress.

  Questions?
```

### Speaker Notes
> Q&A slide — no scripted notes. Stay confident and technical. Key anticipated questions:
>
> **"How is this different from Vouch?"**
> → "Vouch is an off-chain identity tool — it signs Git commits and issues DIDs. It has zero on-chain enforcement capability. No escrow, no dispute resolution, no financial consequences. We're the enforcement layer, not the badge layer. They actually complement each other."
>
> **"Why not use EAS on Ethereum?"**
> → "EAS is general-purpose attestation on EVM. Not designed for AI agents, not on Solana, no escrow or financial enforcement. And EVM gas costs at scale are a real constraint for agent economies running hundreds of transactions per hour."
>
> **"When is mainnet?"**
> → "After the external audit completes. We're not setting a hard date because that's the honest answer — audit timeline drives mainnet timing. We'd rather ship a secure product than a fast one."
>
> **"Is there a token?"**
> → "No token. Revenue model is protocol fees on real usage — registrations, escrow settlements. That's the plan when mainnet launches."
>
> **"Can I use this with ElizaOS / Solana Agent Kit?"**
> → "Integration proposals are in progress. Come find us at the conference if you're building on those frameworks."

---

## Deck Production Checklist

Before sending to CEO for review (by April 30):

- [ ] Google Slides master created from this content
- [ ] Holdfast Protocol brand colors applied: #0D1117 bg, #14F195 accent, #9945FF secondary
- [ ] Inter / Geist font used for body copy; monospace font for all code blocks
- [ ] Casemate Labs wordmark in footer of every slide
- [ ] Disclaimer banner on Slide 9 (demo slide) and Slide 14 (Q&A): "Pre-audit software. Devnet only."
- [ ] Demo video embed / QR code on Slide 9 — coordinate with Video Editor agent (target: video ready by April 28)
- [ ] Program IDs and npm version confirmed accurate with CTO before final deck
- [ ] PDF export ready for conference distribution
- [ ] Speaker notes printed / available on second screen during talk

## Coordination Notes

| Item | Owner | Due |
|------|-------|-----|
| Demo video (4-min devnet walkthrough) | Video Editor agent | April 28 |
| Program ID verification (Slide 9) | CTO | April 27 |
| SDK version confirmation (Slide 10) | Backend Engineer | April 27 |
| CEO review of full deck | CEO | April 30 |
| Google Slides production | Head of Growth | April 30 |
| Final PDF export | Head of Growth | May 2 |

---

*Prepared by Head of Growth — CAS-296 — 2026-04-22*
