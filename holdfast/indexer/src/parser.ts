import { PactOutcome } from "./types.js";

export interface ParsedReputationEvent {
  agent: string;
  score: number;
  nonce: number;
  outcome: PactOutcome;
}

// Matches: "Reputation updated: agent=<base58> score=<u64> nonce=<u64> outcome=<u8>"
// Emitted by update_reputation in lib.rs via msg!()
const LOG_RE =
  /^Reputation updated: agent=(\S+) score=(\d+) nonce=(\d+) outcome=(\d+)$/;

export function parseReputationLog(
  logLine: string,
): ParsedReputationEvent | null {
  const m = LOG_RE.exec(logLine.trim());
  if (m === null) return null;

  const outcomeNum = parseInt(m[4]!, 10);
  if (outcomeNum < 0 || outcomeNum > 2) return null;

  return {
    agent: m[1]!,
    score: parseInt(m[2]!, 10),
    nonce: parseInt(m[3]!, 10),
    outcome: outcomeNum as PactOutcome,
  };
}
