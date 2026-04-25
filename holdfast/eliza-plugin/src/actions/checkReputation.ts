import type { Action, IAgentRuntime, Memory, State, HandlerCallback } from "@elizaos/core";
import type { HoldfastClient } from "@holdfastprotocol/sdk";
import { PublicKey } from "@solana/web3.js";

export function makeCheckReputationAction(client: HoldfastClient): Action {
  return {
    name: "CHECK_REPUTATION",
    description:
      "Look up a Holdfast Protocol reputation account for a given Solana public key. " +
      "Returns VerifTier, score, and whether a set of requirements is met.",
    similes: ["LOOKUP_REPUTATION", "GET_AGENT_SCORE", "VERIFY_AGENT"],
    examples: [
      [
        {
          name: "user",
          content: { text: "What is the reputation of Gm1...xYz?" },
        },
        {
          name: "agent",
          content: {
            text: "Checking reputation on Holdfast Protocol…",
            action: "CHECK_REPUTATION",
          },
        },
      ],
    ],
    validate: async (_runtime: IAgentRuntime, message: Memory) => {
      const text = (message.content?.text ?? "") as string;
      return /[1-9A-HJ-NP-Za-km-z]{32,44}/.test(text);
    },
    handler: async (
      _runtime: IAgentRuntime,
      message: Memory,
      _state?: State,
      _options?: Record<string, unknown>,
      callback?: HandlerCallback,
    ): Promise<void> => {
      const text = (message.content?.text ?? "") as string;
      const match = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
      if (!match) {
        await callback?.({ text: "No valid public key found in message." });
        return;
      }
      try {
        const pubkey = new PublicKey(match[0]);
        const rep = await client.reputation.get(pubkey);
        const response =
          `Reputation for ${pubkey.toBase58()}:\n` +
          `  Tier: ${rep.tier}\n` +
          `  Score: ${rep.score}\n` +
          `  Pacts completed: ${rep.totalPacts}\n` +
          `  Pacts disputed: ${rep.disputeCount}`;
        await callback?.({ text: response });
      } catch (err) {
        await callback?.({ text: `Failed to fetch reputation: ${(err as Error).message}` });
      }
    },
  };
}
