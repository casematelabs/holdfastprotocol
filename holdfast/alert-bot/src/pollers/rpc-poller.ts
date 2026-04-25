import { Connection } from "@solana/web3.js";
import type { AlertBotConfig } from "../config.js";
import type { CheckResult } from "../types.js";

export class RpcPoller {
  private readonly connection: Connection;
  private lastConfirmedSlot: number | undefined;
  private lastPollTime: number | undefined;

  constructor(private readonly config: AlertBotConfig) {
    this.connection = new Connection(config.rpcUrl, "confirmed");
  }

  async check(): Promise<CheckResult[]> {
    const now = Date.now();
    let confirmedSlot: number;
    let processedSlot: number;

    try {
      [confirmedSlot, processedSlot] = await Promise.all([
        this.connection.getSlot("confirmed"),
        this.connection.getSlot("processed"),
      ]);
    } catch (err) {
      return [
        {
          healthy: false,
          category: "rpc",
          summary: "Devnet RPC unreachable",
          detail: `${(err as Error).message} (${this.config.rpcUrl})`,
          severity: "critical",
        },
      ];
    }

    const results: CheckResult[] = [];

    // Slot lag: how far processed is ahead of confirmed
    const slotLag = processedSlot - confirmedSlot;
    if (slotLag > this.config.rpcSlotLagThreshold) {
      results.push({
        healthy: false,
        category: "rpc:slot-lag",
        summary: `Devnet RPC slot lag is high (${slotLag} slots)`,
        detail: `Confirmed: ${confirmedSlot}, Processed: ${processedSlot}, Threshold: ${this.config.rpcSlotLagThreshold}`,
        severity: "warning",
      });
    } else {
      results.push({
        healthy: true,
        category: "rpc:slot-lag",
        summary: `Devnet RPC slot lag normal (${slotLag} slots)`,
        severity: "info",
      });
    }

    // Slot advancement: detect if the chain has stalled between polls
    if (
      this.lastConfirmedSlot !== undefined &&
      this.lastPollTime !== undefined
    ) {
      const elapsedMs = now - this.lastPollTime;
      // Devnet target: ~400ms per slot (2.5 slots/s)
      const expectedMinSlots = Math.floor(elapsedMs / 400) * 0.25; // warn if < 25% of expected
      const actualSlots = confirmedSlot - this.lastConfirmedSlot;
      if (actualSlots < expectedMinSlots) {
        results.push({
          healthy: false,
          category: "rpc:stalled",
          summary: "Devnet chain may be stalled",
          detail: `Only ${actualSlots} new slots in ${Math.round(elapsedMs / 1000)}s (expected ≥ ${Math.round(expectedMinSlots)})`,
          severity: "warning",
        });
      } else {
        results.push({
          healthy: true,
          category: "rpc:stalled",
          summary: "Devnet chain advancing normally",
          severity: "info",
        });
      }
    }

    this.lastConfirmedSlot = confirmedSlot;
    this.lastPollTime = now;

    return results;
  }
}
