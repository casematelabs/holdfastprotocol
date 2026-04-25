// PactOutcome matches the on-chain enum in programs/vaultpact/src/lib.rs.
// Values must stay in sync — they are Borsh-encoded as u8 in update_reputation.
export const enum PactOutcome {
  Fulfilled = 0,
  Disputed  = 1,
  Cancelled = 2,
}

// Oracle's interpretation of a resolved dispute.
export const enum VoteOutcome {
  AgentFaulted        = "AgentFaulted",
  CounterpartyFaulted = "CounterpartyFaulted",
  Mutual              = "Mutual",
}

// Parsed from escrow program log line.
// Expected log format emitted by the escrow program:
//   Program log: VaultPactDisputeSettled pact=<14hex> agent=<base58> counterparty=<base58> verdict=<VoteOutcome>
export interface DisputeEvent {
  signature: string;
  pactId: Buffer;           // 7 bytes — first 7 of pact pubkey (display-only per CAS-11 §8.4)
  agentPubkey: string;      // base58
  counterpartyPubkey: string; // base58
  outcome: VoteOutcome;
  detectedAt: number;       // unix seconds
}

// One update_reputation call to submit for a single agent in a dispute.
export interface ReputationUpdate {
  agentPubkey: string;
  onChainOutcome: PactOutcome;
  scoreDelta: number; // i16 range
  pactId: Buffer;     // 7 bytes
}
