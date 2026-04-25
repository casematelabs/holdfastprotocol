# CAS-130: Olas Protocol Partnership Proposal — Holdfast Protocol Trust Layer for Olas Agents

*Drafted by Head of Growth — April 2026. Pre-audit disclosure required in all outreach.*

---

## 1. Executive Summary

Olas Protocol (Autonolas) is the leading on-chain AI agent coordination network. Solana is their dominant chain (82% of protocol transactions as of Feb 2026). Holdfast Protocol is trust infrastructure for autonomous AI agents deployed on Solana devnet: hardware-attested identities, on-chain reputation (0–10000 bp), and programmable escrow.

The integration thesis: Olas agents currently have on-chain registration and staking via the Olas service registry, but no portable reputation primitive that third parties can query via CPI. Holdfast Protocol provides exactly that layer — composable, queryable, decay-aware reputation that follows agents across any Solana protocol. This makes Holdfast Protocol a natural trust complement (not competitor) to the Olas registry.

**Proposed engagement:** devnet integration partnership, co-marketing around Solana agent trust, and potential Colosseum Frontier hackathon joint submission.

---

## 2. Why Olas, Why Now

| Signal | Detail |
|---|---|
| Solana dominance | 82% of Olas protocol txns on Solana (Feb 2026) |
| Active agent ecosystem | PettBro, Polystrat, Agents.fun deployed and generating volume |
| No portable reputation layer | Olas registry tracks stake + registration, not behavioral trust history |
| Devnet alignment | Both protocols are in active devnet phase — ideal integration window |
| Audience overlap | Olas developer community = Holdfast Protocol's primary target builder segment |

The Olas registry records *who* an agent is (stake, registration, service metadata). Holdfast Protocol records *how trustworthy* an agent has proven to be over time (reputation from fulfilled/disputed pacts, decay, tier). These are complementary, not duplicative.

---

## 3. Olas Agent Candidates for Holdfast Protocol Attestation

### 3.1 Polystrat — Prediction Market Agents (Tier 1 Priority)

**Why:** Financial agents making probabilistic calls and settling positions against counterparties are exactly the use case Holdfast Protocol's escrow + reputation model serves. A Polystrat agent with a verified reputation score above 7000 bp and `VerifTier.Attested` can credibly gate access to high-stakes pacts. Users interacting with Polystrat agents would have on-chain verifiable assurance the agent has a track record of fulfilled commitments — not just an Olas stake.

**Integration pitch:** Polystrat integrates `@holdfastprotocol/sdk` → agents register identity → pact history builds reputation → prediction market counterparties can pre-flight with `meetsRequirements()` before funds enter escrow.

### 3.2 PettBro — Gaming Agents (Tier 2 Priority)

**Why:** Gaming agents transact frequently (high pact volume = faster reputation accumulation). Reputation decay means agents need to keep performing, creating a built-in incentive to maintain quality. PettBro agents operating within gaming economies benefit from trust signaling when trading rare assets or entering high-value in-game contracts with other agents.

**Integration pitch:** PettBro gaming pacts settle through Holdfast Protocol escrow → agents build reputation history → high-reputation gaming agents access premium counterparties and higher-value escrow limits.

### 3.3 Agents.fun — Influencer/Social Agents (Tier 3, monitoring)

**Note:** Currently deployed primarily on Base, not Solana. Monitor for Solana expansion. The influencer agent use case (sponsored content, engagement pacts, brand deals settled via smart contract) is a strong reputation fit — reputational stakes are high and behavioral history matters enormously. Priority escalates if Agents.fun expands to Solana.

---

## 4. Technical Integration Path

### Olas Service Architecture Compatibility

Olas agents are deployed as "services" — multi-agent components registered in the on-chain `ServiceRegistry`. Each service operator is identified by an owner key and a set of agent operator keys. Holdfast Protocol agent wallet registration works at the keypair level, making it compatible with any Olas agent operator key.

**Integration flow (devnet):**

1. Olas service operator generates or reuses their agent keypair
2. Calls `register_agent_wallet` on Holdfast Protocol using their Olas agent operator key
3. Reputation account initializes at 5000 bp (neutral), `VerifTier.Unverified`
4. Agent upgrades to `VerifTier.Attested` via secp256r1 self-attestation (localnet verified; devnet pending SIMD-48 cluster upgrade)
5. Agent transacts via Holdfast Protocol escrow → reputation score updates post-pact
6. Any Solana program, including Olas-related protocols, can CPI-read the reputation PDA

**No Olas registry modification required.** Holdfast Protocol adds a parallel reputation layer; it does not require Olas to change their existing registry contracts or SDK.

### SDK Surface for Olas Integration

```typescript
// Any Olas agent service can check a peer agent's Holdfast Protocol standing before pact initiation
import { createHoldfastClient, VerifTier } from '@holdfastprotocol/sdk';

const client = createHoldfastClient(); // defaults to Solana devnet

const trusted = await client.reputation.meetsRequirements(olasAgentPubkey, {
  minScore: 6000,
  minTier: VerifTier.Attested,
  minPacts: 3,
});
```

**CPI path (on-chain):** Any Olas service contract can add a CPI call to read the Holdfast Protocol `ReputationAccount` PDA and enforce minimum reputation thresholds without oracle round-trips.

### Known Constraints to Disclose

| Constraint | Status |
|---|---|
| secp256r1 attestation on devnet | Pending Solana cluster upgrade (SIMD-48) |
| Hardware TPM/TEE attestation (Hardline) | Roadmap Q4 2026 |
| Mainnet deployment | After external audit — timeline TBD |

These must be stated clearly in all Olas-facing outreach. Frame this as a devnet integration partnership with mainnet timeline contingent on audit.

---

## 5. Partnership Proposal: Core Terms

### What We Offer Olas
- First-mover integration documentation in Holdfast Protocol SDK (`olas-integration.md`)
- Co-authorship on a joint technical blog post: "Trust-layered Olas agents on Solana"
- Priority support for Olas service operators integrating Holdfast Protocol devnet
- Dedicated Olas integration guide in the Holdfast Protocol developer portal
- Joint presence at Solana ecosystem events and hackathons

### What We Ask from Olas
- Technical review and integration feasibility call with Olas core team
- Co-marketing: feature Holdfast Protocol in Olas developer documentation as an optional trust layer
- Reference integration from one active Olas service (Polystrat or PettBro preferred)
- Joint consideration for Colosseum Frontier hackathon submission (if timeline aligns)

### Non-negotiables (Casemate standards)
- No mainnet claims until audit completes
- No revenue-sharing or token arrangements at this stage
- All co-marketing materials approved by Head of Security before publication

---

## 6. Colosseum Frontier Hackathon Opportunity

Holdfast Protocol already has a working Colosseum demo (`holdfast/scripts/hackathon-demo.ts`). A joint Olas+Holdfast Protocol submission would demonstrate:

- Olas agent registered in Holdfast Protocol
- Agent builds reputation through a simulated Polystrat-style prediction pact
- Counterparty pre-flights reputation before escrow initiation
- End-to-end trust flow from Olas service registration → Holdfast Protocol attestation → funded pact → reputation update

**Action:** Confirm Colosseum submission window and Olas interest in joint submission. Do not commit without Olas technical buy-in — the demo must be honest about devnet/localnet limitations.

---

## 7. Outreach Strategy and Contacts

### Recommended Outreach Channels

| Channel | Priority | Rationale |
|---|---|---|
| Olas Discord (builders channel) | High | Direct access to Olas agent developers |
| Valory team via Twitter/X DM | High | Core team behind Autonolas; technically literate audience |
| Olas GitHub issues/discussions | Medium | Shows technical credibility, not just marketing |
| Solana ecosystem events (Breakpoint, Solana Hacker House) | Medium | In-person is higher conversion for protocol partnerships |

### Outreach Template (Twitter/X DM to Olas/Valory team)

> Hi [Name], I'm Head of Growth at Casemate Labs — we're building Holdfast Protocol, an on-chain trust layer for autonomous AI agents on Solana (devnet live: @holdfastprotocol/sdk@0.1.0-devnet.1).
>
> We think Holdfast Protocol and Olas are complementary: your service registry handles identity + staking, Holdfast Protocol adds portable behavioral reputation via CPI-readable accounts. Polystrat and PettBro are exactly the kinds of agents we had in mind when designing the reputation model.
>
> Pre-audit so nothing to claim on mainnet yet — but would love a 30-min call to explore a devnet integration partnership. Open to joint Colosseum submission too if the timeline works.
>
> Happy to send our devnet SDK and integration docs. Is this something the Olas team would be open to?

### Known Olas/Valory Contacts to Target
- **Valory (core Olas dev team):** Reachable via official Valory.io, Olas Discord, and X/Twitter as @valory_xyz
- **Olas Foundation:** @autonolas on Twitter/X; team members active in Olas Discord
- **Community pathway:** Submit a partnership proposal in the Olas governance forum or Discord `#partnerships` channel

**Note:** Do not cold-email; engage via public-facing developer channels first. Build technical credibility before requesting a call.

---

## 8. Next Steps and Timeline

| Action | Owner | Target |
|---|---|---|
| Post Holdfast Protocol devnet launch announcement (CAS-127) | Head of Growth | Before Olas outreach |
| Draft Olas integration guide stub | CTO (technical feasibility check first) | Q2 2026 |
| Initial Olas outreach via Discord + X/Twitter | Head of Growth | Within 2 weeks of devnet launch |
| Technical feasibility call with Olas team | CTO + Head of Growth | Q2 2026 |
| Joint blog post draft (if call goes well) | Head of Growth | Q3 2026 |
| Colosseum submission decision | CEO + Olas | Per hackathon timeline |
| Mainnet integration partnership | Both teams | Post-audit |

---

## 9. Messaging Guardrails

Based on Casemate Labs' communication standards:

| Do | Don't |
|---|---|
| "Holdfast Protocol adds portable behavioral reputation to Olas agents via CPI" | "Holdfast Protocol secures Olas agents" (overclaim) |
| "Devnet integration partnership — mainnet after audit" | "We're launching with Olas on mainnet" |
| "On-chain reputation score queryable by any Solana program" | "Unhackable trust scores" |
| "Compatible with Olas agent operator keys — no registry changes required" | "We're replacing the Olas registry" |
| Cite specific devnet program IDs and SDK version | Cite roadmap features as current capabilities |

---

*CAS-130 — Olas Protocol Partnership Outreach*
*Drafted by Head of Growth, Matthew Wicks — 2026-04-20*
*Pending: CEO review of outreach strategy; CTO review of integration feasibility*
