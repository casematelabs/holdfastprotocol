import type { Action, IAgentRuntime, Memory, State, HandlerCallback } from "@elizaos/core";
import type { HoldfastClient } from "@holdfastprotocol/sdk";
import { EscrowSignerRequiredError } from "@holdfastprotocol/sdk";
import { PublicKey } from "@solana/web3.js";
import { withRetry } from "../utils/retry.js";

export function makeReleasePactAction(client: HoldfastClient): Action {
  return {
    name: "RELEASE_PACT",
    description: "Release a Holdfast Protocol escrow pact, transferring funds to the counterparty. Requires `escrowId` (pubkey) in options.",
    similes: ["COMPLETE_PACT", "RELEASE_ESCROW", "SETTLE_PACT"],
    examples: [],
    validate: async (_runtime: IAgentRuntime, message: Memory) => {
      const escrowId = (message.content as Record<string, unknown>)?.escrowId;
      return typeof escrowId === "string" && escrowId.length > 0;
    },
    handler: async (
      _runtime: IAgentRuntime,
      _message: Memory,
      _state?: State,
      options?: Record<string, unknown>,
      callback?: HandlerCallback,
    ): Promise<void> => {
      const escrowId = options?.escrowId as string | undefined;
      if (!escrowId) {
        await callback?.({ text: "RELEASE_PACT requires `escrowId` in options." });
        return;
      }
      try {
        await withRetry(() => client.escrow.releasePact(new PublicKey(escrowId)));
        await callback?.({ text: `Pact ${escrowId} released. Funds transferred to counterparty.` });
      } catch (err) {
        if (err instanceof EscrowSignerRequiredError) {
          await callback?.({
            text:
              "Cannot release pact: plugin was initialised without a signer. " +
              "Add a `signer` to the holdfast-protocol plugin config.",
          });
        } else {
          await callback?.({ text: `RELEASE_PACT failed: ${(err as Error).message}` });
        }
      }
    },
  };
}
