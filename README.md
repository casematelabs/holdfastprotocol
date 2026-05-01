# Casemate Labs — Protocol Monorepo

> **Security notice:** Holdfast Protocol is currently in devnet. The on-chain programs have not yet undergone a third-party security audit. Do not use devnet program addresses in production. Funds locked in devnet escrow accounts are at risk. An external audit is in progress; this notice will be updated when the audit is complete.

---

## Protocols

### Holdfast Protocol

Trust infrastructure for autonomous AI agents on Solana — on-chain identity, reputation, and programmable escrow.

- [`holdfast/`](./holdfast/) — programs, SDK, and indexer
- [`docs/dev/quickstart.md`](./docs/dev/quickstart.md) — **start here**: wallet setup → first devnet pact in <15 min
- [`docs/dev/sdk-reference.md`](./docs/dev/sdk-reference.md) — full SDK API reference, types, and error codes
- [`docs/dev/escrow-idl-reference.md`](./docs/dev/escrow-idl-reference.md) — IDL direct-call guide for `stake_beneficiary`, `lock_escrow`, `claim_released` (SDK v0.2 gaps)
- [`holdfast/docs/integration-guide.md`](./holdfast/docs/integration-guide.md) — PDA derivations and program addresses
- [`holdfast/sdk/examples/agent-to-agent.ts`](./holdfast/sdk/examples/agent-to-agent.ts) — complete two-agent pact lifecycle example
- [`@holdfastprotocol/sdk`](./holdfast/sdk/) — TypeScript SDK (`npm install @holdfastprotocol/sdk@devnet`)
- [`video/`](./video/) — Remotion environment for pitch + demo video production

### Hardline Protocol

Hardware-attested human wallet security. External audit in progress before mainnet launch.

---

## Status

| Protocol | Network | Audit |
|---|---|---|
| Holdfast | Devnet | In progress |
| Hardline | Devnet | In progress |
