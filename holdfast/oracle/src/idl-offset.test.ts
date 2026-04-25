import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { computeFieldOffset, computeNonceOffset, type Idl } from "./idl-offset.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── fixtures ──────────────────────────────────────────────────────────────────

const SIMPLE_IDL: Idl = {
  types: [
    {
      name: "MyEnum",
      type: {
        kind: "enum",
        variants: [{ name: "A" }, { name: "B" }, { name: "C" }],
      },
    },
    {
      name: "Inner",
      type: {
        kind: "struct",
        fields: [
          { name: "x", type: "u32" },
          { name: "y", type: "u64" },
        ],
      },
    },
    {
      name: "MyAccount",
      type: {
        kind: "struct",
        fields: [
          { name: "schema_version", type: "u8" },           // off  8, size 1
          { name: "owner",          type: "pubkey" },        // off  9, size 32
          { name: "balance",        type: "u64" },           // off 41, size 8
          { name: "tier",           type: { defined: { name: "MyEnum" } } }, // off 49, size 1
          { name: "nested",         type: { defined: { name: "Inner" } } },  // off 50, size 12
          { name: "flags",          type: { array: ["u8", 4] } },             // off 62, size 4
          { name: "target",         type: "pubkey" },        // off 66, size 32
        ],
      },
    },
  ],
};

// Minimal IDL matching the real on-chain ReputationAccount layout.
// Must stay in sync with programs/vaultpact/src/lib.rs.
const REPUTATION_IDL: Idl = {
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

// ── computeFieldOffset ────────────────────────────────────────────────────────

test("computeFieldOffset: first field starts at discriminator offset 8", () => {
  assert.equal(computeFieldOffset(SIMPLE_IDL, "MyAccount", "schema_version"), 8);
});

test("computeFieldOffset: pubkey field (32 bytes) offset is correct", () => {
  // 8 (disc) + 1 (u8)
  assert.equal(computeFieldOffset(SIMPLE_IDL, "MyAccount", "owner"), 9);
});

test("computeFieldOffset: field after pubkey is correct", () => {
  // 8 + 1 + 32
  assert.equal(computeFieldOffset(SIMPLE_IDL, "MyAccount", "balance"), 41);
});

test("computeFieldOffset: unit enum predecessor counted as 1 byte", () => {
  // 8 + 1 + 32 + 8
  assert.equal(computeFieldOffset(SIMPLE_IDL, "MyAccount", "tier"), 49);
});

test("computeFieldOffset: nested struct size is sum of its fields", () => {
  // 8 + 1 + 32 + 8 + 1 (enum)
  assert.equal(computeFieldOffset(SIMPLE_IDL, "MyAccount", "nested"), 50);
});

test("computeFieldOffset: field after nested struct and fixed array", () => {
  // 8 + 1 + 32 + 8 + 1 + 12 (Inner) + 4 (array[u8;4])
  assert.equal(computeFieldOffset(SIMPLE_IDL, "MyAccount", "target"), 66);
});

// ── computeNonceOffset ────────────────────────────────────────────────────────

test("computeNonceOffset: returns 90 for correct ReputationAccount layout", () => {
  // 8(disc) + 1 + 32 + 8 + 1 + 8 + 8 + 8 + 8 + 8 = 90
  assert.equal(computeNonceOffset(REPUTATION_IDL), 90);
});

test("computeNonceOffset against real vaultpact IDL returns 90", () => {
  const idlPath = resolve(__dirname, "../../target/idl/vaultpact.json");
  const idl = JSON.parse(readFileSync(idlPath, "utf8")) as Idl;
  assert.equal(computeNonceOffset(idl), 90);
});

// ── error cases ───────────────────────────────────────────────────────────────

test("computeFieldOffset throws when struct not found", () => {
  assert.throws(
    () => computeFieldOffset(SIMPLE_IDL, "NoSuchAccount", "field"),
    /not found in IDL types/,
  );
});

test("computeFieldOffset throws when field not found", () => {
  assert.throws(
    () => computeFieldOffset(SIMPLE_IDL, "MyAccount", "no_such_field"),
    /not found in struct/,
  );
});

test("computeFieldOffset throws for vec (variable-length)", () => {
  const idl: Idl = {
    types: [{
      name: "Bad",
      type: {
        kind: "struct",
        fields: [
          { name: "items", type: { vec: "u8" } },
          { name: "target", type: "u64" },
        ],
      },
    }],
  };
  assert.throws(
    () => computeFieldOffset(idl, "Bad", "target"),
    /variable-length/,
  );
});

test("computeFieldOffset throws for option (variable-length)", () => {
  const idl: Idl = {
    types: [{
      name: "Bad",
      type: {
        kind: "struct",
        fields: [
          { name: "maybe", type: { option: "u64" } },
          { name: "target", type: "u8" },
        ],
      },
    }],
  };
  assert.throws(
    () => computeFieldOffset(idl, "Bad", "target"),
    /variable-length/,
  );
});

test("computeFieldOffset throws for enum with tuple variants", () => {
  const idl: Idl = {
    types: [
      {
        name: "ComplexEnum",
        type: {
          kind: "enum",
          variants: [
            { name: "Unit" },
            { name: "WithData", fields: [{ name: "value", type: "u64" }] },
          ],
        },
      },
      {
        name: "Acct",
        type: {
          kind: "struct",
          fields: [
            { name: "e", type: { defined: { name: "ComplexEnum" } } },
            { name: "after", type: "u8" },
          ],
        },
      },
    ],
  };
  assert.throws(
    () => computeFieldOffset(idl, "Acct", "after"),
    /enum with tuple\/struct variants/,
  );
});

test("computeFieldOffset throws for unknown primitive type", () => {
  const idl: Idl = {
    types: [{
      name: "Acct",
      type: {
        kind: "struct",
        fields: [
          { name: "s", type: "string" as "u8" },
          { name: "after", type: "u8" },
        ],
      },
    }],
  };
  assert.throws(
    () => computeFieldOffset(idl, "Acct", "after"),
    /variable-length/,
  );
});
