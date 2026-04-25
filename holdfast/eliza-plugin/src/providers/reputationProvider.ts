import type { Provider, IAgentRuntime, Memory, State, ProviderResult } from "@elizaos/core";
import type { HoldfastClient } from "@holdfastprotocol/sdk";
import { PublicKey } from "@solana/web3.js";

export function makeReputationProvider(
  client: HoldfastClient,
  agentWalletBase58?: string,
): Provider {
  return {
    name: "holdfast-protocol-reputation",
    description: "Injects the agent's Holdfast Protocol reputation score and tier into the context window.",
    get: async (_runtime: IAgentRuntime, _message: Memory, _state: State): Promise<ProviderResult> => {
      if (!agentWalletBase58) return {};
      try {
        const pubkey = new PublicKey(agentWalletBase58);
        const rep = await client.reputation.get(pubkey);
        return {
          text:
            `[Holdfast Protocol Reputation]\n` +
            `Tier: ${rep.tier} | Score: ${rep.score} | ` +
            `Completed: ${rep.totalPacts} | Disputed: ${rep.disputeCount}`,
        };
      } catch {
        return {};
      }
    },
  };
}
