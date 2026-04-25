import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Keypair, PublicKey, type Transaction } from "@solana/web3.js";
import { Voter } from "./voter.js";
import { PactOutcome, type ReputationUpdate } from "./types.js";
import type { Idl } from "./idl-offset.js";

const PROGRAM_ID     = new PublicKey("11111111111111111111111111111112");
const ORACLE_KEYPAIR = Keypair.generate();
const AGENT_PUBKEY   = Keypair.generate().publicKey;
const PACT_ID        = Buffer.from("aabbccdd001122", "hex");

// Recompute discriminator the same way voter.ts does.
const UPDATE_REPUTATION_DISCRIMINATOR = createHash("sha256")
  .update("global:update_reputation")
  .digest()
  .subarray(0, 8);

// Minimal IDL matching the on-chain ReputationAccount layout.
// nonce lives at offset 90: 8(disc)+1+32+8+1+8+8+8+8+8 = 90.
const MOCK_IDL: Idl = {
  types: [
    {
      name: "VerifTier",
      type: {
        kind: "enum",
        variants: [{ name: "Unverified" }, { name: "Attested" }, { name: "Hardline" }],
      },
    },
    {
      name: "ReputationAccount",
      type: {
        kind: "struct",
        fields: [
          { name: "schema_version", type: "u8" },
          { name: "agent",          type: "pubkey" },
          { name: "score",          type: "u64" },
          { name: "tier",           type: { defined: { name: "VerifTier" } } },
          { name: "total_pacts",    type: "u64" },
          { name: "dispute_count",  type: "u64" },
          { name: "created_at",     type: "i64" },
          { name: "last_updated",   type: "i64" },
          { name: "decay_cursor",   type: "i64" },
          { name: "nonce",          type: "u64" },
        ],
      },
    },
  ],
};

// Nonce field lives at byte 90 in the on-chain ReputationAccount
// (matches layout in MOCK_IDL above).
const OFF_NONCE = 90;

function makeAccountData(nonce: bigint, totalSize = 200): Buffer {
  const buf = Buffer.alloc(totalSize, 0);
  buf.writeBigUInt64LE(nonce, OFF_NONCE);
  return buf;
}

interface CapturedSend {
  ixData: Buffer;
  signers: Keypair[];
  ixKeys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[];
}

function makeMockConn(opts: {
  accountData: Buffer | null;
  sendResult?: string;
  sendFailCount?: number;
}): { conn: any; sends: CapturedSend[] } {
  const sends: CapturedSend[] = [];
  let sendCount = 0;
  const conn = {
    getAccountInfo: async (_pda: PublicKey) => {
      if (opts.accountData === null) return null;
      return { data: opts.accountData, lamports: 1_000_000, owner: PROGRAM_ID, executable: false, rentEpoch: 0 };
    },
    sendTransaction: async (tx: Transaction, signers: Keypair[]) => {
      sendCount++;
      const ix = tx.instructions[0];
      sends.push({ ixData: Buffer.from(ix.data), signers, ixKeys: ix.keys as CapturedSend["ixKeys"] });
      if (opts.sendFailCount && sendCount <= opts.sendFailCount) {
        throw new Error("transient send failure");
      }
      return opts.sendResult ?? "fakeSig1234";
    },
    confirmTransaction: async () => ({ value: { err: null } }),
  };
  return { conn, sends };
}

function defaultUpdate(overrides: Partial<ReputationUpdate> = {}): ReputationUpdate {
  return {
    agentPubkey:    AGENT_PUBKEY.toBase58(),
    onChainOutcome: PactOutcome.Fulfilled,
    scoreDelta:     0,
    pactId:         PACT_ID,
    ...overrides,
  };
}

// ── nonce handling ────────────────────────────────────────────────────────────

test("submitUpdate sends incoming_nonce = on-chain nonce + 1", async () => {
  const ON_CHAIN_NONCE = 42n;
  const { conn, sends } = makeMockConn({ accountData: makeAccountData(ON_CHAIN_NONCE) });
  await new Voter(conn, PROGRAM_ID, ORACLE_KEYPAIR, MOCK_IDL).submitUpdate(defaultUpdate());

  assert.equal(sends.length, 1);
  const encodedNonce = sends[0].ixData.readBigUInt64LE(8);
  assert.equal(encodedNonce, ON_CHAIN_NONCE + 1n);
});

test("submitUpdate nonce=0 on chain produces incoming_nonce=1", async () => {
  const { conn, sends } = makeMockConn({ accountData: makeAccountData(0n) });
  await new Voter(conn, PROGRAM_ID, ORACLE_KEYPAIR, MOCK_IDL).submitUpdate(defaultUpdate());
  assert.equal(sends[0].ixData.readBigUInt64LE(8), 1n);
});

// ── instruction data encoding ─────────────────────────────────────────────────

test("submitUpdate instruction data starts with update_reputation discriminator", async () => {
  const { conn, sends } = makeMockConn({ accountData: makeAccountData(0n) });
  await new Voter(conn, PROGRAM_ID, ORACLE_KEYPAIR, MOCK_IDL).submitUpdate(defaultUpdate());
  assert.deepEqual(sends[0].ixData.subarray(0, 8), UPDATE_REPUTATION_DISCRIMINATOR);
});

test("submitUpdate total instruction data is exactly 26 bytes", async () => {
  const { conn, sends } = makeMockConn({ accountData: makeAccountData(0n) });
  await new Voter(conn, PROGRAM_ID, ORACLE_KEYPAIR, MOCK_IDL).submitUpdate(defaultUpdate());
  // disc(8) + nonce(8) + outcome(1) + delta(2) + pactId(7) = 26
  assert.equal(sends[0].ixData.length, 26);
});

test("submitUpdate encodes outcome correctly for all PactOutcome values", async () => {
  const cases: [PactOutcome, number][] = [
    [PactOutcome.Fulfilled, 0],
    [PactOutcome.Disputed,  1],
    [PactOutcome.Cancelled, 2],
  ];
  for (const [outcome, expectedByte] of cases) {
    const { conn, sends } = makeMockConn({ accountData: makeAccountData(0n) });
    await new Voter(conn, PROGRAM_ID, ORACLE_KEYPAIR, MOCK_IDL).submitUpdate(defaultUpdate({ onChainOutcome: outcome }));
    assert.equal(sends[0].ixData.readUInt8(16), expectedByte, `outcome=${outcome}`);
  }
});

test("submitUpdate encodes scoreDelta as i16 LE for boundary and typical values", async () => {
  for (const delta of [0, 20, -400, 32767, -32768]) {
    const { conn, sends } = makeMockConn({ accountData: makeAccountData(0n) });
    await new Voter(conn, PROGRAM_ID, ORACLE_KEYPAIR, MOCK_IDL).submitUpdate(defaultUpdate({ scoreDelta: delta }));
    assert.equal(sends[0].ixData.readInt16LE(17), delta, `scoreDelta=${delta}`);
  }
});

test("submitUpdate encodes pactId as 7 bytes at offset 19", async () => {
  const pactId = Buffer.from("deadbeef123456", "hex");
  const { conn, sends } = makeMockConn({ accountData: makeAccountData(0n) });
  await new Voter(conn, PROGRAM_ID, ORACLE_KEYPAIR, MOCK_IDL).submitUpdate(defaultUpdate({ pactId }));
  assert.deepEqual(sends[0].ixData.subarray(19, 26), pactId);
});

// ── account keys ──────────────────────────────────────────────────────────────

test("submitUpdate reputation PDA is first account (writable, non-signer)", async () => {
  const { conn, sends } = makeMockConn({ accountData: makeAccountData(0n) });
  await new Voter(conn, PROGRAM_ID, ORACLE_KEYPAIR, MOCK_IDL).submitUpdate(defaultUpdate());
  const keys = sends[0].ixKeys;
  assert.equal(keys.length, 2);
  assert.equal(keys[0].isWritable, true);
  assert.equal(keys[0].isSigner,   false);
});

test("submitUpdate oracle keypair is second account (signer, non-writable) and included in signers", async () => {
  const { conn, sends } = makeMockConn({ accountData: makeAccountData(0n) });
  await new Voter(conn, PROGRAM_ID, ORACLE_KEYPAIR, MOCK_IDL).submitUpdate(defaultUpdate());
  const keys = sends[0].ixKeys;
  assert.equal(keys[1].pubkey.toBase58(), ORACLE_KEYPAIR.publicKey.toBase58());
  assert.equal(keys[1].isSigner,   true);
  assert.equal(keys[1].isWritable, false);
  assert.equal(sends[0].signers.length, 1);
  assert.deepEqual(sends[0].signers[0].publicKey.toBytes(), ORACLE_KEYPAIR.publicKey.toBytes());
});

// ── return value ──────────────────────────────────────────────────────────────

test("submitUpdate returns the transaction signature", async () => {
  const { conn } = makeMockConn({ accountData: makeAccountData(0n), sendResult: "realSig999" });
  const sig = await new Voter(conn, PROGRAM_ID, ORACLE_KEYPAIR, MOCK_IDL).submitUpdate(defaultUpdate());
  assert.equal(sig, "realSig999");
});

// ── error paths ───────────────────────────────────────────────────────────────

test("submitUpdate throws with 'ReputationAccount not found' when account is missing", async () => {
  const { conn } = makeMockConn({ accountData: null });
  await assert.rejects(
    () => new Voter(conn, PROGRAM_ID, ORACLE_KEYPAIR, MOCK_IDL).submitUpdate(defaultUpdate()),
    /ReputationAccount not found/,
  );
});

test("submitUpdate throws with 'ReputationAccount data too short' when data < OFF_NONCE+8 bytes", async () => {
  // OFF_NONCE=90, so 97 bytes total are needed; 96 is one byte short.
  const shortData = Buffer.alloc(96, 0);
  const { conn }  = makeMockConn({ accountData: shortData });
  await assert.rejects(
    () => new Voter(conn, PROGRAM_ID, ORACLE_KEYPAIR, MOCK_IDL).submitUpdate(defaultUpdate()),
    /ReputationAccount data too short/,
  );
});

// ── retry logic ───────────────────────────────────────────────────────────────

test("submitUpdate retries once on transient sendTransaction failure and succeeds", { timeout: 5_000 }, async () => {
  // sendFailCount=1: first attempt throws, second succeeds (incurs 500 ms RETRY_DELAYS_MS[0])
  const { conn, sends } = makeMockConn({ accountData: makeAccountData(0n), sendResult: "retriedSig", sendFailCount: 1 });
  const sig = await new Voter(conn, PROGRAM_ID, ORACLE_KEYPAIR, MOCK_IDL).submitUpdate(defaultUpdate());
  assert.equal(sig, "retriedSig");
  assert.equal(sends.length, 2, "should have attempted sendTransaction twice");
});
