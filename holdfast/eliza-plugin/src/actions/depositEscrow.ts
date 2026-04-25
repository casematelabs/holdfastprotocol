import type { Action, IAgentRuntime, Memory, State, HandlerCallback } from "@elizaos/core";
import type { HoldfastClient } from "@holdfastprotocol/sdk";
import { EscrowSignerRequiredError } from "@holdfastprotocol/sdk";
import { PublicKey } from "@solana/web3.js";
import { withRetry } from "../utils/retry.js";

export function makeDepositEscrowAction(client: HoldfastClient): Action {
  return {
    name: "DEPOSIT_ESCROW",
    description: "Deposit SOL into an existing Holdfast Protocol pact escrow to activate it. Requires `escrowId` (pubkey) in options.",
    similes: ["FUND_ESCROW", "ACTIVATE_PACT"],
    examples: [],
    validate: async (_runtime: IAgentRuntime, _message: Memory) => true,
    handler: async (
      _runtime: IAgentRuntime,
      _message: Memory,
      _state?: State,
      options?: Record<string, unknown>,
      callback?: HandlerCallback,
    ): Promise<void> => {
      const escrowId = options?.escrowId as string | undefined;
      if (!escrowId) {
        await callback?.({ text: "DEPOSIT_ESCROW requires `escrowId` in options." });
        return;
      }
      try {
        await withRetry(() => client.escrow.depositEscrow(new PublicKey(escrowId)));
        await callback?.({ text: `Escrow ${escrowId} funded and active.` });
      } catch (err) {
        if (err instanceof EscrowSignerRequiredError) {
          await callback?.({
            text:
              "Cannot deposit: plugin was initialised without a signer. " +
              "Add a `signer` to the holdfast-protocol plugin config.",
          });
        } else {
          await callback?.({ text: `DEPOSIT_ESCROW failed: ${(err as Error).message}` });
        }
      }
    },
  };
}
