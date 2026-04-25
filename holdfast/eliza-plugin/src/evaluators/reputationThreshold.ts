import type { Evaluator, IAgentRuntime, Memory } from "@elizaos/core";
import type { HoldfastClient } from "@holdfastprotocol/sdk";
import { VerifTier } from "@holdfastprotocol/sdk";
import { PublicKey } from "@solana/web3.js";

export function makeReputationThresholdEvaluator(client: HoldfastClient): Evaluator {
  return {
    name: "reputationThresholdEvaluator",
    description:
      "After pact creation, checks that the counterparty's Holdfast Protocol reputation meets minimum requirements.",
    similes: [],
    alwaysRun: false,
    examples: [],
    validate: async (_runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
      return message.content?.action === "CREATE_PACT";
    },
    handler: async (runtime: IAgentRuntime, message: Memory): Promise<void> => {
      const content = message.content as Record<string, unknown> | undefined;
      const opts = content?.options as Record<string, unknown> | undefined;
      const counterparty = opts?.counterparty as string | undefined;
      if (!counterparty) return;
      try {
        const pubkey = new PublicKey(counterparty);
        const meets = await client.reputation.meetsRequirements(pubkey, {
          minTier: VerifTier.Unverified,
          minScore: 0,
        });
        if (!meets) {
          console.warn(
            `[Holdfast] Warning: counterparty ${counterparty} does not meet minimum reputation requirements.`,
          );
        }
      } catch {
        // Non-fatal — reputation check failure should not block action completion.
      }
      void runtime;
    },
  };
}
