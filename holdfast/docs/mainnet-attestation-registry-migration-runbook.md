# Mainnet AttestationRegistry Migration Runbook (HOL-250)

One-time data-layout migration: reallocates the `AttestationRegistry` PDA from 49 bytes
(pre-HOL-182 layout, missing `oracle_authority`) to 81 bytes (post-HOL-182 layout).

Status: **Draft — pending devnet execution (HOL-249) and board approval**  
Last updated: 2026-04-27  
Owners: Solana Engineer, Security Lead, TPM  
Related: [`multisig-key-management-policy.md`](./multisig-key-management-policy.md),
[`governance-devnet.md`](./governance-devnet.md),
[`oracle-authority-rotation-runbook.md`](./oracle-authority-rotation-runbook.md)

---

## Background

[HOL-182](/HOL/issues/HOL-182) added an `oracle_authority` field to `AttestationRegistry`,
expanding the on-chain layout from 49 to 81 bytes. Any registry account initialized before
HOL-182 was deployed must be migrated by calling `migrate_attestation_registry`.

The instruction:
1. Verifies the account is 49 bytes and the discriminator is valid (reverts otherwise).
2. Tops up lamports for the 32-byte size increase.
3. Reallocates the account from 49 to 81 bytes.
4. Preserves `authority`, `agent_count`, and `bump`.
5. Sets `oracle_authority` to the compile-time `REPUTATION_ORACLE_AUTHORITY` constant.

**The migration is idempotent** — a second call reverts with `AlreadyMigrated`.
**The migration is atomic** — Solana's transaction model guarantees either full success
or a clean revert with no partial state change.

### When is migration needed?

| Scenario | Migration needed? |
|---|---|
| Registry initialized before HOL-182 deployment (49 bytes) | **Yes** |
| Registry initialized after HOL-182 deployment (81 bytes at init) | **No** |
| Registry not yet initialized (PDA not found) | **No** — initialize fresh to get 81-byte layout |

Run the pre-flight script (`--dry-run`) to determine which scenario applies.

---

## Key Addresses

| Role | Address |
|---|---|
| vaultpact Program ID (devnet) | `D6mUa4wGtFyLyJorMfxoKvA9ybohjUSsfw88t66ATxg` |
| vaultpact Program ID (mainnet) | **TBD — update when deployed** |
| Registry PDA (devnet) | `G692JfAp6GrgqePqRJD2eL87TPTqqfeQTBzZQbGfZGKP` |
| Registry PDA (mainnet) | Derived: `find_pda([b"attestation_registry"], mainnet_program_id)` |
| Mainnet INITIAL_AUTHORITY | `F7koW9b6RYpGrwEXNCGx5V5cKmK2YwhR5e5UyPyBj1J9` (Squads 2-of-2 vault) |
| Mainnet oracle authority (post-migration) | `5GeSYa2BYViRjqXGZvPGwWGkRLi7YyukmJTTGSQQw8FL` |

---

## Prerequisites Checklist

Complete all items before proceeding to Step 1.

- [ ] **[HOL-249](/HOL/issues/HOL-249) is `done`** — devnet migration executed and verified
- [ ] **[HOL-249](/HOL/issues/HOL-249) test artifacts reviewed** — devnet tx signature logged, post-migration state confirmed
- [ ] **Security Lead has reviewed this runbook** — sign off in HOL-250 Paperclip comment
- [ ] **Both Squads signers are available** — CTO (seat A) and Security Lead (seat B) must be reachable for 2-of-2 approval
- [ ] **Hardware wallets are ready** — firmware up to date, Solana app installed (≥ v1.4.0)
- [ ] **Mainnet program is deployed** with `migrate_attestation_registry` instruction (HOL-249 code)
- [ ] **Pre-flight script produces no FAIL output** — run Step 1 before scheduling the Squads transaction
- [ ] **Monitoring channel is open** — indexer and RPC endpoints are being watched during execution
- [ ] **Board approval obtained** (if required by governance policy) — record approval reference in HOL-250

---

## Step 1 — Pre-Flight Check

Run the dry-run script to validate current state and generate the instruction data.

```bash
cd holdfast

# If mainnet program ID differs from devnet, pass --program-id
npx ts-node scripts/mainnet-migrate-attestation-registry.ts \
  --dry-run \
  --program-id <MAINNET_PROGRAM_ID>
```

### Expected output (migration required)

```
MAINNET MIGRATION PRE-FLIGHT CHECK
...
Size (bytes):       49
authority:          F7koW9b6RYpGrwEXNCGx5V5cKmK2YwhR5e5UyPyBj1J9
agent_count:        <N>
oracle_authority:   (not present — pre-migration)
bump:               <B>

Pre-flight Results:
✅ Discriminator matches AttestationRegistry: [152, 156, ...]
✅ Registry is 49 bytes — migration required.
✅ Protocol authority matches Squads vault: F7koW9b6RYpGrwEXNCGx5V5cKmK2YwhR5e5UyPyBj1J9
...

Squads Instruction Data:
  Program ID: <MAINNET_PROGRAM_ID>
  Accounts [0]: <REGISTRY_PDA>   writable=true   signer=false
  Accounts [1]: F7koW9b6RYpGrwEXNCGx5V5cKmK2YwhR5e5UyPyBj1J9   writable=true   signer=true
  Accounts [2]: 11111111111111111111111111111111   writable=false  signer=false
  Instruction data (hex): <8-byte discriminator hex>
```

### If the script reports migration not needed

If the script reports the registry is already at 81 bytes, skip Steps 2–4 and proceed
to Step 5 (Verify) to confirm oracle_authority is correct.

### If the registry PDA is not found

The mainnet registry has not been initialized. Initialize it first using
`initialize_registry` via a Squads proposal (see governance-devnet.md).
After initialization, the account will be created with the 81-byte layout
and migration will not be needed.

### Record pre-flight output

Copy the full output and post it as a comment on [HOL-250](/HOL/issues/HOL-250).
Include registry size, authority, agent_count, and the instruction hex.

---

## Step 2 — Create Squads Transaction Proposal

The mainnet `INITIAL_AUTHORITY` is the Squads v4 vault PDA
(`F7koW9b6RYpGrwEXNCGx5V5cKmK2YwhR5e5UyPyBj1J9`). The migration must be
submitted as a vault transaction.

### 2a. Open Squads UI

Navigate to: https://v4.squads.so/multisigs/F7koW9b6RYpGrwEXNCGx5V5cKmK2YwhR5e5UyPyBj1J9

Verify you see the expected 2-of-2 threshold and both signer seats (CTO, Security Lead).

### 2b. Create a new transaction

1. Click **New Transaction** → **Add Instruction**.
2. Set the following:

| Field | Value |
|---|---|
| Program | `<MAINNET_PROGRAM_ID>` (from Step 1 output) |
| Account [0] | `<REGISTRY_PDA>` — **writable, not signer** |
| Account [1] | `F7koW9b6RYpGrwEXNCGx5V5cKmK2YwhR5e5UyPyBj1J9` — **signer, writable** |
| Account [2] | `11111111111111111111111111111111` (System Program) — not writable, not signer |
| Instruction data | Hex from Step 1 `--dry-run` output |

> **Important:** verify that the hex data matches the 8-byte discriminator for
> `migrate_attestation_registry` exactly. The discriminator bytes must be
> `[152, 156, 134, 191, 142, 144, 217, 209]`. Never submit instruction data
> you haven't verified against the script output.

### 2c. Add a description

Include in the transaction description:

- Purpose: "HOL-250 — AttestationRegistry realloc from 49 to 81 bytes (oracle_authority field)"
- Registry PDA
- Expected post-migration state: 81 bytes, oracle_authority = `5GeSYa2BYViRjqXGZvPGwWGkRLi7YyukmJTTGSQQw8FL`
- Link to this runbook
- Pre-flight script output (size, authority, agent_count)

### 2d. Record the proposal

Post the Squads transaction index to [HOL-250](/HOL/issues/HOL-250) as a comment.

---

## Step 3 — Second Signer Review

Before the second signer approves, they must **independently verify** the on-chain proposal.

### Verification checklist (second signer)

- [ ] Open the Squads transaction and view raw instruction data
- [ ] Confirm program ID matches the deployed mainnet vaultpact program
- [ ] Confirm account [0] is the AttestationRegistry PDA and is marked writable
- [ ] Confirm account [1] is the vault PDA and is marked signer
- [ ] Confirm instruction data hex matches the discriminator `98 9c 86 bf 8e 90 d9 d1`
      (= `[152, 156, 134, 191, 142, 144, 217, 209]` in decimal)
- [ ] No unexpected accounts are included in the instruction
- [ ] The Paperclip issue [HOL-250](/HOL/issues/HOL-250) is in `in_progress` status
- [ ] Pre-flight output is posted in the issue comments

If anything is unclear: **reject and investigate** — do not approve under uncertainty.

Post an approval comment to [HOL-250](/HOL/issues/HOL-250) confirming each item above.

---

## Step 4 — Execute the Transaction

After both signers approve, either signer may execute the transaction.

1. Click **Execute** in the Squads UI.
2. Confirm on your hardware wallet — verify the transaction contents match what you approved.
3. Record the transaction signature.
4. Post the signature to [HOL-250](/HOL/issues/HOL-250):
   ```
   Migration executed: https://explorer.solana.com/tx/<SIGNATURE>
   ```

---

## Step 5 — Post-Migration Verification

Immediately after execution, run the verification script.

```bash
npx ts-node scripts/mainnet-migrate-attestation-registry.ts \
  --verify \
  --program-id <MAINNET_PROGRAM_ID>
```

### Expected output

```
MAINNET POST-MIGRATION VERIFICATION
...
Size (bytes):       81
authority:          F7koW9b6RYpGrwEXNCGx5V5cKmK2YwhR5e5UyPyBj1J9
agent_count:        <N>  (unchanged from pre-migration)
oracle_authority:   5GeSYa2BYViRjqXGZvPGwWGkRLi7YyukmJTTGSQQw8FL
bump:               <B>  (unchanged from pre-migration)

✅ Size: 81 bytes
✅ oracle_authority: 5GeSYa2BYViRjqXGZvPGwWGkRLi7YyukmJTTGSQQw8FL
✅ authority: F7koW9b6RYpGrwEXNCGx5V5cKmK2YwhR5e5UyPyBj1J9
✅ bump: <B>
✅ agent_count: <N>
Post-migration verification PASSED.
```

Post the full verification output to [HOL-250](/HOL/issues/HOL-250).

### If verification fails

Do not perform any further operations. Proceed to the Rollback section.

---

## Step 6 — Double-Migration Sanity Check

Confirm the idempotency guard works by re-running the dry-run script:

```bash
npx ts-node scripts/mainnet-migrate-attestation-registry.ts \
  --dry-run \
  --program-id <MAINNET_PROGRAM_ID>
```

Expected: `Migration not required — registry is already at 81 bytes.`

This confirms the `AlreadyMigrated` guard is functioning correctly and that
a second accidental proposal execution would be a no-op.

---

## Step 7 — Close Out

- [ ] Post verification output and Squads tx signature to [HOL-250](/HOL/issues/HOL-250)
- [ ] Mark [HOL-250](/HOL/issues/HOL-250) as `done`
- [ ] Update [HOL-233](/HOL/issues/HOL-233) (parent) — migration path is now executed
- [ ] Schedule oracle authority rotation if applicable ([HOL-236](/HOL/issues/HOL-236))
- [ ] Update this runbook: fill in the executed tx signature and final state below

### Execution record (fill after completion)

| Field | Value |
|---|---|
| Executed date | |
| Squads transaction index | |
| Transaction signature | |
| Pre-migration size | 49 bytes |
| Post-migration size | 81 bytes |
| oracle_authority set to | `5GeSYa2BYViRjqXGZvPGwWGkRLi7YyukmJTTGSQQw8FL` |
| Verified by | |

---

## Rollback Procedures

### If the transaction fails to execute (pre-execution)

No on-chain state has changed. The registry remains at 49 bytes.

Actions:
1. Review the error in the Squads UI (insufficient rent, wrong accounts, etc.).
2. Fix the issue in the proposal or create a new proposal.
3. Re-run the pre-flight script to confirm state is unchanged before retrying.

The transaction is safe to retry as many times as needed — the instruction is a no-op
if the registry is already 81 bytes.

### If the transaction succeeds but verification fails

This indicates an unexpected state. **Do not proceed with any further operations.**

Immediate actions:
1. Capture the full `--verify` output and the Squads transaction signature.
2. Inspect the raw account data:
   ```bash
   solana account <REGISTRY_PDA> --url mainnet-beta --output json
   ```
3. Post the raw account data to [HOL-250](/HOL/issues/HOL-250) and escalate to Security Lead immediately.
4. Do not execute any governance operations (oracle rotation, authority changes) until the state is understood.

Root-cause analysis: the most likely causes are a wrong program deployment (a program version
without migrate_attestation_registry) or a wrong account passed in the instruction. Both
are diagnosable from the Squads execution transaction logs.

**There is no automated rollback of the on-chain realloc.** However:
- The `migrate_attestation_registry` instruction does not change program logic or keys.
- If the data fields are wrong (e.g., oracle_authority set to wrong value), the oracle authority
  can be corrected via `set_oracle_authority` ([HOL-236](/HOL/issues/HOL-236)).
- If the account is corrupted beyond the above, an upgrade to a patched program version
  may be required, subject to the upgrade authority transfer process ([HOL-237](/HOL/issues/HOL-237)).

### If a signer is unavailable during the 2-of-2 approval

The proposal remains pending — no action has been taken on-chain. Options:
1. Wait for the unavailable signer to return.
2. If the signer is permanently unavailable, follow the signer rotation procedure
   in [`multisig-key-management-policy.md §6`](./multisig-key-management-policy.md).
3. The pending proposal can be cancelled by either signer at any time.

### Can the migration be safely retried?

Yes. The instruction guards on `old_len == 49` bytes:
- If the account is already 81 bytes, `AlreadyMigrated` is returned and nothing changes.
- A failed (reverted) transaction leaves the account at 49 bytes — retry is safe.

---

## Timing and Downtime

The migration is a single Solana transaction. Execution time is ~400ms (1 block). There is
no protocol downtime — the realloc is atomic and other instructions can be processed before
and after.

**There is no maintenance window required** for this migration.

However, coordinate with the team to avoid executing the migration while:
- A high-volume `update_reputation` event is in progress (race condition is not harmful, but avoids noise in monitoring).
- Any governance proposals are pending execution (to keep the audit trail clean).

Recommended execution window: business hours with both signers and the Solana Engineer online.

---

## Monitoring

Watch for these metrics during and after migration:

| Signal | Expected | Tool |
|---|---|---|
| Registry account size | 81 bytes post-migration | `--verify` script |
| oracle_authority field | `5GeSYa2BYViRjqXGZvPGwWGkRLi7YyukmJTTGSQQw8FL` | `--verify` script |
| Indexer registry events | No unexpected events | Indexer logs |
| update_reputation calls | Continue to succeed post-migration | Oracle daemon logs |

The oracle daemon does not need to be restarted — it reads `oracle_authority` at runtime
and the value set by the migration matches the compile-time constant already in use.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Transaction reverts (wrong accounts or data) | Low | None (state unchanged) | Pre-flight script validates instruction data |
| Double-execution by accident | Low | None (AlreadyMigrated guard) | Idempotency built into instruction |
| Signer key compromise during proposal period | Very low | High | Keep proposal window short; monitor Squads vault activity |
| oracle_authority set to wrong value | Very low | Medium | Post-migration verification; fixable via set_oracle_authority |
| Account data corruption | Extremely low | High | Mitigated by discriminator check in instruction |
| Loss of agent_count or authority data | Extremely low | High | Instruction preserves fields; verification confirms |

---

## Success Criteria

All of the following must be true before closing HOL-250:

1. `--verify` script reports PASSED with no errors
2. Registry size is 81 bytes on mainnet
3. `oracle_authority` = `5GeSYa2BYViRjqXGZvPGwWGkRLi7YyukmJTTGSQQw8FL`
4. `authority` = `F7koW9b6RYpGrwEXNCGx5V5cKmK2YwhR5e5UyPyBj1J9` (unchanged)
5. `agent_count` is unchanged from pre-migration snapshot
6. `bump` is unchanged from pre-migration snapshot
7. Double-migration guard confirmed (`--dry-run` reports migration not required)
8. Execution tx signature posted to HOL-250
9. Security Lead has signed off on verification results

---

## References

- [`multisig-key-management-policy.md`](./multisig-key-management-policy.md) — Squads vault procedures, signer requirements
- [`governance-devnet.md`](./governance-devnet.md) — authority policy, gated instructions
- [`oracle-authority-rotation-runbook.md`](./oracle-authority-rotation-runbook.md) — post-migration oracle rotation
- [`mainnet-secrets-manager-policy.md`](./mainnet-secrets-manager-policy.md) — secret lifecycle controls
- [`THREAT_MODEL.md`](./THREAT_MODEL.md) — TA-4 (protocol authority compromise) threat analysis
- Squads v4 docs: https://docs.squads.so
- Migration script: [`scripts/mainnet-migrate-attestation-registry.ts`](../scripts/mainnet-migrate-attestation-registry.ts)
- Devnet migration script (HOL-249): [`scripts/execute-attestation-registry-migration.ts`](../scripts/execute-attestation-registry-migration.ts)
