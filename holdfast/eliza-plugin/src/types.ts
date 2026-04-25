import { z } from "zod";
import type { Signer } from "@solana/web3.js";

const base58PubkeyPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const HoldfastPluginConfigSchema = z.object({
  rpcUrl: z.string().url("rpcUrl must be a valid URL (e.g. https://api.devnet.solana.com)").optional(),
  indexerUrl: z.string().url("indexerUrl must be a valid URL").optional(),
  signer: z.custom<Signer>().optional(),
  agentWallet: z
    .string()
    .regex(base58PubkeyPattern, "agentWallet must be a valid base58-encoded Solana public key")
    .optional(),
});

export type HoldfastPluginConfig = z.infer<typeof HoldfastPluginConfigSchema>;
