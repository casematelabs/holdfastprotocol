# Holdfast Protocol Quickstart (Canonical Mirror)

This document intentionally mirrors the canonical SDK onboarding flow in:

- `holdfast/sdk/docs/quickstart.md` (canonical narrative — also published as the public SDK repo's docs)
- `holdfast/sdk/examples/quickstart.ts` (canonical runnable script)

If onboarding instructions need to change, update the canonical files first, then sync this mirror.

## Goal

Get from zero to your first confirmed devnet escrow pact in under 15 minutes using the currently supported SDK surface.

## Install

```bash
npm install @holdfastprotocol/sdk@devnet @solana/web3.js
```

## First Runnable Flow (Devnet Escrow Path)

1. Generate/fund a devnet keypair.
2. Register `AgentWallet` with `registerAgentWallet()`.
3. Create a pact with `client.escrow.createPact()`.
4. Read the pact back with `client.escrow.getPact()`.

Run the canonical script:

```bash
KEYPAIR_PATH=~/.config/solana/devnet.json \
npx ts-node --esm holdfast/sdk/examples/quickstart.ts
```

For full setup, expected output, timed-release patterns, and lifecycle next steps, use:

- `holdfast/sdk/docs/quickstart.md`
- `examples/holdfast-quickstart/README.md`
