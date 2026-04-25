import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, type Transaction } from "@solana/web3.js";
import { AtomEngineSubmitter, type TrustSignalTarget } from "./atom-engine-submitter.js";

const ORACLE_KEYPAIR    = Keypair.generate();
const BRIDGE_PROGRAM_ID = new PublicKey("11111111111111111111111111111112");
const ATOM_ENGINE_ID    = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const BRIDGE_CONFIG     = Keypair.generate().publicKey;

const TARGET: TrustSignalTarget = {
  atomLegitSnapshotPubkey: Keypair.generate().publicKey,
  atomStatsPubkey:         Keypair.generate().publicKey,
};

// Hardcoded discriminator confirmed against devnet (CAS-60).
const PUBLISH_INTO_ATOM_DISCRIMINATOR = Buffer.from("6b4e9567c6aec0c9", "hex");

function makeSubmitter(conn: any = null): AtomEngineSubmitter {
  return new AtomEngineSubmitter(conn, BRIDGE_PROGRAM_ID, ATOM_ENGINE_ID, BRIDGE_CONFIG, ORACLE_KEYPAIR);
}

// Minimal mock connection for submitTrustSignal tests.
// Uses arrays to capture call data so TypeScript doesn't narrow let-vars to never.
type KeyMeta = { pubkey: PublicKey; isSigner: boolean; isWritable: boolean };

function makeSendConn(opts: { slot?: number; sendSig?: string } = {}): {
  conn: any;
  ixDatas: Buffer[];
  ixKeysList: KeyMeta[][];
} {
  const ixDatas: Buffer[]     = [];
  const ixKeysList: KeyMeta[][] = [];
  const conn = {
    getSlot:            async () => opts.slot ?? 1,
    sendTransaction:    async (tx: Transaction) => {
      ixDatas.push(Buffer.from(tx.instructions[0].data));
      ixKeysList.push(tx.instructions[0].keys as KeyMeta[]);
      return opts.sendSig ?? "sig";
    },
    confirmTransaction: async () => ({ value: { err: null } }),
  };
  return { conn, ixDatas, ixKeysList };
}

// ── buildStubSignal ───────────────────────────────────────────────────────────

test("buildStubSignal first call produces sequence=256 (internal counter starts at 255)", () => {
  assert.equal(makeSubmitter().buildStubSignal().sequence, 256n);
});

test("buildStubSignal increments sequence monotonically across consecutive calls", () => {
  const submitter = makeSubmitter();
  const s1 = submitter.buildStubSignal();
  const s2 = submitter.buildStubSignal();
  const s3 = submitter.buildStubSignal();
  assert.equal(s2.sequence, s1.sequence + 1n);
  assert.equal(s3.sequence, s2.sequence + 1n);
});

test("buildStubSignal sourceSequence always equals sequence", () => {
  const submitter = makeSubmitter();
  for (let i = 0; i < 3; i++) {
    const s = submitter.buildStubSignal();
    assert.equal(s.sourceSequence, s.sequence, `call ${i + 1}: sourceSequence should match sequence`);
  }
});

test("buildStubSignal returns correct fixed fields matching devnet creator_policy config (CAS-60)", () => {
  const s = makeSubmitter().buildStubSignal();
  assert.equal(s.scoreBps,          7900);
  assert.equal(s.confidenceBps,     8400);
  assert.equal(s.metricCount,       2);
  assert.equal(s.statusCode,        0);
  assert.equal(s.sequenceDomain,    3);
  assert.equal(s.validSlotDuration, 100n);
});

test("buildStubSignal currentSlot is 0 (filled in by submitTrustSignal, not here)", () => {
  assert.equal(makeSubmitter().buildStubSignal().currentSlot, 0n);
});

test("buildStubSignal feedbackData is exactly 48 bytes of zeros", () => {
  const { feedbackData } = makeSubmitter().buildStubSignal();
  assert.equal(feedbackData.length, 48);
  assert.ok(feedbackData.every(b => b === 0), "feedbackData should be all zero bytes");
});

// ── submitTrustSignal ─────────────────────────────────────────────────────────

test("submitTrustSignal replaces currentSlot with live slot from getSlot()", async () => {
  const FAKE_SLOT = 99999;
  const { conn, ixDatas } = makeSendConn({ slot: FAKE_SLOT });
  const submitter = makeSubmitter(conn);

  const signal = submitter.buildStubSignal();
  assert.equal(signal.currentSlot, 0n, "precondition: buildStubSignal leaves currentSlot=0");
  await submitter.submitTrustSignal(TARGET, signal);

  assert.equal(ixDatas.length, 1);
  // Layout offset: disc(8) + score_bps(2) + confidence_bps(2) + metric_count(1) + status_code(1)
  //              + sequence_domain(1) + _pad(1) + sequence(8) + source_sequence(8) = 32 → current_slot(8)
  const encodedSlot = ixDatas[0].readBigUInt64LE(32);
  assert.equal(encodedSlot, BigInt(FAKE_SLOT));
});

test("submitTrustSignal encodes exactly 96 bytes matching publish_into_atom layout", async () => {
  const { conn, ixDatas } = makeSendConn();
  const submitter = makeSubmitter(conn);
  await submitter.submitTrustSignal(TARGET, submitter.buildStubSignal());

  assert.equal(ixDatas.length, 1);
  assert.equal(ixDatas[0].length, 96);
});

test("submitTrustSignal instruction data starts with publish_into_atom discriminator", async () => {
  const { conn, ixDatas } = makeSendConn();
  const submitter = makeSubmitter(conn);
  await submitter.submitTrustSignal(TARGET, submitter.buildStubSignal());

  assert.equal(ixDatas.length, 1);
  assert.deepEqual(ixDatas[0].subarray(0, 8), PUBLISH_INTO_ATOM_DISCRIMINATOR);
});

test("submitTrustSignal returns the transaction signature from sendTransaction", async () => {
  const { conn } = makeSendConn({ sendSig: "atomSig123" });
  const submitter = makeSubmitter(conn);
  const sig = await submitter.submitTrustSignal(TARGET, submitter.buildStubSignal());
  assert.equal(sig, "atomSig123");
});

test("submitTrustSignal passes 4 account keys in the correct order with correct mutability", async () => {
  const { conn, ixKeysList } = makeSendConn();
  const submitter = makeSubmitter(conn);
  await submitter.submitTrustSignal(TARGET, submitter.buildStubSignal());

  assert.equal(ixKeysList.length, 1);
  const keys = ixKeysList[0];
  assert.equal(keys.length, 4);
  // [bridgeConfig(ro), atomLegitSnapshot(rw), atomStats(rw), atomEngine(ro)]
  assert.equal(keys[0].pubkey.toBase58(), BRIDGE_CONFIG.toBase58());
  assert.equal(keys[1].pubkey.toBase58(), TARGET.atomLegitSnapshotPubkey.toBase58());
  assert.equal(keys[2].pubkey.toBase58(), TARGET.atomStatsPubkey.toBase58());
  assert.equal(keys[3].pubkey.toBase58(), ATOM_ENGINE_ID.toBase58());
  assert.equal(keys[0].isWritable, false);
  assert.equal(keys[1].isWritable, true);
  assert.equal(keys[2].isWritable, true);
  assert.equal(keys[3].isWritable, false);
});
