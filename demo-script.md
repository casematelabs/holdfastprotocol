# Holdfast Protocol — Live Devnet Demo Script
## Colosseum Frontier Hackathon | Pitch Deck Slide 4

**Version:** 1.0 Draft
**Author:** Head of Growth
**Status:** Pending CTO sign-off
**Target recording date:** April 26, 2026
**Disclaimer language source:** [CAS-59](/CAS/issues/CAS-59)

> ⚠️ Note: This script assumes devnet program deployment is confirmed by Backend Engineer by April 23. All program IDs and PDA derivations are sourced from the live codebase at `holdfast/`. Verify addresses with CTO before recording.

---

## Pre-Recording Requirements

**Environment checklist (verify before hitting record):**
- [ ] Solana CLI configured for devnet: `solana config set --url https://api.devnet.solana.com`
- [ ] Payer keypair funded ≥ 0.1 SOL: `~/.config/solana/devnet.json`
- [ ] Oracle keypair funded ≥ 0.05 SOL: `~/.config/solana/oracle-devnet.json`
- [ ] Holdfast Protocol program confirmed live on devnet (Backend Engineer to confirm by April 23)
  - Program ID: `2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq`
- [ ] `AttestationRegistry` PDA initialized via `scripts/init-registry-devnet.ts` (one-time setup — confirm with Backend Engineer)
- [ ] `yarn install` complete in `holdfast/` directory
- [ ] Terminal font: ≥ 14pt, white on dark background
- [ ] **Disclaimer banner visible on screen throughout** (see Disclaimer Setup below)
- [ ] Browser tab pre-loaded to `https://explorer.solana.com/?cluster=devnet`

**Window layout:**
- Primary: Terminal (full-screen or ≥ 70% width)
- Secondary: Solana Explorer on devnet (switch to for TX confirmation shots)
- No other tabs, files, or windows visible

---

## Disclaimer Setup (Persistent — Required Throughout)

Display one of the following **throughout the entire recording**:

**Option A — tmux top pane (recommended):**
```
⚠  Holdfast Protocol is pre-audit software deployed on Solana devnet. Not for mainnet or production use.
```

**Option B — Terminal title bar** (set before recording):
```bash
echo -ne "\033]0;⚠ Holdfast Protocol — Pre-audit. Devnet only.\007"
```

**Option C — Post-production lower-third overlay** (fallback): Use Variant 1 text from [CAS-59](/CAS/issues/CAS-59):
> *"Holdfast Protocol is pre-audit software deployed on Solana devnet. Not for mainnet or production use."*

The disclaimer must be **legible at all times**. Do not obscure it with terminal output.

---

## Demo Flow Overview

3 stages, approximately 4–6 minutes total:

| Stage | Action | On-chain TX | Est. time |
|-------|--------|-------------|-----------|
| 0 | Setup & preflight | — | 30 sec |
| 1 | Register agent wallet | ✅ | 60–90 sec |
| 2 | Oracle reputation update | ✅ | 60–90 sec |
| 3 | Attestation query via SDK | read-only | 60 sec |

**Scope boundary (firm — per CTO):** Stages 1–3 only. No escrow program interactions. Escrow program (`CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi`) must not appear in the recording.

If `yarn demo` runs additional stages beyond these three, restrict with:
```bash
DEMO_STAGES=register,reputation,query yarn demo
```
or comment out escrow stages in `scripts/hackathon-demo.ts` before recording.

---

## Stage 0: Setup (First 30 seconds on-screen)

### Commands

```bash
# Set Solana CLI to devnet
solana config set --url https://api.devnet.solana.com

# Confirm payer is funded
solana balance ~/.config/solana/devnet.json

# Navigate to Holdfast Protocol directory
cd ~/projects/holdfast

# Confirm program is deployed
solana program show 2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq \
  --url https://api.devnet.solana.com
```

### Expected Terminal Output

```
Config File: /home/user/.config/solana/cli/config.yml
RPC URL: https://api.devnet.solana.com
WebSocket URL: wss://api.devnet.solana.com/
Commitment: confirmed

0.125 SOL

Program Id: 2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq
Owner: BPFLoaderUpgradeab1e11111111111111111111111
Status: Upgradeable
```

### Voiceover

> "We're running entirely on Solana devnet — no real funds involved. The Holdfast Protocol reputation program is deployed here at address D-6-m-U... You can verify it directly in Solana Explorer."

*(Switch to browser, show program page: `https://explorer.solana.com/address/2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq?cluster=devnet`)*

> "Everything you're about to see is live on-chain. Not a simulation."

### Error Fallback — Stage 0

| Error | Cause | Action |
|-------|-------|--------|
| `Program not found` | Not deployed yet | **Stop recording.** Contact Backend Engineer. Do not record. |
| SOL balance `0` | Unfunded payer | `solana airdrop 1 $(solana-keygen pubkey ~/.config/solana/devnet.json) --url https://api.devnet.solana.com` |
| RPC connection refused | Network issue | Retry once; switch to backup RPC if needed |

---

## Stage 1: Register Agent Wallet

### Context

An autonomous AI agent generates a secp256r1 (P-256) keypair — the same cryptographic primitive used by hardware security keys, Apple Secure Enclave, and WebAuthn. Holdfast Protocol anchors this key on Solana, binding a hardware-attested identity to the agent's wallet. This is the protocol's foundational trust primitive.

### Commands

```bash
yarn demo
```

*(Runs `scripts/hackathon-demo.ts`. Stage 1 executes automatically.)*

### Expected Terminal Output

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Holdfast Protocol — Devnet Demo
  ⚠  Pre-audit software. Devnet only.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Stage 1] Generating secp256r1 (P-256) keypair for agent...
  → Agent pubkey X: a1b2c3d4e5f6789012345678901234567890abcdef012345678901234567890abc
  → Agent pubkey Y: 7890abcdef1234567890123456789012345678901234567890abcdef01234567
  → AgentWallet PDA: 5xK7vP2mHqRnL9sD3jW8bYtF4eXoZ1cN6uAiG0rT

[Stage 1] Building secp256r1 attestation instruction...
  → Preimage: vaultpact:register_agent_wallet:v1:<authority><x><y>
  → Signature: 3045022100a1b2c3...

[Stage 1] Submitting registerAgentWallet transaction...
  ✓ TX confirmed: 3HgX7YqZN2abPmKvRtLs9qWxD5nCfJ8eB4hU1oM6yk
  ✓ AgentWallet account created at: 5xK7vP2mHqRnL9sD3jW8bYtF4eXoZ1cN6uAiG0rT
```

### Solana Explorer Shot

Pause at the `✓ TX confirmed:` line. Switch to browser. Navigate to:
```
https://explorer.solana.com/tx/3HgX7YqZN2abPmKvRtLs9qWxD5nCfJ8eB4hU1oM6yk?cluster=devnet
```
*(Replace with actual TX signature recorded during demo run.)*

**Explorer talking points — linger 5–8 seconds:**
- "Status: Success — green checkmark"
- "Program: `2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq` — the Holdfast Protocol program"
- "Instruction: `registerAgentWallet` — one instruction, one on-chain account created"

### Voiceover

> "We're generating a fresh secp256r1 key pair — the same primitive used by hardware security keys and Apple Secure Enclave. Holdfast Protocol uses this to anchor a hardware-attested identity to the agent."

*(Demo runs, TX submits)*

> "Confirmed. You can see the `registerAgentWallet` instruction landing in a real Solana block. That P-256 public key is now permanently on-chain — immutable, verifiable by anyone, no central authority required."

### Error Fallbacks — Stage 1

| Error | Cause | Action |
|-------|-------|--------|
| `Error: Insufficient funds for fee` | Payer SOL too low | `solana airdrop 1 <payer-pubkey>` then retry |
| `AccountNotFound — AttestationRegistry` | Registry not initialized | Run `ts-node -P tsconfig.json scripts/init-registry-devnet.ts` once; confirm with Backend Engineer |
| `secp256r1 instruction verification failed` | Noble/curves version mismatch | Run `yarn install` fresh; verify `@noble/curves` package version |
| `Program not found` or `0x0` | Wrong program ID | Verify with Backend Engineer; update `HOLDFAST_PROGRAM_ID` in demo script |
| TX timeout (no confirmation after 30s) | Devnet congestion | Retry with `--commitment confirmed`; if persists, wait 60s and resubmit |

---

## Stage 2: Oracle Reputation Update

### Context

After wallet registration, a protocol-authorized oracle submits a reputation update. This simulates an agent completing a task: the escrow settlement program (in production) calls the reputation program to log the outcome and update the score. Score starts neutral at 5000 basis points — one completed pact adds +200bp.

### Commands

*(Continues automatically from `yarn demo` — Stage 2 follows Stage 1)*

### Expected Terminal Output

```
[Stage 2] Initializing ReputationAccount for agent...
  → ReputationAccount PDA: 8mP2xL4kRnW6sD1jY9bQtN3eZoF7cV5uBiH0gA2rT
  ✓ TX confirmed: 7TpQrX8YnWzAbcLmK2vDfJ3eN9sR6wH1oM4yk5XqZ

[Stage 2] Submitting oracle reputation update...
  → Oracle: <oracle-pubkey>
  → Outcome: Fulfilled
  → Score delta: +200bp
  → Nonce: 1
  → Pact ID: a1b2c3d4e5f6ab
  ✓ TX confirmed: 9KxNmQ3RvYbDfwJpL7tCgS2eH5oA1kZ4nX8rM6vB0y

[Stage 2] On-chain reputation state:
  Score:           5200 / 10000  (+200bp)
  Tier:            Unverified
  Total pacts:     1
  Dispute count:   0
  Nonce:           1
  Last updated:    [timestamp]
```

### Solana Explorer Shot

Pause at the second `✓ TX confirmed:` line (the `updateReputation` TX). Switch to browser:
```
https://explorer.solana.com/tx/9KxNmQ3RvYbDfwJpL7tCgS2eH5oA1kZ4nX8rM6vB0y?cluster=devnet
```
*(Replace with actual TX signature.)*

**Explorer talking points — linger 5–8 seconds:**
- "Instruction: `updateReputation` — score delta, outcome, and pact ID all written on-chain"
- "Signed by the oracle account — the only authority permitted to submit reputation updates"
- "Score is now 5200 basis points. Auditable. Immutable."

### Voiceover

> "Reputation in Holdfast Protocol is fully on-chain and oracle-governed. An authorized oracle — in production, the Holdfast Protocol escrow settlement program itself — submits a signed update after a pact resolves."

*(TX confirms)*

> "Score moves from 5000 to 5200 basis points. Every point of reputation is backed by an on-chain transaction. The oracle authority is a program PDA — not a human — so there's no centralized reputation manipulation possible. The whole history is here in the chain."

### Error Fallbacks — Stage 2

| Error | Cause | Action |
|-------|-------|--------|
| `3012 — Invalid nonce` | Nonce replay (stale account) | Use a fresh agent wallet generated this session (new PDA, nonce starts at 0) |
| `2003 — Unauthorized` | Wrong oracle keypair | Confirm `oracle-devnet.json` pubkey matches `REPUTATION_ORACLE_AUTHORITY` in deployed program; check with Backend Engineer |
| `AccountNotFound — ReputationAccount` | `init_reputation` not run | Ensure demo script runs `initReputation` before `updateReputation`; update script order if needed |
| Score unchanged on re-run | Prior state from earlier test run | Generate a fresh agent wallet (new PDA) to start from score 5000 |

---

## Stage 3: Attestation Query via SDK

### Context

Any application integrating Holdfast Protocol — a DeFi protocol, agent marketplace, or hiring platform — queries agent reputation with three lines of TypeScript. This demonstrates the consumer-facing SDK call that makes the on-chain data accessible to builders.

### Commands

*(Continues automatically as final stage of `yarn demo`, or run inline:)*

```typescript
import { createHoldfastClient } from "@holdfastprotocol/sdk";

const client = createHoldfastClient({
  rpcUrl: "https://api.devnet.solana.com",
  indexerUrl: "https://indexer.devnet.holdfastprotocol.com",
});

const rep = await client.reputation.get(agentPubkey);
const history = await client.reputation.getHistory(agentPubkey, { limit: 5 });
```

### Expected Terminal Output

```
[Stage 3] Querying attestation via SDK...
  → Agent:   5xK7vP2mHqRnL9sD3jW8bYtF4eXoZ1cN6uAiG0rT
  → RPC:     https://api.devnet.solana.com
  → Indexer: https://indexer.devnet.holdfastprotocol.com

  ✓ Attestation report:
  ┌──────────────────────────────────────────────────┐
  │  Holdfast Protocol Attestation Report                    │
  │  Agent:   5xK7...G0rT                            │
  │  Score:   5200 / 10000  (Neutral+)               │
  │  Tier:    Unverified                             │
  │  Pacts:   1 completed, 0 disputed                │
  │  Updated: [timestamp]                            │
  ├──────────────────────────────────────────────────┤
  │  History (1 entry):                              │
  │  [0] Fulfilled  +200bp  pact:a1b2c3d4e5f6ab      │
  └──────────────────────────────────────────────────┘

Demo complete. All stages passed. ✓
```

### Voiceover

> "Finally — the consumer side. Any application querying Holdfast Protocol gets this: a clean attestation report. Score, tier, pact history. Three lines of TypeScript."

*(Pause on the report)*

> "The same record written by on-chain transactions is now readable by anyone. No API key, no centralized reputation service, no trust required in Casemate Labs as an intermediary. The data lives on Solana."

*(Final pause — hold 3 seconds)*

> "Hardware-attested identity. On-chain reputation. The missing accountability layer for the agent economy."

*(Fade to closing shot with disclaimer)*

### Error Fallbacks — Stage 3

| Error | Cause | Action |
|-------|-------|--------|
| `ReputationNotFoundError` | No reputation account at this pubkey | Ensure Stages 1 and 2 completed for this session's agent keypair |
| `Error: Indexer unreachable` | `indexer.devnet.holdfastprotocol.com` is down | Fall back: omit `getHistory()` call; read `rep.history` field from on-chain account directly |
| `Error: Network request failed` | RPC rate limit hit | Switch RPC to a project-registered endpoint; or add 2s delay before query |
| Empty `history.entries` array | Indexer sync lag (< 5s after TX) | Add `await sleep(5000)` before `getHistory()` call |

---

## Closing Shot (Hold 3 seconds, then fade)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Holdfast Protocol
  Hardware-attested trust for autonomous AI agents
  on Solana.

  holdfastprotocol.com  |  devnet demo

  ⚠  Pre-audit software. Not for production use.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## CTO Sign-Off Checklist

Before screen recording begins, CTO must confirm each item:

- [ ] Stage sequence is correct: `registerAgentWallet` → `updateReputation` → `reputation.get()` — no escrow
- [ ] Escrow program (`CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi`) does not appear anywhere in demo
- [ ] Program ID `2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq` is accurate for devnet
- [ ] `oracle-devnet.json` authority matches deployed program's `REPUTATION_ORACLE_AUTHORITY`
- [ ] Expected terminal output format matches actual `scripts/hackathon-demo.ts` output
- [ ] Indexer URL `https://indexer.devnet.holdfastprotocol.com` is live, or fallback instructions are sufficient
- [ ] Disclaimer language (Variant 1 from [CAS-59](/CAS/issues/CAS-59)) is approved for on-screen use
- [ ] No voiceover claims exceed what the devnet code actually does
- [ ] Recording can proceed once Backend Engineer confirms devnet deployment (target April 23)

