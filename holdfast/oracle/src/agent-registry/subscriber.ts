import { Connection, PublicKey, type Logs } from "@solana/web3.js";
import { createHash } from "node:crypto";
import type { ValidationRequestedEvent } from "./types.js";

// Anchor event discriminator: sha256("event:ValidationRequested")[0..8]
// Confirmed by CAS-50.
const VALIDATION_REQUESTED_DISCRIMINATOR: Buffer = createHash("sha256")
  .update("event:ValidationRequested")
  .digest()
  .subarray(0, 8);

// Event payload size after the 8-byte discriminator (confirmed CAS-50):
//   asset              [u8; 32]
//   validator_address  [u8; 32]
//   nonce              u32 LE (4 bytes)
//   request_hash       [u8; 32]
const EVENT_PAYLOAD_BYTES = 32 + 32 + 4 + 32; // 100

export type ValidationRequestHandler = (req: ValidationRequestedEvent) => Promise<void>;

export class AgentRegistrySubscriber {
  private subscriptionId: number | null = null;

  constructor(
    private readonly connection: Connection,
    private readonly agentRegistryProgramId: PublicKey,
    private readonly onRequest: ValidationRequestHandler,
  ) {}

  start(): void {
    this.subscriptionId = this.connection.onLogs(
      this.agentRegistryProgramId,
      (logs: Logs) => void this.handleLogs(logs),
      "confirmed",
    );
    console.log(`[ar-subscriber] Watching Agent Registry logs (program=${this.agentRegistryProgramId.toBase58()})`);
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
      const event = parseValidationRequestedEvent(line, logs.signature);
      if (event === null) continue;
      try {
        await this.onRequest(event);
      } catch (err) {
        console.error(`[ar-subscriber] onRequest handler failed for sig=${logs.signature}:`, err);
      }
    }
  }
}

// Exported for unit testing.
// Anchor emits events as "Program data: <base64>" log lines.
export function parseValidationRequestedEvent(line: string, signature: string): ValidationRequestedEvent | null {
  const DATA_PREFIX = "Program data: ";
  if (!line.startsWith(DATA_PREFIX)) return null;

  let raw: Buffer;
  try {
    raw = Buffer.from(line.slice(DATA_PREFIX.length), "base64");
  } catch {
    return null;
  }

  if (raw.length < 8 + EVENT_PAYLOAD_BYTES) return null;
  if (!raw.subarray(0, 8).equals(VALIDATION_REQUESTED_DISCRIMINATOR)) return null;

  let offset = 8;
  const asset            = new PublicKey(raw.subarray(offset, offset + 32)).toBase58(); offset += 32;
  const validatorAddress = new PublicKey(raw.subarray(offset, offset + 32)).toBase58(); offset += 32;
  const nonce            = raw.readUInt32LE(offset);                                     offset += 4;
  const requestHash      = Buffer.from(raw.subarray(offset, offset + 32));

  return {
    signature,
    asset,
    validatorAddress,
    nonce,
    requestHash,
    detectedAt: Math.floor(Date.now() / 1000),
  };
}
