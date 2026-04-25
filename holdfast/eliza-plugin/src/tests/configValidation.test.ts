import { test } from "node:test";
import assert from "node:assert/strict";
import { ZodError } from "zod";
import { createHoldfastPlugin } from "../index.js";

test("invalid rpcUrl throws ZodError mentioning rpcUrl", () => {
  assert.throws(
    () => createHoldfastPlugin({ rpcUrl: "not-a-url" }),
    (err: unknown) => {
      assert(err instanceof ZodError, `expected ZodError, got ${String(err)}`);
      const flat = err.flatten();
      assert(
        "rpcUrl" in flat.fieldErrors,
        `expected rpcUrl in fieldErrors, got: ${JSON.stringify(flat.fieldErrors)}`,
      );
      return true;
    },
  );
});

test("invalid agentWallet throws ZodError mentioning agentWallet", () => {
  assert.throws(
    () => createHoldfastPlugin({ agentWallet: "!not-a-pubkey!" }),
    (err: unknown) => {
      assert(err instanceof ZodError, `expected ZodError, got ${String(err)}`);
      const flat = err.flatten();
      assert(
        "agentWallet" in flat.fieldErrors,
        `expected agentWallet in fieldErrors, got: ${JSON.stringify(flat.fieldErrors)}`,
      );
      return true;
    },
  );
});

test("minimal valid config (empty object) does not throw", () => {
  assert.doesNotThrow(() => createHoldfastPlugin({}));
});

test("valid rpcUrl and indexerUrl do not throw", () => {
  assert.doesNotThrow(() =>
    createHoldfastPlugin({
      rpcUrl: "https://api.devnet.solana.com",
      indexerUrl: "https://indexer.holdfastprotocol.com",
    }),
  );
});
