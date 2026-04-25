import type { Action, IAgentRuntime, Memory, State, HandlerCallback } from "@elizaos/core";
import type { HoldfastClient } from "@holdfastprotocol/sdk";
import { EscrowSignerRequiredError } from "@holdfastprotocol/sdk";
import { PublicKey } from "@solana/web3.js";
import { withRetry } from "../utils/retry.js";

export function makeCreatePactAction(client: HoldfastClient): Action {
  return {
    name: "CREATE_PACT",
    description:
      "Create a Holdfast Protocol escrow pact. Requires the plugin to be initialised with a signer. " +
      "Options: counterparty (pubkey), counterpartyWallet (AgentWallet PDA pubkey), " +
      "mint (SPL token mint pubkey), amount (bigint lamports), " +
      "releaseCondition (task | milestone | timed).",
    similes: ["OPEN_PACT", "START_ESCROW", "NEW_PACT"],
    examples: [],
    validate: async (_runtime: IAgentRuntime, _message: Memory) => true,
    handler: async (
      _runtime: IAgentRuntime,
      _message: Memory,
      _state?: State,
      options?: Record<string, unknown>,
      callback?: HandlerCallback,
    ): Promise<void> => {
      if (!options?.counterparty || !options?.counterpartyWallet || !options?.mint || !options?.amount) {
        await callback?.({
          text: "CREATE_PACT requires `counterparty`, `counterpartyWallet`, `mint`, and `amount` in options.",
        });
        return;
      }
      try {
        const pact = await withRetry(() =>
          client.escrow.createPact({
            counterparty: new PublicKey(options.counterparty as string),
            counterpartyWallet: new PublicKey(options.counterpartyWallet as string),
            mint: new PublicKey(options.mint as string),
            amount: BigInt(String(options.amount)),
            releaseCondition: (options.releaseCondition ?? {
              kind: "task",
              timeLockExpiresAt: Math.floor(Date.now() / 1000) + 86400 * 7,
            }) as Parameters<typeof client.escrow.createPact>[0]["releaseCondition"],
          }),
        );
        await callback?.({
          text: `Pact created. Escrow ID: ${pact.escrowId}. Deposit to activate.`,
        });
      } catch (err) {
        if (err instanceof EscrowSignerRequiredError) {
          await callback?.({
            text:
              "Cannot create pact: plugin was initialised without a signer. " +
              "Add a `signer` to the holdfast-protocol plugin config.",
          });
        } else {
          await callback?.({ text: `CREATE_PACT failed: ${(err as Error).message}` });
        }
      }
    },
  };
}
