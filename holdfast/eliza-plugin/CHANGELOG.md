# Changelog

All notable changes to `@holdfastprotocol/eliza-plugin` will be documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.1.0-devnet.2] — 2026-05-04

### Added

- Plugin config now accepts `escrowProgramId` and `holdfastProgramId`
  overrides for non-default deployments. Both are validated as base58
  Solana public keys at `createHoldfastPlugin()` time.
- `CREATE_PACT` action accepts optional `arbiter` and `arbiterWallet`
  options so agents can create pacts with an explicit on-chain arbiter
  rather than the default initiator-as-arbiter shape.
- Live devnet integration test path:
  `src/tests/integration.devnet.test.ts` runs a 5-action smoke against
  the deployed devnet programs. Skipped unless `HF_DEVNET_*` env vars
  are present so CI without creds doesn't break.
  - `scripts/run-devnet-integration.ps1`: Windows runner that loads
    `.env.devnet.integration` and executes the test.
  - `scripts/bootstrap-devnet-env.ps1`: auto-fills signer, agentWallet,
    counterparty from `~/.config/solana/devnet.json`.
  - `.env.devnet.integration.example`: required and optional env var
    template.
- npm scripts: `test:integration:devnet`, `:ps1`, `:status`, `:bootstrap`.

### Changed

- README polished for the standalone public mirror: badges restored,
  contributor link points at `casematelabs/holdfastprotocol-eliza-plugin/issues`
  (was `casematelabs/sdk/issues`), SDK pin in the dependencies table
  bumped to `^0.2.0-devnet.2`, drop internal CAS prefix from the
  integration test setup heading, drop dead `../../docs/*` cross-links
  that don't resolve in the standalone repo.
- `@holdfastprotocol/sdk` peer pin bumped from `0.2.0-devnet.1` to
  `^0.2.0-devnet.2` (matches the current devnet dist-tag).
- `package.json` now declares `repository`, `homepage`, and `bugs`
  pointing at `casematelabs/holdfastprotocol-eliza-plugin` so npm
  surfaces the source-repo links and issues tracker on the package
  page.
- README program-ID table: `vaultpact_escrow` updated to the
  redeployed devnet ID `CAZMkHiE...Rp6yi`.

### Docs

- Added `holdfast/docs/elizaos-integration-guide.md` (in the monorepo) — full guide covering plugin setup, all three signer patterns, character file wiring, actions/providers/evaluator reference, environment variables, and a troubleshooting section.

---

## [0.1.0-devnet.1] — 2026-04-20

> **Pre-audit devnet release.** Not for mainnet or production use.
> All clients emit `PREAUDIT_WARNING` from `@holdfastprotocol/sdk` on init.

### Added

- `createHoldfastPlugin(config)` factory — returns an ElizaOS `Plugin` bound to the given signer and RPC config
- **Actions**: `CHECK_REPUTATION`, `CREATE_PACT`, `DEPOSIT_ESCROW`, `RELEASE_PACT`, `OPEN_DISPUTE`
- **Providers**: reputation context provider, active pacts context provider — inject agent state into ElizaOS context window
- **Evaluator**: `reputationThreshold` — validates counterparty reputation score post-action
- **Service**: `EscrowEventListenerService` — background poll every 30 s for escrow state transitions, notifies agent runtime
- `HoldfastPluginConfig` type export — configure RPC URL, indexer URL, and signer
- Devnet-only guard (inherited from `@holdfastprotocol/sdk`) rejects mainnet RPC connections
