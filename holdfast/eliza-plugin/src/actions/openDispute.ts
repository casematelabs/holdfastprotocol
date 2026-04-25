import type { Action, IAgentRuntime, Memory, State, HandlerCallback } from "@elizaos/core";
import type { HoldfastClient } from "@holdfastprotocol/sdk";
import { EscrowSignerRequiredError } from "@holdfastprotocol/sdk";
import { PublicKey } from "@solana/web3.js";
import { withRetry } from "../utils/retry.js";

export function makeOpenDisputeAction(client: HoldfastClient): Action {
  return {
    name: "OPEN_DISPUTE",
    description: "Open a dispute on a Holdfast Protocol pact. Requires `escrowId` (pubkey) and `reason` in options.",
    similes: ["DISPUTE_PACT", "RAISE_DISPUTE"],
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
      const reason = options?.reason as string | undefined;
      if (!escrowId || !reason) {
        await callback?.({ text: "OPEN_DISPUTE requires `escrowId` and `reason` in options." });
        return;
      }
      try {
        await withRetry(() => client.escrow.openDispute(new PublicKey(escrowId), reason));
        await callback?.({ text: `Dispute opened on pact ${escrowId}.` });
      } catch (err) {
        if (err instanceof EscrowSignerRequiredError) {
          await callback?.({
            text:
              "Cannot open dispute: plugin was initialised without a signer. " +
              "Add a `signer` to the holdfast-protocol plugin config.",
          });
        } else {
          await callback?.({ text: `OPEN_DISPUTE failed: ${(err as Error).message}` });
        }
      }
    },
  };
}
