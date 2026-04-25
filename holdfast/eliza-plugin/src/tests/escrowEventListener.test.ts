import { test } from "node:test";
import assert from "node:assert/strict";
import { EscrowEventListenerService } from "../services/escrowEventListener.js";

const AGENT_WALLET = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

function makeRuntime(): { events: Array<{ event: string; params: unknown }>; runtime: never } {
  const events: Array<{ event: string; params: unknown }> = [];
  const runtime = {
    emitEvent: async (event: string, params: unknown) => { events.push({ event, params }); },
  } as never;
  return { events, runtime };
}

// ─── start / stop ─────────────────────────────────────────────────────────────

test("EscrowEventListenerService: start is a no-op when no agentWallet provided", async () => {
  const { events, runtime } = makeRuntime();
  const client = { escrow: { listPacts: async () => ({ pacts: [] }) } } as never;
  const service = new EscrowEventListenerService(client, runtime);
  await service.start();
  await service.stop();
  assert.equal(events.length, 0);
});

test("EscrowEventListenerService: stop does not throw when called before start", async () => {
  const client = { escrow: { listPacts: async () => ({ pacts: [] }) } } as never;
  const { runtime } = makeRuntime();
  const service = new EscrowEventListenerService(client, runtime, AGENT_WALLET);
  await assert.doesNotReject(() => service.stop());
});

test("EscrowEventListenerService: stop does not throw after start", async () => {
  const client = { escrow: { listPacts: async () => ({ pacts: [] }) } } as never;
  const { runtime } = makeRuntime();
  const service = new EscrowEventListenerService(client, runtime, AGENT_WALLET);
  await service.start();
  await assert.doesNotReject(() => service.stop());
});

// ─── event emission ───────────────────────────────────────────────────────────

test("EscrowEventListenerService: emits HOLDFAST_PACT_STATE for newly seen pact", async () => {
  const pact = { escrowId: "EscrowAAA", status: "funded", beneficiary: "BeneficiaryXYZ" };
  const client = { escrow: { listPacts: async () => ({ pacts: [pact] }) } } as never;
  const { events, runtime } = makeRuntime();
  const service = new EscrowEventListenerService(client, runtime, AGENT_WALLET);
  await (service as never as { fetchAndEmit(): Promise<void> }).fetchAndEmit();
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "HOLDFAST_PACT_STATE");
  assert.deepEqual((events[0].params as { pact: unknown }).pact, pact);
});

test("EscrowEventListenerService: does not re-emit pact with unchanged status", async () => {
  const pact = { escrowId: "EscrowAAA", status: "funded", beneficiary: "BeneficiaryXYZ" };
  const client = { escrow: { listPacts: async () => ({ pacts: [pact] }) } } as never;
  const { events, runtime } = makeRuntime();
  const service = new EscrowEventListenerService(client, runtime, AGENT_WALLET);
  const fetch = (service as never as { fetchAndEmit(): Promise<void> }).fetchAndEmit.bind(service);
  await fetch();
  await fetch();
  assert.equal(events.length, 1);
});

test("EscrowEventListenerService: re-emits when pact status changes between polls", async () => {
  let call = 0;
  const client = {
    escrow: {
      listPacts: async () => {
        call++;
        const status = call === 1 ? "funded" : "released";
        return { pacts: [{ escrowId: "EscrowAAA", status, beneficiary: "B" }] };
      },
    },
  } as never;
  const { events, runtime } = makeRuntime();
  const service = new EscrowEventListenerService(client, runtime, AGENT_WALLET);
  const fetch = (service as never as { fetchAndEmit(): Promise<void> }).fetchAndEmit.bind(service);
  await fetch();
  await fetch();
  assert.equal(events.length, 2);
});

test("EscrowEventListenerService: re-emits after pact leaves and re-enters the list", async () => {
  let call = 0;
  const client = {
    escrow: {
      listPacts: async () => {
        call++;
        if (call === 2) return { pacts: [] };
        return { pacts: [{ escrowId: "EscrowAAA", status: "funded", beneficiary: "B" }] };
      },
    },
  } as never;
  const { events, runtime } = makeRuntime();
  const service = new EscrowEventListenerService(client, runtime, AGENT_WALLET);
  const fetch = (service as never as { fetchAndEmit(): Promise<void> }).fetchAndEmit.bind(service);
  await fetch(); // emit (first appearance)
  await fetch(); // no emit (pact gone, removed from state)
  await fetch(); // emit (pact re-appears, unknown to state)
  assert.equal(events.length, 2);
});

test("EscrowEventListenerService: fetchAndEmit skips emit when no agentPubkey set", async () => {
  const client = {
    escrow: { listPacts: async () => { throw new Error("should not be called"); } },
  } as never;
  const { events, runtime } = makeRuntime();
  // Construct without agentWallet so agentPubkey is null
  const service = new EscrowEventListenerService(client, runtime);
  await (service as never as { fetchAndEmit(): Promise<void> }).fetchAndEmit();
  assert.equal(events.length, 0);
});
