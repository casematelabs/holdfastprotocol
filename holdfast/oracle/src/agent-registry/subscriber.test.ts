import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { parseValidationRequestedEvent } from "./subscriber.js";

// Recompute discriminator the same way subscriber.ts does.
const DISCRIMINATOR = createHash("sha256")
  .update("event:ValidationRequested")
  .digest()
  .subarray(0, 8);

const SIG           = "testSignature1234567890abcdef";
const ASSET_KEY     = new PublicKey("11111111111111111111111111111112");
const VALIDATOR_KEY = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const REQUEST_HASH  = Buffer.alloc(32, 0xab);

// Layout: discriminator(8) | asset(32) | validator(32) | nonce_u32_LE(4) | hash(32) = 108 bytes
function buildRaw(
  disc: Buffer,
  asset: PublicKey,
  validator: PublicKey,
  nonce: number,
  hash: Buffer,
): Buffer {
  const buf = Buffer.alloc(108);
  disc.copy(buf, 0);
  asset.toBuffer().copy(buf, 8);
  validator.toBuffer().copy(buf, 40);
  buf.writeUInt32LE(nonce, 72);
  hash.copy(buf, 76, 0, 32);
  return buf;
}

function toLogLine(raw: Buffer): string {
  return "Program data: " + raw.toString("base64");
}

test("valid event parses all fields correctly", () => {
  const raw   = buildRaw(DISCRIMINATOR, ASSET_KEY, VALIDATOR_KEY, 7, REQUEST_HASH);
  const event = parseValidationRequestedEvent(toLogLine(raw), SIG);

  assert.ok(event !== null);
  assert.equal(event.signature,        SIG);
  assert.equal(event.asset,            ASSET_KEY.toBase58());
  assert.equal(event.validatorAddress, VALIDATOR_KEY.toBase58());
  assert.equal(event.nonce,            7);
  assert.deepEqual(event.requestHash,  REQUEST_HASH);
});

test("line without 'Program data: ' prefix returns null", () => {
  assert.equal(parseValidationRequestedEvent("Program log: some data", SIG), null);
  assert.equal(parseValidationRequestedEvent("",                         SIG), null);
  assert.equal(parseValidationRequestedEvent("data: aGVsbG8=",           SIG), null);
});

test("wrong discriminator returns null", () => {
  const wrongDisc = Buffer.alloc(8, 0xff);
  const raw       = buildRaw(wrongDisc, ASSET_KEY, VALIDATOR_KEY, 1, REQUEST_HASH);
  assert.equal(parseValidationRequestedEvent(toLogLine(raw), SIG), null);
});

test("payload exactly 107 bytes (one short of minimum) returns null", () => {
  const raw  = buildRaw(DISCRIMINATOR, ASSET_KEY, VALIDATOR_KEY, 1, REQUEST_HASH).subarray(0, 107);
  assert.equal(parseValidationRequestedEvent(toLogLine(raw), SIG), null);
});

test("nonce=0 parses correctly", () => {
  const raw   = buildRaw(DISCRIMINATOR, ASSET_KEY, VALIDATOR_KEY, 0, REQUEST_HASH);
  const event = parseValidationRequestedEvent(toLogLine(raw), SIG);
  assert.ok(event !== null);
  assert.equal(event.nonce, 0);
});

test("nonce=0xffffffff (max u32) round-trips correctly", () => {
  const raw   = buildRaw(DISCRIMINATOR, ASSET_KEY, VALIDATOR_KEY, 0xffffffff, REQUEST_HASH);
  const event = parseValidationRequestedEvent(toLogLine(raw), SIG);
  assert.ok(event !== null);
  assert.equal(event.nonce, 0xffffffff);
});

test("requestHash bytes are preserved exactly", () => {
  const hash  = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
  const raw   = buildRaw(DISCRIMINATOR, ASSET_KEY, VALIDATOR_KEY, 0, hash);
  const event = parseValidationRequestedEvent(toLogLine(raw), SIG);
  assert.ok(event !== null);
  assert.deepEqual(event.requestHash, hash);
});

test("detectedAt is set to unix seconds approximately equal to now", () => {
  const before = Math.floor(Date.now() / 1000);
  const raw    = buildRaw(DISCRIMINATOR, ASSET_KEY, VALIDATOR_KEY, 1, REQUEST_HASH);
  const event  = parseValidationRequestedEvent(toLogLine(raw), SIG);
  const after  = Math.floor(Date.now() / 1000);
  assert.ok(event !== null);
  assert.ok(
    event.detectedAt >= before && event.detectedAt <= after,
    `detectedAt=${event.detectedAt} out of range [${before}, ${after}]`,
  );
});

test("extra trailing bytes beyond 108 are ignored and event parses successfully", () => {
  const raw   = buildRaw(DISCRIMINATOR, ASSET_KEY, VALIDATOR_KEY, 3, REQUEST_HASH);
  const padded = Buffer.concat([raw, Buffer.alloc(20, 0xff)]);
  const event  = parseValidationRequestedEvent(toLogLine(padded), SIG);
  assert.ok(event !== null);
  assert.equal(event.nonce, 3);
});

test("invalid base64 payload that decodes to too-short buffer returns null", () => {
  // Buffer.from with base64 silently ignores invalid chars; result is short → fails length check
  const line = "Program data: !!!";
  assert.equal(parseValidationRequestedEvent(line, SIG), null);
});

test("empty base64 payload (only prefix) returns null", () => {
  assert.equal(parseValidationRequestedEvent("Program data: ", SIG), null);
});
