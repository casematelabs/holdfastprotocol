import { Connection, PublicKey } from "@solana/web3.js";
import { createHash } from "node:crypto";
import type { AlertBotConfig } from "../config.js";
import type { CheckResult } from "../types.js";

export class ProgramPoller {
  private readonly connection: Connection;

  constructor(private readonly config: AlertBotConfig) {
    this.connection = new Connection(config.rpcUrl, "confirmed");
  }

  async check(): Promise<CheckResult[]> {
    const checks: Array<[label: string, programId: string, baseline: string | null]> = [
      ["holdfast", this.config.holdfastProgramId, this.config.programBaselineHashes.holdfast],
      ["escrow", this.config.escrowProgramId, this.config.programBaselineHashes.escrow],
    ];

    const results: CheckResult[] = [];
    for (const [label, programId, baseline] of checks) {
      results.push(await this.checkProgram(label, programId, baseline));
    }
    return results;
  }

  private async checkProgram(
    label: string,
    programIdStr: string,
    baselineHash: string | null,
  ): Promise<CheckResult> {
    const category = `program:${label}`;

    let accountInfo: Awaited<ReturnType<Connection["getAccountInfo"]>>;
    try {
      accountInfo = await this.connection.getAccountInfo(
        new PublicKey(programIdStr),
      );
    } catch (err) {
      return {
        healthy: false,
        category,
        summary: `${label} program account fetch failed`,
        detail: (err as Error).message,
        severity: "warning",
      };
    }

    if (accountInfo === null) {
      return {
        healthy: false,
        category,
        summary: `${label} program account not found on devnet`,
        detail: `Program ID: ${programIdStr}`,
        severity: "critical",
      };
    }

    if (!accountInfo.executable) {
      return {
        healthy: false,
        category,
        summary: `${label} program account is not executable`,
        detail: `Program ID: ${programIdStr}`,
        severity: "critical",
      };
    }

    const hash = createHash("sha256").update(accountInfo.data).digest("hex");

    if (baselineHash !== null && hash !== baselineHash) {
      return {
        healthy: false,
        category,
        summary: `${label} program binary hash mismatch`,
        detail: `Expected: ${baselineHash}\nActual:   ${hash}`,
        severity: "critical",
      };
    }

    return {
      healthy: true,
      category,
      summary: `${label} program healthy (sha256: ${hash.slice(0, 16)}…)`,
      severity: "info",
    };
  }
}
