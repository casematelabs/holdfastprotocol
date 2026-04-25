import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { createHash } from "node:crypto";
import type { ReputationUpdate } from "./types.js";
import { computeNonceOffset, type Idl } from "./idl-offset.js";

const RETRY_DELAYS_MS = [500, 1000, 2000];

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === RETRY_DELAYS_MS.length) throw err;
      const delay = RETRY_DELAYS_MS[attempt];
      console.warn(`[voter] ${label} failed (attempt ${attempt + 1}), retrying in ${delay}ms:`, err);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}

// Anchor instruction discriminator: sha256("global:update_reputation")[0..8]
const UPDATE_REPUTATION_DISCRIMINATOR: Buffer = ((): Buffer => {
  return createHash("sha256")
    .update("global:update_reputation")
    .digest()
    .subarray(0, 8);
})();

export class Voter {
  private readonly nonceOffset: number;

  constructor(
    private readonly connection: Connection,
    private readonly programId: PublicKey,
    private readonly oracleKeypair: Keypair,
    idl: Idl,
  ) {
    this.nonceOffset = computeNonceOffset(idl);
    console.log(`[voter] ReputationAccount nonce offset (from IDL): ${this.nonceOffset}`);
  }

  // Submit update_reputation for a single agent.
  // Fetches the current on-chain nonce first to avoid replay.
  async submitUpdate(update: ReputationUpdate): Promise<string> {
    const agentPubkey = new PublicKey(update.agentPubkey);
    const repPda = deriveReputationPda(agentPubkey, this.programId);

    const nonce = await this.fetchNonce(repPda);
    const incomingNonce = nonce + BigInt(1);

    const data = encodeUpdateReputationArgs(incomingNonce, update.onChainOutcome, update.scoreDelta, update.pactId);

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: repPda,                    isSigner: false, isWritable: true  },
        { pubkey: this.oracleKeypair.publicKey, isSigner: true, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    const sig = await withRetry(
      `sendTransaction agent=${update.agentPubkey.slice(0, 8)}`,
      () => this.connection.sendTransaction(tx, [this.oracleKeypair], {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      }),
    );
    await withRetry(
      `confirmTransaction sig=${sig.slice(0, 8)}`,
      () => this.connection.confirmTransaction(sig, "confirmed"),
    );

    console.log(
      `[voter] update_reputation submitted: agent=${update.agentPubkey.slice(0, 8)}... ` +
      `nonce=${incomingNonce} delta=${update.scoreDelta} outcome=${update.onChainOutcome} sig=${sig}`,
    );
    return sig;
  }

  private async fetchNonce(repPda: PublicKey): Promise<bigint> {
    const info = await this.connection.getAccountInfo(repPda, "confirmed");
    if (info === null) {
      throw new Error(`ReputationAccount not found at ${repPda.toBase58()} — agent must call init_reputation first`);
    }
    if (info.data.length < this.nonceOffset + 8) {
      throw new Error(`ReputationAccount data too short: ${info.data.length} bytes`);
    }
    return Buffer.from(info.data).readBigUInt64LE(this.nonceOffset);
  }
}

function deriveReputationPda(agentPubkey: PublicKey, programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("reputation"), agentPubkey.toBuffer()],
    programId,
  );
  return pda;
}

// Borsh encoding for update_reputation args:
//   discriminator: [u8; 8]
//   incoming_nonce: u64 LE
//   outcome: u8  (PactOutcome C-style enum)
//   score_delta: i16 LE
//   pact_id: [u8; 7]
function encodeUpdateReputationArgs(
  incomingNonce: bigint,
  outcome: number,
  scoreDelta: number,
  pactId: Buffer,
): Buffer {
  const buf = Buffer.alloc(8 + 8 + 1 + 2 + 7);
  let offset = 0;

  UPDATE_REPUTATION_DISCRIMINATOR.copy(buf, offset);
  offset += 8;

  buf.writeBigUInt64LE(incomingNonce, offset);
  offset += 8;

  buf.writeUInt8(outcome, offset);
  offset += 1;

  buf.writeInt16LE(scoreDelta, offset);
  offset += 2;

  pactId.copy(buf, offset, 0, 7);

  return buf;
}
