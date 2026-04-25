import { Connection, PublicKey } from "@solana/web3.js";
import type { SignaturesForAddressOptions } from "@solana/web3.js";
import type { AlertBotConfig } from "../config.js";
import type { CheckResult } from "../types.js";

// Only the three event kinds that warrant immediate operator attention
const ALERT_LOG_PATTERNS: Array<{
  re: RegExp;
  kind: string;
  severity: "critical" | "warning";
}> = [
  { re: /^Protocol freeze:/, kind: "protocol_frozen", severity: "critical" },
  { re: /^Dispute raised by/, kind: "dispute_raised", severity: "warning" },
  { re: /^Dispute escalated by/, kind: "dispute_escalated", severity: "warning" },
];

export class EscrowPoller {
  private readonly connection: Connection;
  private readonly escrowProgramId: PublicKey;
  // Tracks newest signature seen; used as `until` on subsequent polls
  private lastSignature: string | undefined;

  constructor(config: AlertBotConfig) {
    this.connection = new Connection(config.rpcUrl, "confirmed");
    this.escrowProgramId = new PublicKey(config.escrowProgramId);
  }

  async check(): Promise<CheckResult[]> {
    const options: SignaturesForAddressOptions = { limit: 20 };
    if (this.lastSignature !== undefined) {
      options.until = this.lastSignature;
    }

    let signatures: Awaited<ReturnType<Connection["getSignaturesForAddress"]>>;
    try {
      signatures = await this.connection.getSignaturesForAddress(
        this.escrowProgramId,
        options,
        "confirmed",
      );
    } catch (err) {
      return [
        {
          healthy: false,
          category: "escrow-rpc",
          summary: "Failed to fetch escrow program signatures",
          detail: (err as Error).message,
          severity: "warning",
        },
      ];
    }

    if (signatures.length === 0) return [];

    // Signatures are newest-first; pin the cursor to avoid re-processing on next poll
    const newest = signatures[0];
    if (newest !== undefined) {
      this.lastSignature = newest.signature;
    }

    const results: CheckResult[] = [];

    for (const { signature } of signatures) {
      let tx: Awaited<ReturnType<Connection["getTransaction"]>>;
      try {
        tx = await this.connection.getTransaction(signature, {
          maxSupportedTransactionVersion: 0,
        });
      } catch {
        continue;
      }
      if (tx === null) continue;

      const logs = tx.meta?.logMessages ?? [];
      for (const log of logs) {
        for (const pattern of ALERT_LOG_PATTERNS) {
          if (pattern.re.test(log)) {
            results.push({
              healthy: false,
              category: `escrow:${pattern.kind}`,
              summary: `Escrow event: ${pattern.kind.replace(/_/g, " ")}`,
              detail: `Signature: ${signature}`,
              severity: pattern.severity,
            });
            break; // one match per log line is enough
          }
        }
      }
    }

    return results;
  }
}
