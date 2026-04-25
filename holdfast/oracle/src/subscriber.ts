import { Connection, PublicKey, type Logs } from "@solana/web3.js";
import type { DisputeEvent } from "./types.js";
import { VoteOutcome } from "./types.js";

// Expected log prefix emitted by the Holdfast escrow program on dispute settlement.
// Format: VaultPactDisputeSettled pact=<14hex> agent=<base58> counterparty=<base58> verdict=<VoteOutcome>
// The escrow program must emit this exact prefix — do not change without updating the escrow contract.
const LOG_PREFIX = "Program log: VaultPactDisputeSettled ";

export type DisputeHandler = (event: DisputeEvent) => Promise<void>;

export class DisputeSubscriber {
  private subscriptionId: number | null = null;

  constructor(
    private readonly connection: Connection,
    private readonly escrowProgramId: PublicKey,
    private readonly onDispute: DisputeHandler,
  ) {}

  start(): void {
    this.subscriptionId = this.connection.onLogs(
      this.escrowProgramId,
      (logs: Logs) => void this.handleLogs(logs),
      "confirmed",
    );
    console.log(`[subscriber] Watching escrow logs (program=${this.escrowProgramId.toBase58()})`);
  }

  async stop(): Promise<void> {
    if (this.subscriptionId !== null) {
      await this.connection.removeOnLogsListener(this.subscriptionId);
      this.subscriptionId = null;
    }
  }

  private async handleLogs(logs: Logs): Promise<void> {
    if (logs.err !== null) return;

    for (const line of logs.logs) {
      const event = parseDisputeLog(line, logs.signature);
      if (event === null) continue;
      try {
        await this.onDispute(event);
      } catch (err) {
        console.error(`[subscriber] onDispute handler failed for sig=${logs.signature}:`, err);
      }
    }
  }
}

// Exported for unit testing.
export function parseDisputeLog(line: string, signature: string): DisputeEvent | null {
  if (!line.startsWith(LOG_PREFIX)) return null;

  const body = line.slice(LOG_PREFIX.length);
  const fields = parseFields(body);

  const pactHex = fields["pact"];
  const agent = fields["agent"];
  const counterparty = fields["counterparty"];
  const verdictStr = fields["verdict"];

  if (!pactHex || !agent || !counterparty || !verdictStr) {
    console.warn(`[subscriber] Malformed dispute log: "${line}"`);
    return null;
  }

  if (pactHex.length !== 14) {
    console.warn(`[subscriber] pact field must be 14 hex chars (7 bytes), got ${pactHex.length}`);
    return null;
  }

  if (!/^[0-9a-f]{14}$/i.test(pactHex)) {
    console.warn(`[subscriber] pact field contains non-hex chars: "${pactHex}"`);
    return null;
  }

  const pactId = Buffer.from(pactHex, "hex");

  const outcome = parseVoteOutcome(verdictStr);
  if (outcome === null) {
    console.warn(`[subscriber] Unknown verdict "${verdictStr}" in log: "${line}"`);
    return null;
  }

  return { signature, pactId, agentPubkey: agent, counterpartyPubkey: counterparty, outcome, detectedAt: Math.floor(Date.now() / 1000) };
}

function parseVoteOutcome(s: string): VoteOutcome | null {
  switch (s) {
    case "AgentFaulted":        return VoteOutcome.AgentFaulted;
    case "CounterpartyFaulted": return VoteOutcome.CounterpartyFaulted;
    case "Mutual":              return VoteOutcome.Mutual;
    default:                    return null;
  }
}

// Parse a space-separated key=value string. Values may not contain spaces.
function parseFields(body: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const token of body.split(" ")) {
    const eq = token.indexOf("=");
    if (eq === -1) continue;
    result[token.slice(0, eq)] = token.slice(eq + 1);
  }
  return result;
}
