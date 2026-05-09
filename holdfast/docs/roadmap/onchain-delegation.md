# Roadmap: on-chain delegation interface

> **Status:** Draft · Holdfast Protocol roadmap
> **Tracks:** [elizaOS/discussions#7071](https://github.com/orgs/elizaOS/discussions/7071) — MrTalecky's signer-injection point
> **Author:** Matthew @ Casemate Labs
> **Target release:** post-mainnet (after secp256r1 precompile lands on Solana mainnet)

---

## TL;DR

Replace the plugin's current `signer: Keypair` config with an on-chain `Delegation` account, so the agent runtime never holds the operator's Ed25519 private key. The agent runs with only the hardware-attested secp256r1 key bound to its `AgentWallet` PDA, plus a reference to a `Delegation` PDA that scopes what it's authorised to do. Owners provision the delegation once with a hardware wallet; the runtime never sees the owner's key.

---

## Why now

In #7071, [@MrTalecky](https://github.com/MrTalecky) drew the contrast between EVM-side delegated signers (where the agent's runtime key is software, just authorised by an EIP-712 message) and the Holdfast path (where the AgentWallet PDA is bound to a secp256r1 key the application can't extract). The hardware-attested binding is the harder-to-compromise property; we should not weaken it by also requiring an Ed25519 keypair next to it in the runtime.

That requirement exists today. Closing it is the next logical step in the agent-identity surface.

---

## What ships today

```ts
// @holdfastprotocol/eliza-plugin — current MVP config
createHoldfastPlugin({
  rpcUrl,
  signer: keypair,        // ← raw Ed25519 Keypair
  agentWallet: "Gm1...",  // ← secp256r1-bound PDA
});
```

`signer` performs two jobs at once:

1. **Authority.** Anchor account check on `agent_wallet.authority` — the Ed25519 key authorised to act on behalf of this AgentWallet.
2. **Fee payer.** Pays the network fee on every submitted transaction.

The agent's *identity* — the secp256r1 public key bound to the PDA via SIMD-48 — is already hardware-attestable. The agent's *authority* is not. If an attacker exfiltrates the Ed25519 keypair from the runtime, they get full operator authority over the AgentWallet's pacts.

Today's failure mode in plain terms: secp256r1 says *who is acting*, the Ed25519 key says *they're allowed to act*, and the second one is sitting in a `.env` file.

---

## Existing primitives we build on

| Primitive | Purpose | Status |
|---|---|---|
| `AgentWallet` PDA | Identity. Seeded by `agent_wallet` + secp256r1 pubkey coordinates. | Live (devnet) |
| SIMD-48 / secp256r1 precompile | Verifies P-256 signatures on Solana. | Active devnet, mainnet TBD |
| `verify_secp256r1_precompile` | Program-side guard that ties an AgentWallet action to a P-256 signature over the instruction. | Live |
| `ReputationAccount` PDA | On-chain reputation. CPI'd at every terminal pact event. | Live |

The piece that's missing is a typed, scoped, on-chain authorisation account — what `signer:` is implicitly doing today.

---

## Proposed primitive: `Delegation`

A new on-chain account, owned by the `holdfast` (vaultpact) program:

```rust
// holdfast/programs/vaultpact/src/state/delegation.rs (proposed)
#[account]
pub struct Delegation {
    pub version:      u8,           // schema version, currently 1
    pub owner:        Pubkey,       // Ed25519 owner authority (hardware wallet)
    pub agent_wallet: Pubkey,       // AgentWallet PDA being delegated to
    pub scope:        DelegationScope,
    pub fee_payer:    Pubkey,       // who pays — usually a Casemate-managed
                                    // relayer, sometimes the owner itself
    pub created_at:   i64,
    pub expires_at:   i64,          // unix seconds; 0 = no expiry
    pub revoked_at:   i64,          // 0 = not revoked
    pub nonce_floor:  u64,          // monotonically-increasing replay guard
    pub bump:         u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct DelegationScope {
    pub max_pact_value:    u64,     // lamports per pact
    pub max_total_value:   u64,     // cumulative across delegation lifetime
    pub allowed_actions:   u32,     // bitfield: CREATE_PACT | DEPOSIT |
                                    //  RELEASE | OPEN_DISPUTE | ESCALATE
    pub allowed_arbiters:  Vec<Pubkey>,  // optional whitelist; empty = any
    pub allowed_mints:     Vec<Pubkey>,  // optional SPL mint whitelist; empty = SOL only
    pub release_modes:     u8,      // bitfield: TASK | MILESTONE | TIMED
}
```

PDA seeds: `["delegation", owner.key, agent_wallet.key, nonce]`.

Created by an instruction the **owner's hardware wallet** signs (one-shot, on-chain). The agent runtime never sees that signature.

---

## Proposed plugin config

```ts
// @holdfastprotocol/eliza-plugin — proposed v0.2 config
createHoldfastPlugin({
  rpcUrl,
  agentWallet:  "Gm1...",                  // AgentWallet PDA (unchanged)
  delegation:   "DLg7...",                 // NEW: Delegation PDA reference
  secp256r1: {                             // NEW: replaces `signer`
    source: "hsm",                         //  | "tpm" | "tee" | "keyring" | KeyMaterial
    keyId:  "agent/holdfast/main",
  },
  feePayer: {                              // NEW: explicit, scoped via Delegation
    source: "relayer",                     //  | "self" | KeyMaterial
    relayerUrl: "https://relay.casematelabs.com/v1/sponsor",
  },
});
```

What the runtime actually holds:

1. The **secp256r1 key handle** (not the raw key — the hardware reference).
2. The **Delegation PDA address** — a public on-chain pointer.
3. Optionally a **relayer URL** if fees are sponsored.

What the runtime does **not** hold:

- The owner's Ed25519 keypair.
- The raw secp256r1 private key (hardware boundary).
- Any data that, if exfiltrated, lets an attacker act outside the on-chain `DelegationScope`.

---

## Lifecycle

**Provision (owner, one-shot, hardware wallet signs):**
```
holdfast delegate create
  --owner            HW_WALLET
  --to               <AgentWallet>
  --max-pact-value   500_000_000
  --max-total-value  10_000_000_000
  --allowed-actions  CREATE_PACT,DEPOSIT,RELEASE
  --release-modes    TASK,MILESTONE
  --expires          90d
```
Returns the `Delegation` PDA address. That address goes into the plugin config.

**Run (agent, every action):**
- Build instruction.
- Sign instruction digest with secp256r1 (hardware).
- Program verifies: secp256r1 signature → identifies AgentWallet → loads Delegation → checks scope/expiry/revocation/nonce → executes.
- No Ed25519 owner signature in the loop.

**Revoke (owner, instant):**
```
holdfast delegate revoke --pda <Delegation>
```
Sets `revoked_at = now()`. Subsequent agent actions fail at the program guard.

**Expire (passive):** `expires_at` is enforced on-chain.

**Rotate (owner):** Create a new Delegation, point the agent at it, revoke the old one. No agent restart required if the plugin polls `Delegation` between actions.

---

## Security properties

| Property | Today | With on-chain delegation |
|---|---|---|
| Agent identity is hardware-attested | ✅ | ✅ |
| Owner authority can be revoked without rotating identity | ❌ (must rotate AgentWallet) | ✅ (revoke `Delegation`, identity unchanged) |
| Agent runtime compromise leaks owner key | ⚠️ Yes | ✅ No |
| Agent compromise is bounded by on-chain scope | ❌ (full authority) | ✅ (capped by `DelegationScope`) |
| Owner can sponsor fees without exposing their key to the runtime | ❌ | ✅ (relayer + `fee_payer` field) |
| Replay protection across restarts | implicit (Solana recent-blockhash) | explicit (`nonce_floor`) + recent-blockhash |
| Auditor can answer "what is this agent allowed to do?" | scattered (docs + ENV + threat model) | one on-chain account read |

What this **does not** protect against:

- **Insider abuse within scope.** A compromised agent acting under a generous `DelegationScope` is still a problem; the scope is an upper bound, not a behaviour guarantee.
- **secp256r1 hardware compromise.** If the hardware key is exfiltrable, the model collapses. This is the same trust assumption we make today; on-chain delegation does not weaken it but also does not strengthen it.
- **Relayer compromise** (when used). A compromised relayer can refuse-to-sign or front-run, but cannot act outside the scope. Mitigation: multiple relayers, fee-payer whitelist on the Delegation.

---

## Migration story

The current `signer:` config remains supported as a deprecated path through one minor release after `Delegation` lands. Concretely:

- **v0.2.x (delegation introduced):** `signer:` works (warns); `delegation:` works.
- **v0.3.0:** `signer:` is removed; `delegation:` is required.
- **v1.0.0 (mainnet):** delegation-only.

Migration command for existing operators:
```
holdfast migrate signer-to-delegation
  --keypair           ./agent.json          # the existing Ed25519 signer
  --owner-hw          ledger://m/44'/501'/0'
  --scope             default-conservative
```
Provisions a `Delegation` matching the existing authority, prints the new plugin config block, and instructs the operator to remove `signer:` once verified.

---

## Open questions

1. **Relayer interface.** Standardise the relayer protocol or leave it to operators? (Lean: standardise — propose a minimal `POST /v1/sponsor` JSON contract so multiple relayers are interoperable.)
2. **Scope DSL.** `DelegationScope` as a fixed struct, or a small DSL that compiles to a struct? (Lean: fixed struct for v0.2; DSL is a v1.x compaction.)
3. **Cross-program scope.** Should `Delegation` cover only `vaultpact`, or also `vaultpact_escrow`? (Lean: both, with separate `allowed_actions` bitfields per program.)
4. **Multi-agent owners.** One owner, many AgentWallets — share scope, or one Delegation per agent? (Lean: one per agent, for revocation granularity.)
5. **Secp256r1 source abstraction.** Define the `secp256r1.source` interface in the SDK as a typed adapter so HSM / TPM / TEE / browser-WebAuthn can all implement it. Where does that live — `@holdfastprotocol/sdk` or a sibling `@holdfastprotocol/secp256r1-providers`?
6. **ElizaOS plugin config registration.** The proposed shape adds nested config blocks that don't fit the elizaOS registry's flat `config` schema. Aligns naturally if [#7513 — onchain-programs RFC](https://github.com/orgs/elizaOS/discussions/7513) lands; otherwise we either keep delegation config at the plugin layer (out of registry-managed config) or argue for nested config blocks separately.

---

## Dependencies

- secp256r1 / SIMD-48 on Solana mainnet. Currently devnet-only. Mainnet activation is the gating dependency for v1.0.
- External audit pass on `vaultpact` covering the new `Delegation` account and its instruction set. Slot into the existing audit cadence.
- Relayer service. Casemate-operated initially; published protocol so others can run their own.

---

## Refs

- [#7071 — Holdfast Protocol plugin discussion](https://github.com/orgs/elizaOS/discussions/7071) (signer-injection thread)
- [#7513 — RFC: First-class on-chain program addresses in plugin registry entries](https://github.com/orgs/elizaOS/discussions/7513)
- `holdfast/docs/THREAT_MODEL.md` — current AgentWallet authority model
- `holdfast/sdk/src/registration/index.ts` — `registerAgentWallet`, secp256r1 binding
- `holdfast/programs/vaultpact-escrow/src/lib.rs` — `verify_secp256r1_precompile`
