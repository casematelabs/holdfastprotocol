# Changelog

All notable changes to `@holdfastprotocol/eliza-plugin` will be documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Docs

- Added `holdfast/docs/elizaos-integration-guide.md` — full guide covering plugin setup, all three signer patterns, character file wiring, actions/providers/evaluator reference, environment variables, and a troubleshooting section.

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
