import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

// Derived from: sha256("global:publish_into_atom")[0..8]
// Confirmed against devnet transactions (see CAS-60 analysis).
const PUBLISH_INTO_ATOM_DISCRIMINATOR = Buffer.from("6b4e9567c6aec0c9", "hex");

// ATOM Engine trust signal structure.
export interface TrustSignal {
  scoreBps: number;           // 0–10000  (trust score in basis points, e.g. 7900 = 79%)
  confidenceBps: number;      // 0–10000  (confidence in basis points, e.g. 8400 = 84%)
  metricCount: number;        // number of hardware/attestation metrics backing this score
  statusCode: number;         // 0 = valid; non-zero values are program-defined error codes
  sequenceDomain: number;     // domain partition for the sequence counter (oracle-assigned)
  sequence: bigint;           // monotonically increasing per oracle keypair + domain
  sourceSequence: bigint;     // sequence as assigned by the originating attestation source
  currentSlot: bigint;        // Solana slot at submission time
  validSlotDuration: bigint;  // number of slots this signal should be considered live
  feedbackData: Buffer;       // 48-byte opaque payload (zeroed for stub submissions)
}

// Accounts needed to call publish_into_atom on the bridge program.
export interface TrustSignalTarget {
  // atom_legit_snapshot PDA for this agent (owned by ATOM Engine).
  atomLegitSnapshotPubkey: PublicKey;
  // atom_stats PDA for this agent (owned by ATOM Engine).
  atomStatsPubkey: PublicKey;
}

export class AtomEngineSubmitter {
  // Start at 255 so the first buildStubSignal() call produces sequence=256,
  // monotonically past the last observed devnet value of 0xff in the snapshot (CAS-60).
  private sequence = 255n;

  constructor(
    private readonly connection: Connection,
    // Bridge program that wraps ATOM Engine's publish_legit_score via CPI.
    // Devnet: 5dDk9suKgyS9QqbgRf3Fet6v3sa37VsACsVaJFBgZg92
    private readonly bridgeProgramId: PublicKey,
    // ATOM Engine program ID.
    // Devnet: AToMufS4QD6hEXvcvBDg9m1AHeCLpmZQsyfYa5h9MwAF
    private readonly atomEngineProgramId: PublicKey,
    // Bridge config PDA owned by bridgeProgramId; serves as the CPI authority
    // that ATOM Engine validates against its registered creator_policy.
    private readonly bridgeConfigPubkey: PublicKey,
    private readonly oracleKeypair: Keypair,
  ) {}

  buildStubSignal(): TrustSignal {
    this.sequence += 1n;
    return {
      scoreBps: 7900,
      confidenceBps: 8400,
      // metric_count=2 matches the creator_policy configuration on devnet (CAS-60).
      metricCount: 2,
      statusCode: 0,
      // sequence_domain=3 matches the active creator_policy domain for this snapshot (CAS-60).
      sequenceDomain: 3,
      sequence: this.sequence,
      sourceSequence: this.sequence,
      currentSlot: 0n,         // filled in at submit time
      validSlotDuration: 100n, // signal valid for ~100 slots (~40s on devnet)
      feedbackData: Buffer.alloc(48, 0),
    };
  }

  async submitTrustSignal(
    target: TrustSignalTarget,
    signal: TrustSignal,
  ): Promise<string> {
    const slot = BigInt(await this.connection.getSlot("confirmed"));
    const liveSignal: TrustSignal = { ...signal, currentSlot: slot };

    const data = encodeTrustSignalArgs(liveSignal);

    // Account order matches the bridge program's publish_into_atom context,
    // verified against devnet CPI traces (CAS-60).
    const ix = new TransactionInstruction({
      programId: this.bridgeProgramId,
      keys: [
        { pubkey: this.bridgeConfigPubkey,              isSigner: false, isWritable: false },
        { pubkey: target.atomLegitSnapshotPubkey,       isSigner: false, isWritable: true  },
        { pubkey: target.atomStatsPubkey,               isSigner: false, isWritable: true  },
        { pubkey: this.atomEngineProgramId,             isSigner: false, isWritable: false },
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
      `[atom-submitter] trust signal submitted: ` +
      `scoreBps=${liveSignal.scoreBps} ` +
      `confidenceBps=${liveSignal.confidenceBps} ` +
      `seq=${liveSignal.sequence} ` +
      `slot=${liveSignal.currentSlot} ` +
      `sig=${sig}`,
    );
    return sig;
  }
}

// Borsh layout for publish_into_atom args (mirrors ATOM Engine's publish_legit_score args):
//   [u8;8]  discriminator
//   u16     score_bps
//   u16     confidence_bps
//   u8      metric_count
//   u8      status_code
//   u8      sequence_domain
//   u8      _pad
//   u64     sequence
//   u64     source_sequence
//   u64     current_slot
//   u64     valid_slot_duration
//   [u8;48] feedback_data
// Total: 8+2+2+1+1+1+1+8+8+8+8+48 = 96 bytes
function encodeTrustSignalArgs(signal: TrustSignal): Buffer {
  const buf = Buffer.alloc(96);
  let off = 0;

  PUBLISH_INTO_ATOM_DISCRIMINATOR.copy(buf, off); off += 8;
  buf.writeUInt16LE(signal.scoreBps, off);        off += 2;
  buf.writeUInt16LE(signal.confidenceBps, off);   off += 2;
  buf.writeUInt8(signal.metricCount, off++);
  buf.writeUInt8(signal.statusCode, off++);
  buf.writeUInt8(signal.sequenceDomain, off++);
  buf.writeUInt8(0, off++); // _pad
  buf.writeBigUInt64LE(signal.sequence, off);        off += 8;
  buf.writeBigUInt64LE(signal.sourceSequence, off);  off += 8;
  buf.writeBigUInt64LE(signal.currentSlot, off);     off += 8;
  buf.writeBigUInt64LE(signal.validSlotDuration, off); off += 8;
  signal.feedbackData.copy(buf, off, 0, 48);

  return buf;
}
