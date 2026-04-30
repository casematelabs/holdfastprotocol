# Release Manifest Mapping

Canonical metadata source of truth is [`release-manifest.json`](../release-manifest.json).

## In scope metadata

- SDK package/version
- Solana RPC endpoint
- Indexer endpoint
- Devnet program IDs
- Explorer cluster

## Current consumers and mappings

- `app/status/page.tsx`: consumes manifest values via `lib/release-manifest.ts`
  - SDK package + version badge
  - RPC endpoint host label and RPC probe URL
  - Explorer transaction links (cluster + base URL)
- `lib/indexer.ts`: consumes manifest-derived indexer default base URL via `DEVNET_INDEXER_BASE`
- `holdfast/sdk/src/client.ts`: explicitly mapped to manifest for default RPC/indexer constants (commented mapping), and version hardcoding removed from warnings

## Acceptance criteria for future releases

- Update `release-manifest.json` once per release.
- Verify these surfaces reflect the new values without additional hardcoded edits:
  - `/status` page SDK/RPC/explorer labels
  - app indexer client default base
- For SDK defaults, verify `holdfast/sdk/src/client.ts` constants still mirror the manifest (until SDK build pipeline can import the manifest directly).
