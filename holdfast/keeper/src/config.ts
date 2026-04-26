import * as os from "os";
import { PublicKey } from "@solana/web3.js";

export interface KeeperConfig {
  rpcUrl: string;
  keypairPath: string;
  pollIntervalMs: number;
  lookaheadSecs: number;
  maxCandidatesPerPoll: number;
  dryRun: boolean;
  escrowProgramId?: PublicKey;
  holdfastProgramId?: PublicKey;
  keeperPublicUrl?: string;
}

function expandHome(pathValue: string): string {
  return pathValue.replace(/^~(?=$|[\\/])/, os.homedir());
}

function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer. Received: ${raw}`);
  }
  return parsed;
}

function optionalPubkeyFromEnv(name: string): PublicKey | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  return new PublicKey(raw);
}

function boolFromEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") return true;
  if (normalized === "0" || normalized === "false" || normalized === "no") return false;
  throw new Error(`${name} must be one of: true/false/1/0/yes/no. Received: ${raw}`);
}

export function loadConfig(): KeeperConfig {
  const rpcUrl = process.env["HOLDFAST_RPC_URL"] ?? "https://api.devnet.solana.com";
  const keypairPath = expandHome(
    process.env["KEEPER_KEYPAIR_PATH"] ?? "~/.config/solana/devnet.json",
  );
  const pollIntervalSecs = positiveIntFromEnv("KEEPER_POLL_INTERVAL_SECONDS", 30);
  const lookaheadSecs = positiveIntFromEnv("KEEPER_LOOKAHEAD_SECONDS", 120);
  const maxCandidatesPerPoll = Math.min(
    positiveIntFromEnv("KEEPER_MAX_CANDIDATES_PER_POLL", 100),
    500,
  );
  const dryRun = boolFromEnv("KEEPER_DRY_RUN", false);

  const keeperPublicUrl = process.env["KEEPER_PUBLIC_URL"];
  const escrowProgramId = optionalPubkeyFromEnv("HOLDFAST_ESCROW_PROGRAM_ID");
  const holdfastProgramId = optionalPubkeyFromEnv("HOLDFAST_PROGRAM_ID");

  return {
    rpcUrl,
    keypairPath,
    pollIntervalMs: pollIntervalSecs * 1000,
    lookaheadSecs,
    maxCandidatesPerPoll,
    dryRun,
    escrowProgramId,
    holdfastProgramId,
    keeperPublicUrl,
  };
}
