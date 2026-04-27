# Escrow Program Upgrade Authority Transfer Runbook (HOL-237)

Transfer the `vaultpact_escrow` program's upgrade authority from the plaintext
`mainnet-escrow-program-keypair.json` to the Squads 2-of-2 governance vault.

After this transfer, all future program upgrades require 2-of-2 approval through
the Squads vault (`F7koW9b6RYpGrwEXNCGx5V5cKmK2YwhR5e5UyPyBj1J9`). The
plaintext keypair is then destroyed.

## Background

The `vaultpact_escrow` upgrade authority is currently a plaintext JSON keypair
stored at `holdfast/keys/mainnet-escrow-program-keypair.json` on the developer
workstation (SEC-HIGH-001 finding, [HOL-229](/HOL/issues/HOL-229)).

Holding this key as plaintext means workstation compromise allows deployment of
arbitrary bytecode to the escrow program address — the highest-impact attack
surface in the protocol (all escrowed funds at risk).

Transferring to the Squads vault requires 2-of-2 multisig approval for any future
upgrade, eliminating single-point-of-failure risk.

## Current State (as of 2026-04-27)

| Field | Value |
|-------|-------|
| Devnet program ID | `BNxA76z6vjQYtUJXGpH8qjA3wHvtAAqGqL6rvVWH6b3H` |
| Mainnet program ID | TBD — derive with `solana-keygen pubkey keys/mainnet-escrow-program-keypair.json` |
| Target upgrade authority (Squads vault PDA) | `F7koW9b6RYpGrwEXNCGx5V5cKmK2YwhR5e5UyPyBj1J9` |
| Squads vault configuration | 2-of-2 threshold |
| Current mainnet upgrade authority | `keys/mainnet-escrow-program-keypair.json` (plaintext — **MUST BE DESTROYED after transfer**) |
| Devnet upgrade authority keypair | `~/.config/solana/upgrade-authority.json` (DEVNET_UPGRADE_AUTHORITY_JSON secret) |

## Prerequisites

| Prerequisite | Status |
|---|---|
| Squads 2-of-2 vault live (`F7koW9b6RYpGrwEXNCGx5V5cKmK2YwhR5e5UyPyBj1J9`) | ✅ Done |
| Devnet test scripts written | ✅ Done (HOL-237) |
| `keys/mainnet-escrow-program-keypair.json` present | Required |
| Mainnet program deployed | Required before transfer |
| Both Squads signers available | Required for mainnet verification |
| [HOL-215](/HOL/issues/HOL-215) devnet deploy secrets fixed | Required for devnet test |

---

## Step 1 — Devnet Test (requires HOL-215 resolved)

Once the devnet escrow program is on the latest build, run the automated round-trip
test. This verifies the BPF Loader SetAuthority mechanism before mainnet execution.

```bash
# Ensure you have the devnet upgrade authority keypair locally
# (same bytes as the DEVNET_UPGRADE_AUTHORITY_JSON GitHub secret)

npx ts-node scripts/test-escrow-upgrade-authority-devnet.ts

# If your keypair is at a non-default path:
UPGRADE_AUTHORITY_KEYPAIR=~/.config/solana/my-authority.json \
  npx ts-node scripts/test-escrow-upgrade-authority-devnet.ts
```

Expected output: two transactions (transfer + restore), both PASS.

Also run a manual check to confirm current state:

```bash
npx ts-node scripts/transfer-escrow-upgrade-authority.ts --check
```

---

## Step 2 — Determine Mainnet Program ID

The mainnet escrow program ID is the public key of `mainnet-escrow-program-keypair.json`:

```bash
solana-keygen pubkey holdfast/keys/mainnet-escrow-program-keypair.json
```

Record the result: **`<MAINNET_ESCROW_PROGRAM_ID>`**

Verify the program is deployed:

```bash
solana program show <MAINNET_ESCROW_PROGRAM_ID> --url mainnet-beta
```

Expected output includes `Upgrade Authority:` showing the current authority pubkey.
If the program is not deployed, the upgrade authority transfer cannot proceed —
deploy to mainnet first.

---

## Step 3 — Pre-Transfer Verification

Confirm the current on-chain state matches expectations:

```bash
export MAINNET_ESCROW_PROGRAM_ID="<pubkey from Step 2>"

npx ts-node scripts/transfer-escrow-upgrade-authority.ts \
  --check \
  --network mainnet \
  --program-id "$MAINNET_ESCROW_PROGRAM_ID"
```

Expected: `Upgrade authority: <pubkey-of-mainnet-escrow-program-keypair.json>`

Cross-check the pubkey:

```bash
solana-keygen pubkey holdfast/keys/mainnet-escrow-program-keypair.json
```

These two pubkeys must match. If they differ, stop and investigate before proceeding.

---

## Step 4 — Generate Transfer Command

```bash
export MAINNET_ESCROW_PROGRAM_ID="<pubkey from Step 2>"

npx ts-node scripts/transfer-escrow-upgrade-authority.ts \
  --new-authority F7koW9b6RYpGrwEXNCGx5V5cKmK2YwhR5e5UyPyBj1J9 \
  --network mainnet \
  --program-id "$MAINNET_ESCROW_PROGRAM_ID" \
  --dry-run
```

The output prints the exact `solana program set-upgrade-authority` command and the
raw BPF Loader instruction details for Squads manual entry.

---

## Step 5 — Execute the Transfer

The transfer requires the current upgrade authority keypair to sign. Execute on the
machine holding `keys/mainnet-escrow-program-keypair.json`:

```bash
export MAINNET_ESCROW_PROGRAM_ID="<pubkey from Step 2>"

solana program set-upgrade-authority \
  --skip-new-upgrade-authority-signer-check \
  "$MAINNET_ESCROW_PROGRAM_ID" \
  --new-upgrade-authority F7koW9b6RYpGrwEXNCGx5V5cKmK2YwhR5e5UyPyBj1J9 \
  --keypair holdfast/keys/mainnet-escrow-program-keypair.json \
  --url mainnet-beta
```

Record the transaction signature from the output: **`<TRANSFER_TX_SIG>`**

Verify on Solana Explorer:
`https://explorer.solana.com/tx/<TRANSFER_TX_SIG>`

---

## Step 6 — Post-Transfer Verification

Confirm the upgrade authority changed on-chain:

```bash
npx ts-node scripts/transfer-escrow-upgrade-authority.ts \
  --check \
  --network mainnet \
  --program-id "$MAINNET_ESCROW_PROGRAM_ID"
```

Expected: `Upgrade authority: F7koW9b6RYpGrwEXNCGx5V5cKmK2YwhR5e5UyPyBj1J9`

Also verify via CLI:

```bash
solana program show "$MAINNET_ESCROW_PROGRAM_ID" --url mainnet-beta
```

Expected: `Upgrade Authority: F7koW9b6RYpGrwEXNCGx5V5cKmK2YwhR5e5UyPyBj1J9`

**Do not proceed to Step 7 until this check passes.**

---

## Step 7 — Test Squads Upgrade Flow (no-op proposal)

Verify that the 2-of-2 signers can create and approve an upgrade proposal before
destroying the old key. This confirms the vault controls the upgrade authority.

1. Open Squads UI for vault `F7koW9b6RYpGrwEXNCGx5V5cKmK2YwhR5e5UyPyBj1J9`
2. Create a new transaction with a no-op `solana program upgrade` instruction
   (upload the same binary that is currently deployed — hash should match)
3. Both signers approve
4. Execute; verify the deployed binary hash is unchanged

This is the Squads "dry run" — confirms the signing flow works without changing
anything meaningful.

---

## Step 8 — Securely Destroy Old Keypair

> **This is irreversible. Confirm on-chain verification (Step 6) and Squads test
> (Step 7) pass before proceeding.**

Post a comment on [HOL-237](/HOL/issues/HOL-237) with:
- Transfer transaction signature from Step 5
- Confirmation that Step 6 verification passed
- Confirmation that Step 7 Squads test passed

Then destroy the plaintext keypair:

**Linux/macOS:**
```bash
shred -u -z holdfast/keys/mainnet-escrow-program-keypair.json
```

**Windows (PowerShell):**
```powershell
$f = "holdfast\keys\mainnet-escrow-program-keypair.json"
$len = (Get-Item $f).Length
[System.IO.File]::WriteAllBytes($f, (New-Object byte[] $len))
Remove-Item $f -Force
```

Also check and remove any copies:

```bash
# Confirm key never entered git history
git log --all --full-history -- holdfast/keys/mainnet-escrow-program-keypair.json

# Remove from cloud backups / external drives manually
# Remove from any CI secrets that may hold the key bytes
```

---

## Rollback

**There is no automated rollback.** Once the upgrade authority is transferred to
Squads, the only way back is through a Squads vault proposal approved by both
2-of-2 signers.

If the old plaintext key is still available (before Step 8), a rollback is:

```bash
solana program set-upgrade-authority \
  --skip-new-upgrade-authority-signer-check \
  "$MAINNET_ESCROW_PROGRAM_ID" \
  --new-upgrade-authority <OLD_AUTHORITY_PUBKEY> \
  # This requires the SQUADS VAULT to sign, not the old keypair
```

Since the Squads vault is now the authority, any further authority changes must
go through Squads. Do NOT destroy the old key until all verification passes.

---

## References

- Script: `scripts/transfer-escrow-upgrade-authority.ts`
- Devnet test: `scripts/test-escrow-upgrade-authority-devnet.ts`
- Oracle runbook (parallel process): `docs/oracle-authority-rotation-runbook.md`
- Multisig policy: `docs/multisig-key-management-policy.md`
- HOL-229: SEC-HIGH-001 parent tracking issue
- HOL-215: Devnet deploy secrets (required for devnet test)
