# AI Agent Conference NYC — Conference Prep Materials

**CAS-131** | May 4-5, 2026 | New York Hilton Midtown
**Status:** Speaker proposal submitted (Apr 21). Prep in progress. Board confirmation on availability pending.

---

## 1. Lightning Talk — Speaker Submission Draft

**Title:** Trust Infrastructure for Autonomous AI Agents: On-Chain Commitments for Credible Agent Behavior

**Track:** Agentic Engineering

**Format:** 5-minute lightning talk

**Abstract (for submission):**

> AI agents are executing transactions, managing funds, and settling contracts without human oversight. But the infrastructure they run on has no standard for proving who an agent is, whether it can be trusted, or how to resolve disputes when things go wrong. This talk introduces Holdfast Protocol — trust infrastructure for autonomous AI agents on Solana. We cover three composable primitives: hardware-attested agent identities using secp256r1/FIDO2-compatible keys, an on-chain reputation oracle with tamper-resistant scoring, and programmable escrow for task-based, milestone-gated settlement. All verifiable on-chain. All composable. All live on devnet today. SDK available at holdfastprotocol.com.

**5-Minute Structure:**

| Time | Content |
|------|---------|
| 0:00–0:45 | The trust gap: agents are making real decisions with real money, but there is no standard for verifying who they are or holding them accountable |
| 0:45–2:00 | Holdfast Protocol's three primitives: hardware-attested identity, on-chain reputation oracle, programmable escrow |
| 2:00–3:15 | Why Solana: 400ms finality, sub-cent txs, native secp256r1 precompile — attestation in the same instruction as program execution, not a separate oracle hop |
| 3:15–4:15 | Live devnet demo: register an agent identity, read reputation score, settle a pact — one SDK call each |
| 4:15–5:00 | What we need: integrators, ecosystem partners, early adopters — `npm install @holdfastprotocol/sdk@devnet` |

**Speaker bio (for submission):**

> Casemate Labs builds security infrastructure on Solana. Our two protocols — Hardline (hardware-attested human wallet security) and Holdfast Protocol (trust infrastructure for autonomous AI agents) — share a common design philosophy: cryptographic proof over social attestation. Holdfast Protocol devnet is live. We are looking for agent framework builders to integrate in Q2 2026 ahead of mainnet.

---

## 2. Holdfast Protocol One-Pager (Leave-Behind)

*Print-ready content — layout TBD. Keep under 1 page.*

---

### Holdfast Protocol

**Trust infrastructure for autonomous AI agents on Solana.**

AI agents are settling contracts and managing funds autonomously. Without trust infrastructure, there is no standard way to verify who an agent is, whether it can be trusted, or how to resolve disputes. Holdfast Protocol fixes this.

**Three composable primitives on Solana:**

**Identity** — Hardware-attested agent identities using secp256r1 (FIDO2-compatible) keys. Agents prove key possession on-chain via Solana's native secp256r1 precompile. Full TPM/TEE attestation (integrating with Hardline Protocol) on roadmap.

**Reputation** — On-chain reputation oracle. Every fulfilled or disputed pact posts a signed, tamper-resistant reputation update. Scores are queryable via CPI by any Solana program. No trust assumptions — the chain is the record.

**Escrow** — Programmable settlement contracts. Task-based, milestone-gated, and time-locked. Funds lock at pact initiation. Dispute resolution has on-chain finality.

**Why Solana:**
- ~400ms finality, sub-cent transactions
- Attestation verified natively — same instruction as program execution, no oracle hop
- Any program queries agent reputation with a single CPI account read
- Composable with the Solana DeFi and agent ecosystem from day one

**vs. EAS:** EVM-based, general-purpose attestation. Separate from execution environment. EVM gas costs on every verification. Not designed for AI agent use cases.

**What about Vouch Protocol?** Different layer entirely. Vouch is an off-chain identity tool — SSH key signing, Git commit attestation, DIDs. It gives an agent a verified ID badge. Holdfast Protocol gives that agent a wallet, an on-chain track record, and a contract it cannot break. *"They built the badge. We built the vault."* They are complementary — a Vouch DID could feed a Holdfast Protocol agent registration. We do not compete for the same use case.

**Status:** Devnet live. `@holdfastprotocol/sdk@0.1.0-devnet.1` published. Programs on Solana devnet. External audit in progress ahead of mainnet.

**Integrate:**
```bash
npm install @holdfastprotocol/sdk@devnet @solana/web3.js
```

**Contact:** holdfastprotocol.com | Casemate Labs | [@CasemateLabs]

---

## 3. Target Attendee List

Priority targets for in-person outreach at the conference and AI Agent Week (May 4-8).

### Tier 1 — SDK Integration Targets

| Team | Contact / Handle | Integration Ask | Notes |
|------|-----------------|-----------------|-------|
| ElizaOS / ai16z | @shawmakesmagic (Shaw), @ai16zdao | Holdfast Protocol plugin for ElizaOS agent identity + escrow | CAS-129 outreach in progress; in-person = high-value follow-up |
| Solana Agent Kit (Sendai) | @sendaifun | Native Holdfast Protocol support in SAK | CAS-133 integration proposal drafted |
| Olas / Autonolas | @daviddavid_, @SvemirskiI | Holdfast Protocol attestation for Olas autonomous services | CAS-130 partnership proposal in progress |

### Tier 2 — DeFi Protocol Targets (Agent Users)

| Protocol | Relevance | Ask |
|----------|----------|-----|
| Jupiter | Agents routing swaps — Holdfast Protocol attestation for agent-gated trade limits | Partnership conversation |
| Drift Protocol | Perpetuals with agent trading — agent identity and risk attestation | Integration discussion |
| Jito | MEV / block engine — agent attestation for validator-side trust | Ecosystem partnership |

### Tier 3 — Competitive Recon

| Target | Notes |
|--------|-------|
| Vouch Protocol | Likely attending. **Reframe from competitor to potential partner.** Vouch = off-chain identity/IdP (Python, SSH, Git signing, DIDs). Holdfast Protocol = on-chain enforcement (escrow, reputation, financial consequences). Different layers. Approach them for a conversation — a Vouch x Holdfast Protocol complementarity story is strong. Do not position them as competition in public. |
| EAS representatives | Monitor any Solana expansion plans. Note any agent-focused messaging. |
| Warden Protocol | Enterprise MPC key management. Note any AI agent positioning. |

### Tier 4 — Ecosystem Builders / Colosseum Network

The Solana AI Agent Hackathon (Colosseum, Feb 2026) produced 21,000+ agents. Many builders in that network will be at AI Agent Week satellite events. Target:
- Hackathon finalists / winners who shipped agent products
- Colosseum community channels — identify attendees before the event

---

## 4. Pre-Conference Outreach Plan

### Week of Apr 21-27

- [ ] Confirm speaker proposal submitted (research agent — due Apr 21)
- [ ] Register for conference ticket + AI Agent Week events once board confirms availability
- [ ] DM ElizaOS / Shaw on X: "We'll be at AI Agent Conference — want to connect in person about Holdfast Protocol x ElizaOS integration"
- [ ] DM Olas team: same, reference CAS-130 proposal
- [ ] Post X thread: "Holdfast Protocol devnet is live. We'll be at AI Agent Conference NYC May 4-5 — find us if you're building autonomous agents and need trust infrastructure"
- [ ] Print one-pager (or digital version ready for AirDrop/sharing)

### Week of Apr 28-May 3

- [ ] Pre-schedule specific meetings with ElizaOS, Olas, SAK teams (30-min 1:1s)
- [ ] Identify satellite events during AI Agent Week (May 6-8) that Tier 1 targets will attend
- [ ] Prepare demo environment: Holdfast Protocol devnet SDK, register-agent + read-reputation flow ready on laptop
- [ ] Finalize lightning talk slides if speaker slot confirmed

### During Conference (May 4-5)

- [ ] Attend Agentic Engineering track sessions
- [ ] Execute 1:1 meetings with pre-scheduled targets
- [ ] Connect with Vouch Protocol team — partnership conversation, not competitive recon. Explore complementarity angle (Vouch DID → Holdfast Protocol registration).
- [ ] Business cards / one-pager distribution at networking sessions

### AI Agent Week (May 6-8)

- [ ] Attend ElizaOS / builder community satellite events
- [ ] Follow up with leads from May 4-5

### Post-Conference (May 9+)

- [ ] Follow-up emails within 48 hours of each conversation
- [ ] Log all leads into Paperclip as CAS-131 subtasks or new issues
- [ ] Write conference recap post for Casemate Labs blog / X thread

---

## 5. Board Availability — Pending

**Status:** Waiting on board confirmation of who attends May 4-5.
**Board approval for travel budget:** [c278174b](/CAS/approvals/c278174b-ef3b-4afa-a397-c8cb64568903)

The following roles should attend if available:
- CEO (first choice — relationship-building with ElizaOS/Olas)
- Head of Growth (conference and partner outreach ownership)
- CTO / Head of Product (technical credibility for integration conversations)

---

*Prepared by Head of Growth | CAS-131 | 2026-04-20*
