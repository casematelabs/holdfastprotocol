import type { Provider, IAgentRuntime, Memory, State, ProviderResult } from "@elizaos/core";
import type { HoldfastClient } from "@holdfastprotocol/sdk";
import { PublicKey } from "@solana/web3.js";
import { EscrowStatus } from "@holdfastprotocol/sdk";

const MAX_CONTEXT_TOKENS = 800;
const APPROX_CHARS_PER_TOKEN = 4;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN);
}

export function makeActivePactsProvider(
  client: HoldfastClient,
  agentWalletBase58?: string,
): Provider {
  return {
    name: "holdfast-protocol-active-pacts",
    description: "Injects a summary of the agent's open Holdfast Protocol pacts into the context window.",
    get: async (_runtime: IAgentRuntime, _message: Memory, _state: State): Promise<ProviderResult> => {
      if (!agentWalletBase58) return {};
      try {
        const pubkey = new PublicKey(agentWalletBase58);
        const page = await client.escrow.listPacts(pubkey, { status: EscrowStatus.Funded });
        if (page.pacts.length === 0) return { text: "[Holdfast] No active pacts." };

        const header = "[Holdfast Protocol Active Pacts]\n";
        const allLines = page.pacts.map(
          (p) => `  ${p.escrowId}: ${p.status} — beneficiary ${p.beneficiary}`,
        );

        const includedLines: string[] = [];
        let usedTokens = estimateTokens(header);
        for (const line of allLines) {
          const lineTokens = estimateTokens(line + "\n");
          if (usedTokens + lineTokens > MAX_CONTEXT_TOKENS) break;
          includedLines.push(line);
          usedTokens += lineTokens;
        }

        const omitted = allLines.length - includedLines.length;
        const suffix = omitted > 0 ? `\n  … and ${omitted} more pact(s) omitted to fit context window.` : "";
        return { text: `${header}${includedLines.join("\n")}${suffix}` };
      } catch {
        return {};
      }
    },
  };
}
