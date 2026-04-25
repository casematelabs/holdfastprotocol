import type { Provider, IAgentRuntime, Memory, State } from "../types.js";

/**
 * Injects the current status of an escrow account into the context window.
 * Reads the PDA directly via RPC so the agent can reason about active pacts.
 * Requires HOLDFAST_RPC_URL in env.
 */
export const PACT_STATUS: Provider = {
  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
  ): Promise<string | null> => {
    throw new Error("not implemented");
  },
};
