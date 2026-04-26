# Holdfast Protocol — Devnet Deployment Runbook

This covers the end-to-end process for upgrading the Holdfast programs on Solana devnet, verifying the upgrade succeeded, and rolling back if something goes wrong.

---

## Prerequisites

| Requirement | Detail |
|---|---|
| Solana CLI | v2.2.20 (`solana --version`) |
| Anchor CLI | v0.31.0 (`anchor --version`) |
| Deploy wallet | `~/.config/solana/devnet.json` — funded with ≥ 0.5 SOL |
| Protocol authority keypair | `keys/devnet-protocol-authority.json` — gitignored, stored in **1Password** vault "Holdfast Engineering" |
| Oracle keypair | `~/.config/solana/oracle-devnet.json` — required for smoke test only |
| RPC endpoint | `https://api.devnet.solana.com` (or set `ANCHOR_PROVIDER_URL`) |

Set your default Solana config before starting:

```bash
solana config set --url devnet --keypair ~/.config/solana/devnet.json
```

---

## Program IDs

| Program | Module name | Program ID |
|---|---|---|
| Holdfast (agent registry) | `vaultpact` | `D6mUa4wGtFyLyJorMfxoKvA9ybohjUSsfw88t66ATxg` |
| Holdfast Escrow | `vaultpact_escrow` | `BNxA76z6vjQYtUJXGpH8qjA3wHvtAAqGqL6rvVWH6b3H` |

> Note: The Anchor module names (`vaultpact`, `vaultpact_escrow`) are the on-chain identifiers and are unchanged by the Holdfast brand rename. Do not rename them.

---

## Upgrade Sequence

### 1. Build the programs

```bash
cd holdfast
anchor build
```

Verify the build outputs match the expected program IDs:

```bash
solana-keygen pubkey target/deploy/vaultpact-keypair.json
# Expected: D6mUa4wGtFyLyJorMfxoKvA9ybohjUSsfw88t66ATxg

solana-keygen pubkey target/deploy/vaultpact_escrow-keypair.json
# Expected: BNxA76z6vjQYtUJXGpH8qjA3wHvtAAqGqL6rvVWH6b3H
```

If the pubkeys don't match, stop. The keypair files are gitignored — retrieve them from 1Password (see Prerequisites).

### 2. Write program buffers

Write each program to a buffer account before upgrading. This lets you verify the binary is correct before it goes live.

```bash
# Holdfast program
solana program write-buffer \
  target/deploy/vaultpact.so \
  --url devnet \
  --keypair ~/.config/solana/devnet.json

# Escrow program
solana program write-buffer \
  target/deploy/vaultpact_escrow.so \
  --url devnet \
  --keypair ~/.config/solana/devnet.json
```

Note the buffer account addresses printed by each command (`Buffer: <address>`).

### 3. Set buffer authority

Transfer buffer authority to the upgrade authority keypair:

```bash
# Replace <HOLDFAST_BUFFER> and <ESCROW_BUFFER> with the addresses from step 2
PROTOCOL_AUTHORITY_PUBKEY=$(solana-keygen pubkey keys/devnet-protocol-authority.json)

solana program set-buffer-authority <HOLDFAST_BUFFER> \
  --new-buffer-authority "$PROTOCOL_AUTHORITY_PUBKEY" \
  --url devnet

solana program set-buffer-authority <ESCROW_BUFFER> \
  --new-buffer-authority "$PROTOCOL_AUTHORITY_PUBKEY" \
  --url devnet
```

### 4. Upgrade programs

```bash
# Holdfast
solana program upgrade \
  <HOLDFAST_BUFFER> \
  D6mUa4wGtFyLyJorMfxoKvA9ybohjUSsfw88t66ATxg \
  --upgrade-authority keys/devnet-protocol-authority.json \
  --url devnet

# Escrow
solana program upgrade \
  <ESCROW_BUFFER> \
  BNxA76z6vjQYtUJXGpH8qjA3wHvtAAqGqL6rvVWH6b3H \
  --upgrade-authority keys/devnet-protocol-authority.json \
  --url devnet
```

> **Upgrade authority:** `9xSsPbk6Fh9LNfEsDnqM3SEwz4RDyqndgHhrAbRBomfk` (devnet single keypair; mainnet will use Squads v4 3-of-5). See `holdfast/docs/governance-devnet.md` for full authority policy.

---

## Verification Steps

### 1. Confirm programs are executable

```bash
solana program show D6mUa4wGtFyLyJorMfxoKvA9ybohjUSsfw88t66ATxg --url devnet
solana program show BNxA76z6vjQYtUJXGpH8qjA3wHvtAAqGqL6rvVWH6b3H --url devnet
```

Both should show `Executable: true` and the `Last Deployed In Slot` should be recent.

### 2. Update expected binary hashes

Capture and store the new hashes in the CI secret `EXPECTED_HOLDFAST_HASH` and `EXPECTED_ESCROW_HASH`:

```bash
solana program dump --url devnet \
  D6mUa4wGtFyLyJorMfxoKvA9ybohjUSsfw88t66ATxg \
  /tmp/holdfast.so
sha256sum /tmp/holdfast.so

solana program dump --url devnet \
  BNxA76z6vjQYtUJXGpH8qjA3wHvtAAqGqL6rvVWH6b3H \
  /tmp/escrow.so
sha256sum /tmp/escrow.so
```

Update the `EXPECTED_HOLDFAST_HASH` and `EXPECTED_ESCROW_HASH` secrets in GitHub → Settings → Secrets and variables → Actions. The next health check run (`devnet-health.yml`) will validate against these.

### 3. Run the devnet health check

```bash
./scripts/devnet-health-check.sh
```

Both programs should show `✅ Deployed and executable` and, if hashes are set, `✅ Binary hash matches expected`.

### 4. Run the smoke test

```bash
cd holdfast
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
INDEXER_URL=https://holdfast-indexer.fly.dev \
npx ts-node --transpile-only -P tsconfig.json scripts/devnet-smoke-test.ts
```

All 6 test groups should pass (createEscrow, releaseEscrow, disputeEscrow, cancelPendingEscrow, oracle reputation, indexer events).

---

## Rollback

If the upgrade produces unexpected behaviour, roll back by redeploying the previously verified binary. The old binary should be available in the GitHub Actions run artifacts or in your local build cache.

### Option A — Redeploy from a known-good artifact

1. Download the `devnet-build-<sha>-<run_id>` artifact from the last known-good deploy run (GitHub → Actions → Deploy to Devnet → the successful run → Artifacts).
2. Extract the `.so` files from the artifact.
3. Write a new buffer and upgrade as in steps 2–4 above, using the old `.so` files.

### Option B — Rebuild from a previous commit

```bash
git checkout <last-good-sha>
cd holdfast && anchor build
# Then follow steps 2–4
git checkout main
```

### After rollback

Re-run the health check and smoke test. Update the expected hash secrets to match the rolled-back binary.

---

## Contacts

| Role | Responsibility |
|---|---|
| Protocol authority holder | Must be present for `program upgrade` — holds `keys/devnet-protocol-authority.json` |
| On-call DevOps | Responds to health check alerts on HOL-20 |
| CTO | Escalation for unresolved deployment failures |

For mainnet deploys: consult `holdfast/docs/governance-devnet.md` for the Squads v4 multisig ceremony, which is required pre-mainnet.
