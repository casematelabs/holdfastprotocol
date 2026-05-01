import type { Plugin, IAgentRuntime } from "@elizaos/core";
import { createHoldfastClient, PREAUDIT_WARNING } from "@holdfastprotocol/sdk";
import { PublicKey } from "@solana/web3.js";

import type { HoldfastPluginConfig } from "./types.js";
import { HoldfastPluginConfigSchema } from "./types.js";
import { makeCheckReputationAction } from "./actions/checkReputation.js";
import { makeCreatePactAction } from "./actions/createPact.js";
import { makeDepositEscrowAction } from "./actions/depositEscrow.js";
import { makeReleasePactAction } from "./actions/releasePact.js";
import { makeOpenDisputeAction } from "./actions/openDispute.js";
import { makeReputationProvider } from "./providers/reputationProvider.js";
import { makeActivePactsProvider } from "./providers/activePactsProvider.js";
import { makeReputationThresholdEvaluator } from "./evaluators/reputationThreshold.js";
import { EscrowEventListenerService } from "./services/escrowEventListener.js";

export type { HoldfastPluginConfig } from "./types.js";

/**
 * Create a Holdfast Protocol plugin instance bound to the given config.
 * This is the canonical entry point — ElizaOS actions need the client at
 * plugin-definition time, so a factory is required rather than a singleton.
 */
export function createHoldfastPlugin(config: HoldfastPluginConfig): Plugin {
  const parsed = HoldfastPluginConfigSchema.parse(config);

  const client = createHoldfastClient({
    rpcUrl: parsed.rpcUrl,
    indexerUrl: parsed.indexerUrl,
    signer: parsed.signer,
    agentWallet: parsed.agentWallet ? new PublicKey(parsed.agentWallet) : undefined,
    escrowProgramId: parsed.escrowProgramId ? new PublicKey(parsed.escrowProgramId) : undefined,
    holdfastProgramId: parsed.holdfastProgramId ? new PublicKey(parsed.holdfastProgramId) : undefined,
  });

  return {
    name: "holdfast-protocol",
    description:
      "Holdfast Protocol reputation and escrow for ElizaOS agents. " +
      "Adds CHECK_REPUTATION, CREATE_PACT, DEPOSIT_ESCROW, RELEASE_PACT, and OPEN_DISPUTE actions. " +
      "Injects reputation context and active pacts into the agent context window.",
    init: async (_pluginConfig: Record<string, unknown>, runtime: IAgentRuntime) => {
      console.warn(PREAUDIT_WARNING);
      const listener = new EscrowEventListenerService(client, runtime, parsed.agentWallet);
      await listener.start();
    },
    actions: [
      makeCheckReputationAction(client),
      makeCreatePactAction(client),
      makeDepositEscrowAction(client),
      makeReleasePactAction(client),
      makeOpenDisputeAction(client),
    ],
    providers: [
      makeReputationProvider(client, parsed.agentWallet),
      makeActivePactsProvider(client, parsed.agentWallet),
    ],
    evaluators: [makeReputationThresholdEvaluator(client)],
  };
}
