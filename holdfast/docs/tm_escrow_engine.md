# Threat Model — Holdfast Escrow Engine

Program ID: `CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi`

## Attack Vectors

### AV-1 — Unauthorized fund access

**Threat:** An attacker drains the vault token account without a legitimate state transition.

**Mitigations:**
- Vault is an associated token account owned by the escrow PDA. All transfers require escrow PDA signature via `signer_seeds`.
- `has_one = vault` constraint on every instruction that touches the vault, preventing substitution of a different token account.
- No user-supplied amount parameter on payout paths — amounts are derived from on-chain `EscrowAccount` fields set at initialization.

### AV-2 — Time boundary manipulation

**Threat:** An attacker exploits off-by-one or inclusive/exclusive boundary inconsistencies to act outside allowed windows.

**Mitigations:**
- Time-lock expiry uses strict `>` (`now > time_lock_expires_at`) in `refund`, `auto_release`.
- Dispute window uses strict `<` (`now < dispute_window_ends_at`) in `raise_dispute`.
- Dispute-window-ended guard uses strict `>` (`now > dispute_window_ends_at`) in `claim_released`.
- `time_lock_expires_at > now` at initialization and lock ensures the lock period is meaningful.

### AV-3 — Re-entrancy / double-spend

**Threat:** A malicious CPI callback during token transfer re-enters the instruction to extract funds twice.

**Mitigations:**
- CEI (Checks-Effects-Interactions) pattern enforced on every fund-moving instruction. `EscrowAccount.status` is updated **before** any token transfer CPI.
- `EscrowStatus` enum has no reversible transitions — once status moves to `Released`, `Refunded`, `Claimed`, or `Disputed`, the prior-status gate blocks re-entry.
- `beneficiary_staked` flag set before transfer CPI in `stake_beneficiary` prevents double-stake griefing.

### AV-4 — Unauthorized status transitions

**Threat:** An attacker calls instructions out of order to skip required steps or replay completed actions.

**Mitigations:**
- Every instruction opens with `require!(escrow.status == <expected>, EscrowError::InvalidStatus)`.
- State machine: `Pending → Funded → (beneficiary_staked) → Locked → Released → Claimed → Closed` with branches to `Disputed` and `Refunded`.
- `beneficiary_staked` flag gates `lock_escrow`, preventing lock without prior beneficiary stake.
- `DisputeRecord` PDA is `init`-only (unique seed per escrow), so a dispute cannot be raised twice.

### AV-5 — Vault balance manipulation

**Threat:** An attacker deposits partial funds or drains the vault between deposit and lock, causing the escrow to operate on mismatched balances.

**Mitigations:**
- `lock_escrow` checks `vault.amount == escrow_amount + initiator_stake + beneficiary_stake` before transitioning to `Locked`.
- Deposit amount is derived from on-chain `escrow_amount + initiator_stake` — no user-supplied override.
- Beneficiary stake amount is derived from `escrow.beneficiary_stake` — no user-supplied override.

### AV-6 — Identity spoofing

**Threat:** An attacker submits a transaction pretending to be the initiator, beneficiary, or arbiter.

**Mitigations:**
- All party-gated instructions require a `Signer` account with `has_one` constraint linking back to `EscrowAccount.initiator`, `.beneficiary`, or `.arbiter`.
- `AgentWallet.authority` constraint validates that the wallet account presented belongs to the signing party.
- Crank-callable instructions (`refund`, `auto_release`) are permissionless by design — they only disburse to validated token accounts owned by the correct parties.

### AV-7 — Agent wallet status bypass

**Threat:** A frozen or blacklisted agent participates in actions that should be blocked for their status.

**Mitigations:**
- `initialize_escrow`: both initiator and beneficiary wallets must be `Active` (status == 0).
- `stake_beneficiary`: beneficiary wallet must be `Active`.
- `lock_escrow`: both wallets must be `Active`.
- `release_escrow`: initiator wallet must not be `Blacklisted` (status != 2). Frozen is allowed (settlement).
- `claim_released`: beneficiary wallet must not be `Blacklisted`. Frozen is allowed (settlement).
- `protocol_freeze_pact`: creates a dispute with pre-set arbiter decision when a party's wallet is blacklisted, preventing normal resolution.

### AV-8 — Protocol authority impersonation

**Threat:** An attacker calls `protocol_freeze_pact` without being the legitimate protocol authority, freezing escrows maliciously.

**Mitigations:**
- `protocol_freeze_pact` requires `attestation_registry.authority == protocol_authority.key()` — the signer must be the on-chain authority of the `AttestationRegistry` account.
- In mainnet builds, `INITIAL_AUTHORITY` resolves to the Squads v4 vault PDA (3-of-5 multisig), so `protocol_freeze_pact` signer validation ultimately requires multisig threshold approval.
- The pre-set `ArbiterDecision` on a frozen pact cannot be overridden by the arbiter in `resolve_dispute` — if `existing_decision != None`, the arbiter can only execute the existing decision, not change it.

### AV-9 — Unauthorized dispute / escalation

**Threat:** A non-participant raises or escalates a dispute to grief the escrow.

**Mitigations:**
- `raise_dispute` requires the signer to be either `escrow.initiator` or `escrow.beneficiary`.
- `escalate_dispute` applies the same participant check.
- `resolve_dispute` requires the signer to be `escrow.arbiter` via `has_one`.
- `DisputeRecord` PDA uses `seeds = [b"dispute", escrow_id]` — only one dispute per escrow, preventing spam.

### AV-10 — Protocol authority key compromise

**Threat:** An attacker compromises the protocol admin key and calls `set_agent_status` or deploys a malicious program upgrade.

**Mitigations:**
- Squads v4 3-of-5 multisig (post-migration). Attack requires compromising 3 hardware wallets simultaneously.
- `set_protocol_authority` is gated by the compile-time `INITIAL_AUTHORITY` constant, not the on-chain `attestation_registry.authority` field. Even if the on-chain authority is rotated, only the original Squads multisig can call `set_protocol_authority` to rotate it again.
- Program upgrade authority is also governed by the same Squads multisig, preventing unilateral malicious upgrades.

---

## Instruction ↔ AV Cross-Reference

| Instruction               | AV-1 | AV-2 | AV-3 | AV-4 | AV-5 | AV-6 | AV-7 | AV-8 | AV-9 | AV-10 |
|---------------------------|:----:|:----:|:----:|:----:|:----:|:----:|:----:|:----:|:----:|:-----:|
| `initialize_escrow`       |  ✓   |  ✓   |  —   |  ✓   |  —   |  ✓   |  ✓   |  —   |  —   |   —   |
| `deposit_funds`           |  ✓   |  —   |  ✓   |  ✓   |  —   |  ✓   |  —   |  —   |  —   |   —   |
| `stake_beneficiary`       |  ✓   |  —   |  ✓   |  ✓   |  —   |  ✓   |  ✓   |  —   |  —   |   —   |
| `lock_escrow`             |  —   |  ✓   |  —   |  ✓   |  ✓   |  ✓   |  ✓   |  —   |  —   |   —   |
| `release_escrow`          |  —   |  ✓   |  ✓   |  ✓   |  —   |  ✓   |  ✓   |  —   |  —   |   —   |
| `claim_released`          |  ✓   |  ✓   |  ✓   |  ✓   |  —   |  ✓   |  ✓   |  —   |  —   |   —   |
| `auto_release`            |  ✓   |  ✓   |  ✓   |  ✓   |  —   |  —   |  —   |  —   |  —   |   —   |
| `raise_dispute`           |  —   |  ✓   |  —   |  ✓   |  —   |  —   |  —   |  —   |  ✓   |   —   |
| `escalate_dispute`        |  —   |  ✓   |  —   |  ✓   |  —   |  —   |  —   |  —   |  ✓   |   —   |
| `resolve_dispute`         |  ✓   |  —   |  ✓   |  ✓   |  —   |  ✓   |  —   |  ✓   |  ✓   |   —   |
| `refund`                  |  ✓   |  ✓   |  ✓   |  ✓   |  —   |  —   |  —   |  —   |  —   |   —   |
| `close_escrow`            |  ✓   |  —   |  —   |  ✓   |  ✓   |  ✓   |  —   |  —   |  —   |   —   |
| `protocol_freeze_pact`    |  —   |  —   |  ✓   |  ✓   |  —   |  —   |  ✓   |  ✓   |  —   |   ✓   |
| `set_protocol_authority`  |  —   |  —   |  —   |  —   |  —   |  —   |  —   |  —   |  —   |   ✓   |
| `set_agent_status`        |  —   |  —   |  —   |  —   |  —   |  —   |  ✓   |  —   |  —   |   ✓   |

**Legend:** ✓ = instruction has mitigations for this AV; — = AV not applicable to this instruction.
