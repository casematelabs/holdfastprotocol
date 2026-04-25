import { test } from "node:test";
import assert from "node:assert/strict";
import { parseKeypairBytes } from "./config.js";

const VALID_64 = Array.from({ length: 64 }, (_, i) => i % 256);

test("parseKeypairBytes: accepts valid 64-byte array", () => {
  const result = parseKeypairBytes(JSON.stringify(VALID_64), "test-source");
  assert.deepEqual(result, VALID_64);
});

test("parseKeypairBytes: throws on invalid JSON", () => {
  assert.throws(
    () => parseKeypairBytes("not-valid-json{", "env:ORACLE_KEYPAIR_JSON"),
    /invalid JSON/,
  );
});

test("parseKeypairBytes: throws on empty string", () => {
  assert.throws(
    () => parseKeypairBytes("", "env:ORACLE_KEYPAIR_JSON"),
    /invalid JSON/,
  );
});

test("parseKeypairBytes: throws when parsed value is an object, not an array", () => {
  assert.throws(
    () => parseKeypairBytes('{"key":1}', "test-source"),
    /JSON array/,
  );
});

test("parseKeypairBytes: throws when parsed value is a number", () => {
  assert.throws(
    () => parseKeypairBytes("42", "test-source"),
    /JSON array/,
  );
});

test("parseKeypairBytes: throws when array is too short", () => {
  assert.throws(
    () => parseKeypairBytes(JSON.stringify([1, 2, 3]), "test-source"),
    /must be 64 bytes, got 3/,
  );
});

test("parseKeypairBytes: throws when array is too long", () => {
  const long = Array.from({ length: 65 }, () => 0);
  assert.throws(
    () => parseKeypairBytes(JSON.stringify(long), "test-source"),
    /must be 64 bytes, got 65/,
  );
});

test("parseKeypairBytes: throws on byte value above 255", () => {
  const bad = [...VALID_64];
  bad[10] = 300;
  assert.throws(
    () => parseKeypairBytes(JSON.stringify(bad), "test-source"),
    /invalid byte at index 10/,
  );
});

test("parseKeypairBytes: throws on negative byte value", () => {
  const bad = [...VALID_64];
  bad[0] = -1;
  assert.throws(
    () => parseKeypairBytes(JSON.stringify(bad), "test-source"),
    /invalid byte at index 0/,
  );
});

test("parseKeypairBytes: throws on fractional byte value", () => {
  const bad = [...VALID_64];
  bad[5] = 1.5;
  assert.throws(
    () => parseKeypairBytes(JSON.stringify(bad), "test-source"),
    /invalid byte at index 5/,
  );
});

test("parseKeypairBytes: throws on string element in array", () => {
  const bad: unknown[] = [...VALID_64];
  bad[3] = "ff";
  assert.throws(
    () => parseKeypairBytes(JSON.stringify(bad), "test-source"),
    /invalid byte at index 3/,
  );
});

test("parseKeypairBytes: throws on null element in array", () => {
  const bad: unknown[] = [...VALID_64];
  bad[7] = null;
  assert.throws(
    () => parseKeypairBytes(JSON.stringify(bad), "test-source"),
    /invalid byte at index 7/,
  );
});

test("parseKeypairBytes: source label appears in error messages", () => {
  assert.throws(
    () => parseKeypairBytes("oops", "/path/to/oracle.json"),
    /\/path\/to\/oracle\.json/,
  );
});
