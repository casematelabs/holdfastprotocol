// Byte layout constants for ReputationAccount on-chain data (schema v1).
//
// Raw account layout (512 bytes total):
//  0  [8]  discriminator
//  8  [1]  schema_version: u8
//  9  [32] agent: Pubkey
// 41  [8]  score: u64
// 49  [1]  tier: VerifTier (u8)
// 50  [8]  total_pacts: u64
// 58  [8]  dispute_count: u64
// 66  [8]  created_at: i64
// 74  [8]  last_updated: i64
// 82  [8]  decay_cursor: i64
// 90  [8]  nonce: u64
// 98  [1]  history_len: u8
// 99  [1]  history_head: u8
//100  [360] history: [HistEntry; 20]  (18 bytes × 20)
//460  [51] _padding (reserved)
//511  [1]  bump: u8
//
// HistEntry layout (18 bytes each):
//  0  [1]  outcome: PactOutcome (u8)
//  1  [2]  score_delta: i16 (LE)
//  3  [8]  timestamp: i64 (LE)
// 11  [7]  pact_id: [u8; 7]

export const REPUTATION_ACCOUNT_SCHEMA_VERSION = 1;
export const ACCOUNT_SIZE = 512;
export const HIST_ENTRY_SIZE = 18;

export const OFF_SCHEMA_VERSION = 8;
export const OFF_HISTORY_LEN = 98;
export const OFF_HISTORY_HEAD = 99;
export const OFF_HISTORY = 100;
