export type EscrowEventKind =
  | "initialized"
  | "funded"
  | "beneficiary_staked"
  | "locked"
  | "released"
  | "auto_released"
  | "claimed"
  | "dispute_raised"
  | "dispute_escalated"
  | "dispute_resolved"
  | "refunded"
  | "auto_refunded"
  | "protocol_frozen"
  | "mutually_cancelled"
  | "closed";

export interface ParsedEscrowLog {
  kind: EscrowEventKind;
  /** Zero-based index in the instruction's accounts array where the escrow account lives. */
  escrowAccountIndex: number;
  claimAmounts?: {
    grossAmount: bigint;
    protocolFeeAmount: bigint;
    beneficiaryNetAmount: bigint;
  };
}

// Each pattern maps a program log line to an event kind and the index of the
// escrow_account in the Anchor instruction's accounts array (from the IDL).
// lock_escrow and mutual_cancel_escrow have [initiator, beneficiary, escrow_account, ...]
// so their index is 2; all others are 1.
const LOG_PATTERNS: Array<{ re: RegExp; kind: EscrowEventKind; idx: number }> = [
  { re: /^Escrow initialized:/,    kind: "initialized",       idx: 1 },
  { re: /^Funds deposited:/,        kind: "funded",            idx: 1 },
  { re: /^Beneficiary staked:/,     kind: "beneficiary_staked",idx: 1 },
  { re: /^Escrow locked$/,          kind: "locked",            idx: 2 },
  { re: /^Escrow released,/,        kind: "released",          idx: 1 },
  { re: /^Auto-released,/,          kind: "auto_released",     idx: 1 },
  { re: /^Escrow claimed:/,         kind: "claimed",           idx: 1 },
  { re: /^Dispute raised by/,       kind: "dispute_raised",    idx: 1 },
  { re: /^Dispute escalated by/,    kind: "dispute_escalated", idx: 1 },
  { re: /^Dispute resolved:/,       kind: "dispute_resolved",  idx: 1 },
  { re: /^Refunded:/,               kind: "refunded",          idx: 1 },
  { re: /^Auto-refunded:/,          kind: "auto_refunded",     idx: 1 },
  { re: /^Protocol freeze:/,        kind: "protocol_frozen",   idx: 1 },
  { re: /^MutuallyCancelled:/,      kind: "mutually_cancelled",idx: 2 },
  { re: /^Escrow closed$/,          kind: "closed",            idx: 1 },
];

const CLAIM_AMOUNTS_RE =
  /^Escrow claimed: beneficiary=(\d+), initiator_stake_returned=(\d+), protocol_fee=(\d+)$/;

export function parseEscrowLog(line: string): ParsedEscrowLog | null {
  const claimMatch = CLAIM_AMOUNTS_RE.exec(line);
  if (claimMatch !== null) {
    const beneficiaryNetAmount = BigInt(claimMatch[1]!);
    const protocolFeeAmount = BigInt(claimMatch[3]!);
    return {
      kind: "claimed",
      escrowAccountIndex: 1,
      claimAmounts: {
        grossAmount: beneficiaryNetAmount + protocolFeeAmount,
        protocolFeeAmount,
        beneficiaryNetAmount,
      },
    };
  }

  for (const { re, kind, idx } of LOG_PATTERNS) {
    if (re.test(line)) return { kind, escrowAccountIndex: idx };
  }
  return null;
}
