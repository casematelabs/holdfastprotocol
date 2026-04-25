import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Keypair, PublicKey, type Transaction } from "@solana/web3.js";
import { AgentRegistryResponder } from "./responder.js";
import type { ValidationRequestedEvent } from "./types.js";

const ORACLE_KEYPAIR   = Keypair.generate();
const PROGRAM_ID       = new PublicKey("11111111111111111111111111111112");
const ASSET_PUBKEY     = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const VALIDATOR_PUBKEY = ORACLE_KEYPAIR.publicKey;

// Recompute discriminator the same way responder.ts does.
const RESPOND_DISCRIMINATOR = createHash("sha256")
  .update("global:respond_to_validation")
  .digest()
  .subarray(0, 8);

function makeEvent(nonce = 5): ValidationRequestedEvent {
  return {
    signature:        "testSig123",
    asset:            ASSET_PUBKEY.toBase58(),
    validatorAddress: VALIDATOR_PUBKEY.toBase58(),
    nonce,
    requestHash:      Buffer.alloc(32, 0xab),
    detectedAt:       1_700_000_000,
  };
}

// ── buildStubResult ───────────────────────────────────────────────────────────

test("buildStubResult returns score=75 for any event", () => {
  const responder = new AgentRegistryResponder(null as any, PROGRAM_ID, ORACLE_KEYPAIR);
  assert.equal(responder.buildStubResult(makeEvent()).score, 75);
});

test("buildStubResult threads through asset, validatorAddress, nonce from event", () => {
  const responder = new AgentRegistryResponder(null as any, PROGRAM_ID, ORACLE_KEYPAIR);
  const result    = responder.buildStubResult(makeEvent(17));
  assert.equal(result.asset,            ASSET_PUBKEY.toBase58());
  assert.equal(result.validatorAddress, VALIDATOR_PUBKEY.toBase58());
  assert.equal(result.nonce,            17);
});

test("buildStubResult is pure: same input produces same output", () => {
  const responder = new AgentRegistryResponder(null as any, PROGRAM_ID, ORACLE_KEYPAIR);
  const event     = makeEvent(3);
  assert.deepEqual(responder.buildStubResult(event), responder.buildStubResult(event));
});

// ── submitResponse ────────────────────────────────────────────────────────────

test("submitResponse sends transaction with respond_to_validation discriminator and score byte", async () => {
  // Capture instruction data via an array to avoid TypeScript `let` narrowing issues.
  const ixDatas: Buffer[] = [];
  const mockConn = {
    sendTransaction: async (tx: Transaction) => {
      ixDatas.push(Buffer.from(tx.instructions[0].data));
      return "respSig1";
    },
    confirmTransaction: async () => ({ value: { err: null } }),
  };

  const responder = new AgentRegistryResponder(mockConn as any, PROGRAM_ID, ORACLE_KEYPAIR);
  const sig = await responder.submitResponse({
    asset:            ASSET_PUBKEY.toBase58(),
    validatorAddress: VALIDATOR_PUBKEY.toBase58(),
    nonce:            5,
    score:            75,
  });

  assert.equal(sig, "respSig1");
  assert.equal(ixDatas.length, 1);
  const data = ixDatas[0];
  // discriminator(8) + score(1) = 9 bytes
  assert.equal(data.length, 9);
  assert.deepEqual(data.subarray(0, 8), RESPOND_DISCRIMINATOR);
  assert.equal(data.readUInt8(8), 75);
});

test("submitResponse uses request PDA as first writable non-signer, oracle as second signer", async () => {
  type KeyMeta = { pubkey: PublicKey; isSigner: boolean; isWritable: boolean };
  const allKeys: KeyMeta[][] = [];
  const mockConn = {
    sendTransaction: async (tx: Transaction) => {
      allKeys.push(tx.instructions[0].keys as KeyMeta[]);
      return "sig";
    },
    confirmTransaction: async () => ({ value: { err: null } }),
  };

  const responder = new AgentRegistryResponder(mockConn as any, PROGRAM_ID, ORACLE_KEYPAIR);
  await responder.submitResponse({
    asset:            ASSET_PUBKEY.toBase58(),
    validatorAddress: VALIDATOR_PUBKEY.toBase58(),
    nonce:            5,
    score:            75,
  });

  assert.equal(allKeys.length, 1);
  const keys = allKeys[0];
  assert.equal(keys.length, 2);
  // first key: request PDA — writable, not a signer
  assert.equal(keys[0].isWritable, true);
  assert.equal(keys[0].isSigner,   false);
  // second key: oracle keypair — signer, not writable
  assert.equal(keys[1].pubkey.toBase58(), ORACLE_KEYPAIR.publicKey.toBase58());
  assert.equal(keys[1].isSigner,          true);
  assert.equal(keys[1].isWritable,        false);
});
