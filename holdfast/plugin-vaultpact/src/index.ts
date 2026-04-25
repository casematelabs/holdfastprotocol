import type { Plugin } from "./types.js";
import { REGISTER_AGENT_WALLET } from "./actions/registerAgentWallet.js";
import { INITIATE_PACT } from "./actions/initiatePact.js";
import { RELEASE_PACT } from "./actions/releasePact.js";
import { REPUTATION_SCORE } from "./providers/reputationScore.js";
import { PACT_STATUS } from "./providers/pactStatus.js";

export const holdfastPlugin: Plugin = {
  name: "holdfast-protocol",
  description:
    "Holdfast Protocol plugin — on-chain agent registration, escrow pact lifecycle, " +
    "and reputation/pact-status context providers for ElizaOS agents on Solana.",
  actions: [REGISTER_AGENT_WALLET, INITIATE_PACT, RELEASE_PACT],
  providers: [REPUTATION_SCORE, PACT_STATUS],
};

export { REGISTER_AGENT_WALLET, INITIATE_PACT, RELEASE_PACT };
export { REPUTATION_SCORE, PACT_STATUS };
export type { Plugin, Action, Provider, IAgentRuntime, Memory, State } from "./types.js";
