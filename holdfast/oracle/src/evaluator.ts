import { PactOutcome, VoteOutcome, type DisputeEvent, type ReputationUpdate } from "./types.js";

// Score deltas from CAS-11 §3.2.
const DELTA_FAULTED      = -400; // dispute — agent found at fault
const DELTA_NOT_AT_FAULT =  +20; // dispute — agent found not at fault (false-dispute signal)
const DELTA_MUTUAL       =    0; // cancelled by mutual agreement

// Map a resolved dispute to the two reputation updates that must be submitted on-chain.
// For the single-node devnet oracle, we trust the verdict carried in the escrow log directly.
// Mainnet: 3-of-5 quorum must agree before this function is called.
export function evaluateDispute(event: DisputeEvent): [ReputationUpdate, ReputationUpdate] {
  switch (event.outcome) {
    case VoteOutcome.AgentFaulted:
      return [
        { agentPubkey: event.agentPubkey,        onChainOutcome: PactOutcome.Disputed,  scoreDelta: DELTA_FAULTED,      pactId: event.pactId },
        { agentPubkey: event.counterpartyPubkey, onChainOutcome: PactOutcome.Disputed,  scoreDelta: DELTA_NOT_AT_FAULT, pactId: event.pactId },
      ];
    case VoteOutcome.CounterpartyFaulted:
      return [
        { agentPubkey: event.agentPubkey,        onChainOutcome: PactOutcome.Disputed,  scoreDelta: DELTA_NOT_AT_FAULT, pactId: event.pactId },
        { agentPubkey: event.counterpartyPubkey, onChainOutcome: PactOutcome.Disputed,  scoreDelta: DELTA_FAULTED,      pactId: event.pactId },
      ];
    case VoteOutcome.Mutual:
      return [
        { agentPubkey: event.agentPubkey,        onChainOutcome: PactOutcome.Cancelled, scoreDelta: DELTA_MUTUAL, pactId: event.pactId },
        { agentPubkey: event.counterpartyPubkey, onChainOutcome: PactOutcome.Cancelled, scoreDelta: DELTA_MUTUAL, pactId: event.pactId },
      ];
  }
}
