import { test } from "node:test";
import assert from "node:assert/strict";
import { EscrowSignerRequiredError } from "@holdfastprotocol/sdk";
import { makeCheckReputationAction } from "../actions/checkReputation.js";
import { makeCreatePactAction } from "../actions/createPact.js";
import { makeDepositEscrowAction } from "../actions/depositEscrow.js";
import { makeReleasePactAction } from "../actions/releasePact.js";
import { makeOpenDisputeAction } from "../actions/openDispute.js";

const fakeRuntime = {} as never;
const fakeState = {} as never;

const PUBKEY_A = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const PUBKEY_B = "7WNp3pFzBs1wLXsqMLXUKnUWGMH6qDMWpH8p2zQVqjVh";
const PUBKEY_C = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function makeCallback(): { calls: Array<{ text: string }>; fn: (c: { text: string }) => Promise<void> } {
  const calls: Array<{ text: string }> = [];
  return { calls, fn: async (c) => { calls.push(c); } };
}

// ─── CHECK_REPUTATION ────────────────────────────────────────────────────────

test("CHECK_REPUTATION validate: true when message contains base58 pubkey", async () => {
  const action = makeCheckReputationAction({} as never);
  const msg = { content: { text: `What is the rep of ${PUBKEY_A}?` } } as never;
  assert.equal(await action.validate(fakeRuntime, msg), true);
});

test("CHECK_REPUTATION validate: false when no pubkey in message", async () => {
  const action = makeCheckReputationAction({} as never);
  const msg = { content: { text: "hello there" } } as never;
  assert.equal(await action.validate(fakeRuntime, msg), false);
});

test("CHECK_REPUTATION handler: returns formatted reputation on success", async () => {
  const client = {
    reputation: {
      get: async () => ({ tier: "Gold", score: 92, totalPacts: 14, disputeCount: 0 }),
    },
  } as never;
  const { calls, fn } = makeCallback();
  const msg = { content: { text: `rep of ${PUBKEY_A}` } } as never;
  await makeCheckReputationAction(client).handler(fakeRuntime, msg, fakeState, {}, fn);
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /Tier: Gold/);
  assert.match(calls[0].text, /Score: 92/);
  assert.match(calls[0].text, /Pacts completed: 14/);
});

test("CHECK_REPUTATION handler: error message when no pubkey in text", async () => {
  const { calls, fn } = makeCallback();
  const msg = { content: { text: "no pubkey here" } } as never;
  await makeCheckReputationAction({} as never).handler(fakeRuntime, msg, fakeState, {}, fn);
  assert.match(calls[0].text, /No valid public key/);
});

test("CHECK_REPUTATION handler: error message when client throws", async () => {
  const client = {
    reputation: { get: async () => { throw new Error("RPC timeout"); } },
  } as never;
  const { calls, fn } = makeCallback();
  const msg = { content: { text: `rep of ${PUBKEY_A}` } } as never;
  await makeCheckReputationAction(client).handler(fakeRuntime, msg, fakeState, {}, fn);
  assert.match(calls[0].text, /Failed to fetch reputation/);
  assert.match(calls[0].text, /RPC timeout/);
});

// ─── CREATE_PACT ─────────────────────────────────────────────────────────────

test("CREATE_PACT validate: always returns true", async () => {
  const action = makeCreatePactAction({} as never);
  assert.equal(await action.validate(fakeRuntime, { content: {} } as never), true);
});

test("CREATE_PACT handler: missing options returns descriptive error", async () => {
  const { calls, fn } = makeCallback();
  await makeCreatePactAction({} as never).handler(fakeRuntime, {} as never, fakeState, {}, fn);
  assert.match(calls[0].text, /counterparty/);
});

test("CREATE_PACT handler: returns escrow ID on success", async () => {
  const client = {
    escrow: { createPact: async () => ({ escrowId: "EscrowXXXYYY" }) },
  } as never;
  const { calls, fn } = makeCallback();
  const opts = {
    counterparty: PUBKEY_A,
    counterpartyWallet: PUBKEY_B,
    mint: PUBKEY_C,
    amount: "1000000",
  };
  await makeCreatePactAction(client).handler(fakeRuntime, {} as never, fakeState, opts, fn);
  assert.match(calls[0].text, /EscrowXXXYYY/);
  assert.match(calls[0].text, /Deposit to activate/);
});

test("CREATE_PACT handler: EscrowSignerRequiredError yields friendly message", async () => {
  const client = {
    escrow: { createPact: async () => { throw new EscrowSignerRequiredError(); } },
  } as never;
  const { calls, fn } = makeCallback();
  const opts = { counterparty: PUBKEY_A, counterpartyWallet: PUBKEY_B, mint: PUBKEY_C, amount: "1" };
  await makeCreatePactAction(client).handler(fakeRuntime, {} as never, fakeState, opts, fn);
  assert.match(calls[0].text, /without a signer/);
});

test("CREATE_PACT handler: generic error reported in callback text", async () => {
  const client = {
    escrow: { createPact: async () => { throw new Error("blockhash expired"); } },
  } as never;
  const { calls, fn } = makeCallback();
  const opts = { counterparty: PUBKEY_A, counterpartyWallet: PUBKEY_B, mint: PUBKEY_C, amount: "1" };
  await makeCreatePactAction(client).handler(fakeRuntime, {} as never, fakeState, opts, fn);
  assert.match(calls[0].text, /CREATE_PACT failed/);
  assert.match(calls[0].text, /blockhash expired/);
});

// ─── DEPOSIT_ESCROW ───────────────────────────────────────────────────────────

test("DEPOSIT_ESCROW handler: missing escrowId returns error", async () => {
  const { calls, fn } = makeCallback();
  await makeDepositEscrowAction({} as never).handler(fakeRuntime, {} as never, fakeState, {}, fn);
  assert.match(calls[0].text, /escrowId/);
});

test("DEPOSIT_ESCROW handler: success path emits funded message", async () => {
  const client = { escrow: { depositEscrow: async () => undefined } } as never;
  const { calls, fn } = makeCallback();
  await makeDepositEscrowAction(client).handler(fakeRuntime, {} as never, fakeState, { escrowId: PUBKEY_A }, fn);
  assert.match(calls[0].text, /funded and active/);
});

test("DEPOSIT_ESCROW handler: EscrowSignerRequiredError yields friendly message", async () => {
  const client = {
    escrow: { depositEscrow: async () => { throw new EscrowSignerRequiredError(); } },
  } as never;
  const { calls, fn } = makeCallback();
  await makeDepositEscrowAction(client).handler(fakeRuntime, {} as never, fakeState, { escrowId: PUBKEY_A }, fn);
  assert.match(calls[0].text, /without a signer/);
});

test("DEPOSIT_ESCROW handler: generic error reported in callback text", async () => {
  const client = {
    escrow: { depositEscrow: async () => { throw new Error("insufficient funds"); } },
  } as never;
  const { calls, fn } = makeCallback();
  await makeDepositEscrowAction(client).handler(fakeRuntime, {} as never, fakeState, { escrowId: PUBKEY_A }, fn);
  assert.match(calls[0].text, /DEPOSIT_ESCROW failed/);
});

// ─── RELEASE_PACT ─────────────────────────────────────────────────────────────

test("RELEASE_PACT handler: missing escrowId returns error", async () => {
  const { calls, fn } = makeCallback();
  await makeReleasePactAction({} as never).handler(fakeRuntime, {} as never, fakeState, {}, fn);
  assert.match(calls[0].text, /escrowId/);
});

test("RELEASE_PACT handler: success path emits released message", async () => {
  const client = { escrow: { releasePact: async () => undefined } } as never;
  const { calls, fn } = makeCallback();
  await makeReleasePactAction(client).handler(fakeRuntime, {} as never, fakeState, { escrowId: PUBKEY_A }, fn);
  assert.match(calls[0].text, /released/);
  assert.match(calls[0].text, /counterparty/);
});

test("RELEASE_PACT handler: EscrowSignerRequiredError yields friendly message", async () => {
  const client = {
    escrow: { releasePact: async () => { throw new EscrowSignerRequiredError(); } },
  } as never;
  const { calls, fn } = makeCallback();
  await makeReleasePactAction(client).handler(fakeRuntime, {} as never, fakeState, { escrowId: PUBKEY_A }, fn);
  assert.match(calls[0].text, /without a signer/);
});

test("RELEASE_PACT handler: generic error reported in callback text", async () => {
  const client = {
    escrow: { releasePact: async () => { throw new Error("pact not found"); } },
  } as never;
  const { calls, fn } = makeCallback();
  await makeReleasePactAction(client).handler(fakeRuntime, {} as never, fakeState, { escrowId: PUBKEY_A }, fn);
  assert.match(calls[0].text, /RELEASE_PACT failed/);
});

// ─── OPEN_DISPUTE ─────────────────────────────────────────────────────────────

test("OPEN_DISPUTE handler: missing escrowId or reason returns error", async () => {
  const { calls, fn } = makeCallback();
  await makeOpenDisputeAction({} as never).handler(fakeRuntime, {} as never, fakeState, { escrowId: PUBKEY_A }, fn);
  assert.match(calls[0].text, /reason/);
});

test("OPEN_DISPUTE handler: success path emits dispute opened message", async () => {
  const client = { escrow: { openDispute: async () => undefined } } as never;
  const { calls, fn } = makeCallback();
  await makeOpenDisputeAction(client).handler(
    fakeRuntime, {} as never, fakeState,
    { escrowId: PUBKEY_A, reason: "Work not delivered" },
    fn,
  );
  assert.match(calls[0].text, /Dispute opened/);
});

test("OPEN_DISPUTE handler: EscrowSignerRequiredError yields friendly message", async () => {
  const client = {
    escrow: { openDispute: async () => { throw new EscrowSignerRequiredError(); } },
  } as never;
  const { calls, fn } = makeCallback();
  await makeOpenDisputeAction(client).handler(
    fakeRuntime, {} as never, fakeState,
    { escrowId: PUBKEY_A, reason: "test" },
    fn,
  );
  assert.match(calls[0].text, /without a signer/);
});

test("OPEN_DISPUTE handler: generic error reported in callback text", async () => {
  const client = {
    escrow: { openDispute: async () => { throw new Error("pact already disputed"); } },
  } as never;
  const { calls, fn } = makeCallback();
  await makeOpenDisputeAction(client).handler(
    fakeRuntime, {} as never, fakeState,
    { escrowId: PUBKEY_A, reason: "test" },
    fn,
  );
  assert.match(calls[0].text, /OPEN_DISPUTE failed/);
});
