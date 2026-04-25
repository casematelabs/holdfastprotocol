# Devnet Protocol Authority — Governance Note

## Decision

For devnet, `INITIAL_AUTHORITY` is a **developer-controlled single keypair**.

Rationale: devnet requires fast iteration for protocol admin operations
(initialize_registry, set_agent_status, set_protocol_authority, protocol_freeze_pact).
Multisig ceremony adds latency that is unacceptable during development. The keypair
will be replaced by a Squads v4 multisig vault PDA for mainnet.

## Authority Details

| Environment | Authority Type | Pubkey |
|-------------|---------------|--------|
| devnet | Single keypair | `9xSsPbk6Fh9LNfEsDnqM3SEwz4RDyqndgHhrAbRBomfk` |
| mainnet | Squads v4 vault PDA (3-of-5) | TBD pre-mainnet |

## Keypair Location

- File: `keys/devnet-protocol-authority.json`
- This file is gitignored — share via team secrets manager (1Password vault "Holdfast Engineering")
- The keypair is distinct from the deploy wallet (`~/.config/solana/devnet.json`)

## Gated Instructions

The following instructions require `INITIAL_AUTHORITY` as signer:

1. `initialize_registry` — one-time attestation registry init
2. `set_protocol_authority` — rotate the on-chain authority
3. `set_agent_status` — freeze/blacklist/deregister agents

## ALLOWED_ORIGINS (WebAuthn)

Devnet origins:
- `https://devnet.holdfastprotocol.com`
- `https://devnet-api.holdfastprotocol.com`
- `http://localhost:3000` / `:3001` / `:5173` (local dev only)

Mainnet origins:
- `https://holdfastprotocol.com`
- `https://api.holdfastprotocol.com`

## Compile-Time Guards

- Mainnet build (`--features mainnet`) will fail if `INITIAL_AUTHORITY` is still the zero address
- Unit tests verify devnet constant is non-zero and distinct from escrow/oracle authorities
- See `programs/vaultpact/src/lib.rs` test module: `initial_authority_devnet_is_nonzero`,
  `initial_authority_distinct_from_reputation_authorities`, `all_authority_gated_instructions_use_same_constant`

## Rotation Plan

1. **Devnet**: rotate by generating new keypair, updating `lib.rs` constant, redeploying
2. **Mainnet**: `set_protocol_authority` requires the current `INITIAL_AUTHORITY` signer — multisig threshold approval needed
