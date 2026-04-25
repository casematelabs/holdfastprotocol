import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REPUTATION_ACCOUNT_SCHEMA_VERSION,
  ACCOUNT_SIZE,
  HIST_ENTRY_SIZE,
  OFF_SCHEMA_VERSION,
  OFF_HISTORY_LEN,
  OFF_HISTORY_HEAD,
  OFF_HISTORY,
} from "./reputation-layout.js";

// Field byte sizes derived from the Rust struct definition.
const DISC = 8;
const SCHEMA_VERSION_BYTES = 1;
const AGENT_BYTES = 32;       // Pubkey
const SCORE_BYTES = 8;        // u64
const TIER_BYTES = 1;         // u8 (VerifTier)
const TOTAL_PACTS_BYTES = 8;  // u64
const DISPUTE_COUNT_BYTES = 8;// u64
const CREATED_AT_BYTES = 8;   // i64
const LAST_UPDATED_BYTES = 8; // i64
const DECAY_CURSOR_BYTES = 8; // i64
const NONCE_BYTES = 8;        // u64
const HISTORY_LEN_BYTES = 1;  // u8
const HISTORY_HEAD_BYTES = 1; // u8
const HISTORY_RING_BYTES = 18 * 20; // [HistEntry; 20]
const PADDING_BYTES = 51;
const BUMP_BYTES = 1;

test("ACCOUNT_SIZE matches sum of all field bytes", () => {
  const total =
    DISC +
    SCHEMA_VERSION_BYTES +
    AGENT_BYTES +
    SCORE_BYTES +
    TIER_BYTES +
    TOTAL_PACTS_BYTES +
    DISPUTE_COUNT_BYTES +
    CREATED_AT_BYTES +
    LAST_UPDATED_BYTES +
    DECAY_CURSOR_BYTES +
    NONCE_BYTES +
    HISTORY_LEN_BYTES +
    HISTORY_HEAD_BYTES +
    HISTORY_RING_BYTES +
    PADDING_BYTES +
    BUMP_BYTES;
  assert.equal(total, ACCOUNT_SIZE, `expected ${ACCOUNT_SIZE}, computed ${total}`);
});

test("HIST_ENTRY_SIZE matches sum of HistEntry field bytes", () => {
  const OUTCOME_BYTES = 1;    // u8
  const SCORE_DELTA_BYTES = 2; // i16
  const TIMESTAMP_BYTES = 8;  // i64
  const PACT_ID_BYTES = 7;    // [u8; 7]
  const total = OUTCOME_BYTES + SCORE_DELTA_BYTES + TIMESTAMP_BYTES + PACT_ID_BYTES;
  assert.equal(total, HIST_ENTRY_SIZE);
});

test("REPUTATION_ACCOUNT_SCHEMA_VERSION is 1", () => {
  assert.equal(REPUTATION_ACCOUNT_SCHEMA_VERSION, 1);
});

test("OFF_SCHEMA_VERSION is right after discriminator", () => {
  assert.equal(OFF_SCHEMA_VERSION, DISC);
});

test("OFF_HISTORY_LEN matches computed offset", () => {
  const expected =
    DISC +
    SCHEMA_VERSION_BYTES +
    AGENT_BYTES +
    SCORE_BYTES +
    TIER_BYTES +
    TOTAL_PACTS_BYTES +
    DISPUTE_COUNT_BYTES +
    CREATED_AT_BYTES +
    LAST_UPDATED_BYTES +
    DECAY_CURSOR_BYTES +
    NONCE_BYTES;
  assert.equal(OFF_HISTORY_LEN, expected, `expected ${expected}, got ${OFF_HISTORY_LEN}`);
});

test("OFF_HISTORY_HEAD is OFF_HISTORY_LEN + 1", () => {
  assert.equal(OFF_HISTORY_HEAD, OFF_HISTORY_LEN + HISTORY_LEN_BYTES);
});

test("OFF_HISTORY is OFF_HISTORY_HEAD + 1", () => {
  assert.equal(OFF_HISTORY, OFF_HISTORY_HEAD + HISTORY_HEAD_BYTES);
});

test("ring buffer fits within ACCOUNT_SIZE", () => {
  const ringEnd = OFF_HISTORY + HISTORY_RING_BYTES;
  assert.ok(
    ringEnd <= ACCOUNT_SIZE,
    `ring buffer ends at ${ringEnd}, exceeds ACCOUNT_SIZE ${ACCOUNT_SIZE}`,
  );
});
