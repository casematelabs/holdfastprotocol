import type { Action, IAgentRuntime, Memory, State } from "../types.js";

export const INITIATE_PACT: Action = {
  name: "INITIATE_PACT",
  similes: ["CREATE_PACT", "START_ESCROW", "OPEN_PACT", "CREATE_HOLDFAST"],
  description:
    "Creates a new Holdfast Protocol escrow on-chain. The agent becomes the pact initiator " +
    "and funds are locked until the pact is released or escalated to dispute.",
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
