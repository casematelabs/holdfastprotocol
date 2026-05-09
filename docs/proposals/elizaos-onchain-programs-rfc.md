# RFC: First-class on-chain program addresses in plugin registry entries

> **Status:** Draft for posting to `elizaOS/eliza` Discussions › Ideas / RFC
> **Authored by:** Matthew @ Casemate Labs
> **Following on from:** [elizaOS/discussions#7071](https://github.com/orgs/elizaOS/discussions/7071)
> **Co-signer:** @MrTalecky (offered to comment in support, see thread)

---

Following up on a thread from [elizaOS/discussions#7071](https://github.com/orgs/elizaOS/discussions/7071) where @MrTalecky and I agreed this was worth raising standalone.

## The problem

Plugins that interact with on-chain programs — escrow, trading, identity, reputation — are tied to specific deployed program addresses. Today the registry schema (`packages/app-core/src/registry/schema.ts`) has no field for these. Operators discover them by reading docs, package source, or environment files distributed with the plugin.

That's fine for a curated bundle. It's a real exposure for installable plugins where money moves:

- **Drift.** A plugin's npm version and the program ID it talks to can desync. We hit this ourselves recently — a devnet redeploy migrated `vaultpact` to `2chF47Db…` and we had to ripple the change through the SDK, dashboard, runbooks, threat model, and seven test files. Anyone who'd installed mid-flight against an old version would have been talking to a stale program.
- **Verification.** There's no install-time mechanism to assert "the package I just installed talks to the program I expect to talk to." A compromised npm release could redirect to an attacker-controlled program with no on-chain change visible.
- **Multi-network.** Same plugin, different program addresses across devnet / testnet / mainnet. Currently encoded ad-hoc per plugin.
- **Audit scope.** External auditors of a financial plugin need a single canonical answer to "which deployed programs does this version trust?" Spreading it across docs and configs makes that question harder than it should be.

## What we ship today as a workaround

Holdfast publishes a `release-manifest.json` alongside each SDK release that pins the on-chain program IDs that version expects. The SDK and our dashboard both consume it at runtime to refuse mismatches. That works for us, but it's per-package convention — there's no way for the elizaOS surface to know about it, surface it to operators, or enforce it.

## Proposed addition to `commonFields`

```ts
const onchainProgramSchema = z.object({
  network: z.enum([
    "solana-mainnet", "solana-devnet", "solana-testnet",
    "ethereum-mainnet", "ethereum-sepolia", "base-mainnet",
  ]),
  address: z.string(),
  role: z.string().optional(),       // e.g. "vaultpact", "escrow", "registry"
  releaseManifestUrl: z.string().url().optional(),
});

const commonFields = {
  // ...existing...
  onchainPrograms: z.array(onchainProgramSchema).default([]),
};
```

For Holdfast, our entry would carry:

```json
"onchainPrograms": [
  { "network": "solana-devnet", "address": "2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq", "role": "vaultpact" },
  { "network": "solana-devnet", "address": "CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi", "role": "vaultpact_escrow" }
]
```

## Why this isn't just documentation

It changes the contract from "operators figure out which program this plugin talks to" into "the registry asserts which program this plugin version trusts". That makes:

- **Install-time checks possible.** The runtime can warn or refuse if the resolved program ID doesn't match the registry-declared one.
- **Migration auditable.** A version bump that changes `address` is visible in the registry diff, not buried in source.
- **Consumer queries cheap.** "Which plugins on the registry talk to program X?" becomes a registry query, not a documentation hunt.

## Open questions

1. **Schema location.** `commonFields`, or only on the `pluginEntrySchema` `subtype: "blockchain"` branch?
2. **Address typing.** Should `address` be a string or a discriminated union per chain (Solana base58 vs EVM hex)?
3. **Manifest semantics.** Where does `releaseManifestUrl` live? Convention? Schema'd format? Out of scope?
4. **Separate kind.** Is there appetite for a separate `kind: "onchain-program"` registry entry that plugins reference by id, so the same program can be authoritatively described once and referenced by multiple plugins (reputation reader + escrow writer pointing at the same vaultpact program, for example)?

Happy to PR a concrete schema change once a direction lands. Filed separately from the original Holdfast registry submission so it can be evaluated on its own merits and benefit any financial / escrow plugin.

— Matthew @ Casemate Labs
