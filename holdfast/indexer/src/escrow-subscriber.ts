import {
  Connection,
  PublicKey,
  type Context,
  type Logs,
  type PartiallyDecodedInstruction,
} from "@solana/web3.js";
import { parseEscrowLog } from "./escrow-parser.js";
import type { EventStore } from "./store.js";
import type { EscrowEvent } from "./types.js";

export class EscrowSubscriber {
  private subscriptionId: number | null = null;

  constructor(
    private readonly connection: Connection,
    private readonly programId: PublicKey,
    private readonly store: EventStore,
  ) {}

  start(): void {
    this.subscribe();
    const lastSig = this.store.getLastIndexedEscrowSignature();
    void this.pollBackfill(lastSig !== null ? 1000 : 50, lastSig ?? undefined);
    setInterval(() => void this.pollBackfill(20), 30_000);
  }

  private subscribe(): void {
    this.subscriptionId = this.connection.onLogs(
      this.programId,
      (logs: Logs, ctx: Context) => void this.handleLogs(logs, ctx),
      "confirmed",
    );
    console.log(
      `[escrow-subscriber] Subscribed to program logs (program=${this.programId.toBase58()})`,
    );
  }

  async pollBackfill(limit: number, until?: string): Promise<void> {
    try {
      const sigs = await this.connection.getSignaturesForAddress(
        this.programId,
        { limit, ...(until !== undefined ? { until } : {}) },
        "confirmed",
      );

      for (const sigInfo of sigs) {
        if (sigInfo.err !== null) continue;
        await this.processTx(
          sigInfo.signature,
          sigInfo.slot,
          sigInfo.blockTime ?? Math.floor(Date.now() / 1000),
        );
      }

      console.log(
        `[escrow-subscriber] Backfill complete (checked ${sigs.length} sigs)`,
      );
    } catch (err) {
      console.warn("[escrow-subscriber] Backfill error:", err);
    }
  }

  private async handleLogs(logs: Logs, ctx: Context): Promise<void> {
    if (logs.err !== null) return;

    // Quick pre-check to avoid fetching the full tx when irrelevant.
    const hasEscrowLog = logs.logs.some((raw) => {
      const line = raw.startsWith("Program log: ") ? raw.slice(13) : raw;
      return parseEscrowLog(line) !== null;
    });
    if (!hasEscrowLog) return;

    await this.processTx(logs.signature, ctx.slot, Math.floor(Date.now() / 1000));
  }

  private async processTx(signature: string, slot: number, fallbackTs: number): Promise<void> {
    try {
      const tx = await this.connection.getParsedTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      if (tx === null) return;

      const logMessages = tx.meta?.logMessages ?? [];
      const blockTs = tx.blockTime ?? fallbackTs;

      // Find the outer instruction that belongs to the escrow program.
      const escrowIx = tx.transaction.message.instructions.find(
        (ix): ix is PartiallyDecodedInstruction =>
          "accounts" in ix && ix.programId.equals(this.programId),
      );
      if (escrowIx === undefined) return;

      for (const raw of logMessages) {
        // getParsedTransaction wraps msg!() output in "Program log: "; strip it.
        const line = raw.startsWith("Program log: ") ? raw.slice(13) : raw;
        const parsed = parseEscrowLog(line);
        if (parsed === null) continue;

        const escrowPubkey = escrowIx.accounts[parsed.escrowAccountIndex];
        if (escrowPubkey === undefined) {
          console.warn(
            `[escrow-subscriber] Missing account at index ${parsed.escrowAccountIndex} for ${parsed.kind} in tx ${signature}`,
          );
          continue;
        }

        const event: EscrowEvent = {
          escrow: escrowPubkey.toBase58(),
          kind: parsed.kind,
          slot,
          signature,
          ts: blockTs,
          indexedAt: Math.floor(Date.now() / 1000),
        };

        this.store.upsertEscrowEvent(event);
        console.log(
          `[escrow-subscriber] Indexed: escrow=${event.escrow.slice(0, 8)}... kind=${event.kind}`,
        );
      }
    } catch (err) {
      console.warn(
        `[escrow-subscriber] Failed to process tx ${signature}:`,
        err,
      );
    }
  }

  async stop(): Promise<void> {
    if (this.subscriptionId !== null) {
      await this.connection.removeOnLogsListener(this.subscriptionId);
      this.subscriptionId = null;
    }
  }
}
