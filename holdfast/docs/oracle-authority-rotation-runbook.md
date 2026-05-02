# Oracle Authority Rotation Runbook (HOL-236)

Rotate the on-chain oracle authority in `AttestationRegistry` from the
current plaintext keypair (`keys/mainnet-oracle-keypair.json`) to a new
Ledger-hardware-backed key.

## Background

The `AttestationRegistry.oracle_authority` field stores the ed25519 pubkey
whose signatures are accepted by `update_reputation`. Rotating it to a
hardware-backed key eliminates the SEC-HIGH-001 risk (plaintext oracle key on
developer workstation).

The rotation is executed via the `set_oracle_authority` instruction, which
requires the **protocol authority** signer (Squads 2-of-2 vault PDA on mainnet,
or devnet protocol authority keypair on devnet).

## Prerequisites

| Prerequisite | Ticket | Status |
|---|---|---|
| Ledger wallet set up with new oracle keypair | [HOL-234](/HOL/issues/HOL-234) | in_progress |
| New vaultpact program deployed to devnet | [HOL-215](/HOL/issues/HOL-215) | in_review |
| `set_oracle_authority` instruction in IDL | HOL-182 (code merged, not yet deployed) | blocked on HOL-215 |

## Current State (as of 2026-04-27)

| Field | Value |
|---|---|
| Program ID | `2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq` |
| Registry PDA | `G692JfAp6GrgqePqRJD2eL87TPTqqfeQTBzZQbGfZGKP` |
| Mainnet protocol authority | `F7koW9b6RYpGrwEXNCGx5V5cKmK2YwhR5e5UyPyBj1J9` (Squads 2-of-2) |
| Current oracle pubkey (hardcoded at init) | `5GeSYa2BYViRjqXGZvPGwWGkRLi7YyukmJTTGSQQw8FL` |
| Plaintext key location | `keys/mainnet-oracle-keypair.json` — **must be destroyed after rotation** |

> **Note:** As of 2026-04-27 the mainnet `AttestationRegistry` has not been
> initialized yet (PDA not found). The program must be initialized before
> rotation is possible. Devnet registry is on the old 49-byte layout and must
> be re-initialized after the new program is deployed.

---

## Step 1 — Devnet Test (run after HOL-215 resolves)

Once the new vaultpact program is deployed to devnet and the registry
re-initialized with the 81-byte layout:

```bash
# Rebuild IDL first (if not already done by CI)
anchor build

# Verify devnet registry is on new layout
npx ts-node scripts/set-oracle-authority.ts \
  --new-oracle 5GeSYa2BYViRjqXGZvPGwWGkRLi7YyukmJTTGSQQw8FL \
  --network devnet \
  --dry-run

# Run automated rotation round-trip test
npx ts-node scripts/test-oracle-rotation-devnet.ts
```

The test script (`scripts/test-oracle-rotation-devnet.ts`) generates an
ephemeral oracle keypair, rotates to it, verifies on-chain state, then
rotates back — leaving devnet clean.

---

## Step 2 — Obtain New Ledger Pubkey (HOL-234)

After the Ledger is initialized and the Solana app installed:

```bash
# On the Ledger, navigate to Solana app and display the public key.
# The derivation path for oracle is: m/44'/501'/1'/0'  (account index 1)
# Copy the displayed pubkey — this is NEW_ORACLE_PUBKEY.
```

Document the new Ledger oracle pubkey here once available: **`<TBD — HOL-234>`**

---

## Step 3 — Mainnet Rotation

The mainnet `AttestationRegistry.authority` is the Squads 2-of-2 vault PDA
(`F7koW9b6RYpGrwEXNCGx5V5cKmK2YwhR5e5UyPyBj1J9`). The rotation must be
submitted as a Squads proposal.

### 3a. Generate instruction data (dry-run)

```bash
export NEW_ORACLE_PUBKEY="<Ledger pubkey from HOL-234>"

npx ts-node scripts/set-oracle-authority.ts \
  --new-oracle "$NEW_ORACLE_PUBKEY" \
  --network mainnet \
  --dry-run
```

The dry-run prints:
- Instruction accounts (registry PDA + authority)
- Instruction data (hex)
- Discriminator bytes

### 3b. Submit via Squads

1. Open Squads vault `F7koW9b6RYpGrwEXNCGx5V5cKmK2YwhR5e5UyPyBj1J9`.
2. Create a new transaction proposal.
3. Add an instruction:
   - **Program:** `2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq`
   - **Accounts:**
     - `G692JfAp6GrgqePqRJD2eL87TPTqqfeQTBzZQbGfZGKP` (writable, not signer)
     - `F7koW9b6RYpGrwEXNCGx5V5cKmK2YwhR5e5UyPyBj1J9` (signer, not writable)
   - **Data:** hex from dry-run above
4. Collect both signatures from the 2-of-2 signers.
5. Execute the transaction.

### 3c. Verify on-chain

```bash
# Run the dry-run again — it will report the new oracle authority
npx ts-node scripts/set-oracle-authority.ts \
  --new-oracle "$NEW_ORACLE_PUBKEY" \
  --network mainnet \
  --dry-run
```

Expected output: `Current oracle authority: <NEW_ORACLE_PUBKEY>` and
`Oracle authority is already set to the target pubkey — nothing to do.`

Document the Squads execution transaction signature: **`<TBD after execution>`**

---

## Step 4 — Test New Authority

Verify the oracle daemon can sign `update_reputation` with the new Ledger key:

```bash
# Update keeper/oracle config to point to new Ledger keypair path or env var
# ORACLE_KEYPAIR_PATH=<path-to-ledger-backed-key>

# Submit one test update_reputation transaction
# Confirm it succeeds with the new signing key
```

---

## Step 5 — Securely Destroy Old Plaintext Key

> **This is irreversible. Confirm on-chain rotation success before proceeding.**

```bash
# Linux/macOS — secure overwrite
shred -u -z keys/mainnet-oracle-keypair.json

# Or: srm -z keys/mainnet-oracle-keypair.json
# Or: openssl rand -out keys/mainnet-oracle-keypair.json $(wc -c < keys/mainnet-oracle-keypair.json)
#     && rm keys/mainnet-oracle-keypair.json
```

On Windows:
```powershell
# PowerShell — overwrite with random bytes then delete
$len = (Get-Item "keys\mainnet-oracle-keypair.json").Length
[System.IO.File]::WriteAllBytes("keys\mainnet-oracle-keypair.json", (New-Object byte[] $len))
Remove-Item "keys\mainnet-oracle-keypair.json" -Force
```

Also remove any cached copies:
- Git history: file must not appear in git history (check with `git log --all --full-history -- keys/mainnet-oracle-keypair.json`)
- Backups, external drives, cloud sync
- CI secrets / env vars that contain the key bytes

---

## Rollback

**There is no automated rollback.** The rotation is irreversible unless:
1. The old plaintext key is still available (before step 5), AND
2. You have Squads quorum to submit another `set_oracle_authority` with the old pubkey.

Do NOT destroy the old key until the new authority is fully verified.
