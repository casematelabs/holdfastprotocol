import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { createHash } from "node:crypto";
import type { ValidationRequestedEvent, ValidationResponse } from "./types.js";

// Anchor instruction discriminator: sha256("global:respond_to_validation")[0..8]
// Confirmed by CAS-50.
const RESPOND_TO_VALIDATION_DISCRIMINATOR: Buffer = ((): Buffer => {
  return createHash("sha256")
    .update("global:respond_to_validation")
    .digest()
    .subarray(0, 8);
})();

// Stub trust score returned for all validation requests (1–100).
// Real implementation would derive this from on-chain reputation data.
const STUB_SCORE = 75;

export class AgentRegistryResponder {
  constructor(
    private readonly connection: Connection,
    private readonly agentRegistryProgramId: PublicKey,
    private readonly oracleKeypair: Keypair,
  ) {}

  // Produce a stub ValidationResponse for any incoming ValidationRequested event.
  buildStubResult(event: ValidationRequestedEvent): ValidationResponse {
    return {
      asset:            event.asset,
      validatorAddress: event.validatorAddress,
      nonce:            event.nonce,
      score:            STUB_SCORE,
    };
  }

  // Submit respond_to_validation to the Agent Registry program.
  async submitResponse(resp: ValidationResponse): Promise<string> {
    const assetPubkey     = new PublicKey(resp.asset);
    const validatorPubkey = new PublicKey(resp.validatorAddress);
    const requestPda      = deriveRequestPda(assetPubkey, validatorPubkey, resp.nonce, this.agentRegistryProgramId);

    const data = encodeRespondToValidationArgs(resp.score);

    // Account order: request PDA (writable), oracle signer.
    // Confirmed CAS-50.
    const ix = new TransactionInstruction({
      programId: this.agentRegistryProgramId,
      keys: [
        { pubkey: requestPda,                   isSigner: false, isWritable: true  },
        { pubkey: this.oracleKeypair.publicKey, isSigner: true,  isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    const sig = await this.connection.sendTransaction(tx, [this.oracleKeypair], {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
    await this.connection.confirmTransaction(sig, "confirmed");

    console.log(
      `[ar-responder] respond_to_validation submitted: ` +
      `asset=${resp.asset.slice(0, 8)}... ` +
      `nonce=${resp.nonce} score=${resp.score} sig=${sig}`,
    );
    return sig;
  }
}

// PDA seeds: ["validation_request", asset (32b), validator_address (32b), nonce LE (4b)]
// Confirmed by CAS-50.
function deriveRequestPda(
  asset: PublicKey,
  validatorAddress: PublicKey,
  nonce: number,
  programId: PublicKey,
): PublicKey {
  const nonceBuf = Buffer.alloc(4);
  nonceBuf.writeUInt32LE(nonce, 0);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("validation_request"), asset.toBytes(), validatorAddress.toBytes(), nonceBuf],
    programId,
  );
  return pda;
}

// Borsh encoding for respond_to_validation args (confirmed CAS-50):
//   discriminator: [u8; 8]
//   score:         u8  (1–100)
function encodeRespondToValidationArgs(score: number): Buffer {
  const buf = Buffer.alloc(8 + 1);
  RESPOND_TO_VALIDATION_DISCRIMINATOR.copy(buf, 0);
  buf.writeUInt8(score, 8);
  return buf;
}
