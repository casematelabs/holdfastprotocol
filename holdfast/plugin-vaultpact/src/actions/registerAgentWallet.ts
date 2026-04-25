import type { Action, IAgentRuntime, Memory, State } from "../types.js";

export const REGISTER_AGENT_WALLET: Action = {
  name: "REGISTER_AGENT_WALLET",
  similes: ["REGISTER_WALLET", "REGISTER_AGENT_KEY", "REGISTER_SECP256R1_KEY"],
  description:
    "Registers the agent's secp256r1 public key on the Holdfast Protocol on-chain " +
    "agent registry. Must be called once before the agent can participate in pacts.",
  examples: [],
  validate: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
  ): Promise<boolean> => {
    return true;
  },
  handler: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
  ): Promise<boolean> => {
    throw new Error("not implemented");
  },
};
