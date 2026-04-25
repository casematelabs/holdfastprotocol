import type { Provider, IAgentRuntime, Memory, State } from "../types.js";

/**
 * Injects the agent's on-chain Holdfast Protocol reputation summary into the context window.
 * Queries via @holdfastprotocol/sdk — requires HOLDFAST_RPC_URL in env.
 */
export const REPUTATION_SCORE: Provider = {
  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
  ): Promise<string | null> => {
    throw new Error("not implemented");
  },
};
