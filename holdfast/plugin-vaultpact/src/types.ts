/**
 * Minimal type shims mirroring @elizaos/core interfaces.
 * Replace with direct imports from @elizaos/core once the peer dep is installed.
 */

export type UUID = `${string}-${string}-${string}-${string}-${string}`;

export interface Content {
  text: string;
  [key: string]: unknown;
}

export interface Memory {
  id?: UUID;
  content: Content;
  userId: UUID;
  agentId: UUID;
  roomId: UUID;
}

export interface State {
  [key: string]: unknown;
}

export type HandlerCallback = (response: Content) => Promise<Memory[]>;

export interface IAgentRuntime {
  agentId: UUID;
  getSetting(key: string): string | undefined;
}

export type ActionExample = Array<{ user: string; content: Content }>;

export interface Action {
  name: string;
  similes: string[];
  description: string;
  validate(
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
  ): Promise<boolean>;
  handler(
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<boolean>;
  examples: ActionExample[][];
}

export interface Provider {
  get(
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
  ): Promise<string | null>;
}

export interface Plugin {
  name: string;
  description: string;
  actions: Action[];
  providers: Provider[];
}
