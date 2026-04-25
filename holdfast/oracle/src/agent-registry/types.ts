// Parsed from a ValidationRequested Anchor event emitted by the Agent Registry program.
// Event layout (confirmed CAS-50):
//   asset              [u8; 32]  — asset pubkey being validated
//   validator_address  [u8; 32]  — validator / oracle pubkey
//   nonce              u32 LE    — per-pair request counter
//   request_hash       [u8; 32]  — SHA-256 commitment
export interface ValidationRequestedEvent {
  signature: string;
  asset: string;            // base58 pubkey
  validatorAddress: string; // base58 pubkey
  nonce: number;            // u32
  requestHash: Buffer;      // 32 bytes (SHA-256)
  detectedAt: number;       // unix seconds
}

// Argument bundle passed to AgentRegistryResponder.submitResponse.
export interface ValidationResponse {
  asset: string;            // base58 pubkey
  validatorAddress: string; // base58 pubkey
  nonce: number;            // u32
  score: number;            // u8: 1–100; oracle's trust score for this asset
}

// On-chain ValidationRequest account layout (109 bytes, confirmed CAS-50):
//   asset              [u8; 32]
//   validator_address  [u8; 32]
//   nonce              u32 LE (4 bytes)
//   request_hash       [u8; 32]
//   response           u8  (0=pending, 1–100=score)
//   responded_at       i64 LE (8 bytes, 0 if pending)
export const VALIDATION_REQUEST_ACCOUNT_SIZE = 8 + 109; // 8-byte Anchor discriminator + 109 bytes data
