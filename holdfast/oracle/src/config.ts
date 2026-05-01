import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { TrustSignalTarget } from "./agent-registry/atom-engine-submitter.js";
import type { Idl } from "./idl-offset.js";

export interface OracleConfig {
  // Parsed vaultpact program IDL — used to compute account field offsets.
  vaultpactIdl: Idl;
  connection: Connection;
  // The deployed Holdfast program (placeholder until CAS-19 deploys).
  holdfastProgramId: PublicKey;
  // The Holdfast escrow program whose logs contain dispute events.
  // Placeholder until the escrow program is deployed to devnet.
  escrowProgramId: PublicKey;
  // Solana Agent Registry program. null until CAS-45 confirms the devnet address.
  agentRegistryProgramId: PublicKey | null;
  // ATOM Engine program (devnet): accepts validator trust signals via publish_legit_score.
  atomEngineProgramId: PublicKey;
  // Bridge program that wraps ATOM Engine's publish_legit_score via authorized CPI.
  atomBridgeProgramId: PublicKey;
  // Bridge config PDA (owned by atomBridgeProgramId): the CPI authority marker.
  atomBridgeConfigPubkey: PublicKey;
  // Keypair whose pubkey matches REPUTATION_ORACLE_AUTHORITY in programs/vaultpact/src/lib.rs.
  oracleKeypair: Keypair;
  // How long the oracle waits before logging a missed-vote warning (default 72h per CAS-11 §3.4).
  voteTimeoutSeconds: number;
  // Target accounts for periodic ATOM Engine trust signal emission. null disables the loop.
  atomTrustSignalTarget: TrustSignalTarget | null;
  // Interval in ms between trust signal submissions (default 30s).
  atomSignalIntervalMs: number;
}

export function loadConfig(): OracleConfig {
  const rpcUrl = process.env["SOLANA_RPC_URL"] ?? "https://api.devnet.solana.com";

  const holdfastProgramId = new PublicKey(
    process.env["HOLDFAST_PROGRAM_ID"] ??
      // From Anchor.toml [programs.devnet] / declare_id! in programs/vaultpact/src/lib.rs.
      "D6mUa4wGtFyLyJorMfxoKvA9ybohjUSsfw88t66ATxg",
  );

  const escrowProgramId = new PublicKey(
    process.env["ESCROW_PROGRAM_ID"] ??
      // Devnet escrow program ID pre-generated 2026-04-19 (CAS-33).
      // Keypair at ~/.config/solana/escrow-program-devnet.json.
      // VAULTPACT_ESCROW_AUTHORITY PDA is derived from this program ID:
      //   find_program_address([b"vp_escrow_authority"], escrowProgramId) => DLzsM2CA7mhp2KQcQfkzsbL6r55H8TEZJgL223xfXxA2
      "CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi",
  );

  // null until CAS-45 confirms the devnet address. Set AGENT_REGISTRY_PROGRAM_ID env var to enable.
  const agentRegistryProgramId: PublicKey | null = process.env["AGENT_REGISTRY_PROGRAM_ID"]
    ? new PublicKey(process.env["AGENT_REGISTRY_PROGRAM_ID"])
    : null;

  // ATOM Engine (devnet) — live, accepts trust signals via publish_legit_score (CAS-60).
  const atomEngineProgramId = new PublicKey(
    process.env["ATOM_ENGINE_PROGRAM_ID"] ??
      "AToMufS4QD6hEXvcvBDg9m1AHeCLpmZQsyfYa5h9MwAF",
  );

  // Bridge program authorized in ATOM Engine's creator_policy (CAS-60).
  const atomBridgeProgramId = new PublicKey(
    process.env["ATOM_BRIDGE_PROGRAM_ID"] ??
      "5dDk9suKgyS9QqbgRf3Fet6v3sa37VsACsVaJFBgZg92",
  );

  // Bridge config PDA (9-byte Anchor account, owner = atomBridgeProgramId).
  const atomBridgeConfigPubkey = new PublicKey(
    process.env["ATOM_BRIDGE_CONFIG"] ??
      "GFk2wGMVakcS3AwM6P8orW33zcY1n2xBjtjJEcbR49zn",
  );

  const vaultpactIdl = loadIdl();
  const oracleKeypair = loadKeypair();

  const voteTimeoutSeconds =
    parseInt(process.env["VOTE_TIMEOUT_HOURS"] ?? "72", 10) * 3600;

  // Set ATOM_LEGIT_SNAPSHOT + ATOM_STATS_PUBKEY to enable periodic trust signal emission.
  // Defaults to the devnet test accounts verified in CAS-60.
  const atomLegitSnapshotEnv = process.env["ATOM_LEGIT_SNAPSHOT"];
  const atomStatsPubkeyEnv   = process.env["ATOM_STATS_PUBKEY"];
  const atomTrustSignalTarget: TrustSignalTarget | null =
    atomLegitSnapshotEnv && atomStatsPubkeyEnv
      ? {
          atomLegitSnapshotPubkey: new PublicKey(atomLegitSnapshotEnv),
          atomStatsPubkey:         new PublicKey(atomStatsPubkeyEnv),
        }
      : {
          atomLegitSnapshotPubkey: new PublicKey("CoqRXe2K5X52SCHfzFpbNwS1bhFZ2KyyQBnvcyxZP1d5"),
          atomStatsPubkey:         new PublicKey("KMqMvMkw2S6rKQMBKbQYvGFFigYwQp4aCQWJzDVCScg"),
        };

  const atomSignalIntervalMs =
    parseInt(process.env["ATOM_SIGNAL_INTERVAL_SECONDS"] ?? "30", 10) * 1000;

  return {
    vaultpactIdl,
    connection: new Connection(rpcUrl, "confirmed"),
    holdfastProgramId,
    escrowProgramId,
    agentRegistryProgramId,
    atomEngineProgramId,
    atomBridgeProgramId,
    atomBridgeConfigPubkey,
    oracleKeypair,
    voteTimeoutSeconds,
    atomTrustSignalTarget,
    atomSignalIntervalMs,
  };
}

// Default IDL path: holdfast/target/idl/vaultpact.json, relative to this compiled file.
// Override with VAULTPACT_IDL_PATH for non-standard layouts.
function loadIdl(): Idl {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const idlPath =
    process.env["VAULTPACT_IDL_PATH"] ??
    resolve(__dirname, "../../target/idl/vaultpact.json");
  try {
    return JSON.parse(readFileSync(idlPath, "utf8")) as Idl;
  } catch (err) {
    throw new Error(
      `Failed to load vaultpact IDL from "${idlPath}": ${(err as Error).message}. ` +
      `Run "anchor build" or set VAULTPACT_IDL_PATH.`,
    );
  }
}

/**
 * Parse and validate a Solana keypair byte array from a JSON string.
 * Exported for testing. Source is used only in error messages.
 *
 * SECURITY: ORACLE_KEYPAIR_JSON holds a raw 64-byte secret key.
 * Do not log the env var value or the JSON string in production.
 * Restrict file permissions on keypair files (chmod 600).
 */
export function parseKeypairBytes(json: string, source: string): number[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`Oracle keypair at "${source}" contains invalid JSON`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Oracle keypair at "${source}" must be a JSON array of 64 bytes`);
  }
  if (parsed.length !== 64) {
    throw new Error(`Oracle keypair at "${source}" must be 64 bytes, got ${parsed.length}`);
  }
  for (let i = 0; i < parsed.length; i++) {
    const b = parsed[i] as unknown;
    if (typeof b !== "number" || !Number.isInteger(b) || b < 0 || b > 255) {
      throw new Error(
        `Oracle keypair at "${source}" has invalid byte at index ${i}: ${JSON.stringify(b)}`,
      );
    }
  }
  return parsed as number[];
}

function loadKeypair(): Keypair {
  const inlineJson = process.env["ORACLE_KEYPAIR_JSON"];
  if (inlineJson) {
    return Keypair.fromSecretKey(
      new Uint8Array(parseKeypairBytes(inlineJson, "ORACLE_KEYPAIR_JSON")),
    );
  }

  const rawPath = process.env["ORACLE_KEYPAIR_PATH"] ?? "~/.config/solana/oracle-devnet.json";
  const expanded = rawPath.startsWith("~") ? rawPath.replace("~", homedir()) : rawPath;

  let fileContent: string;
  try {
    fileContent = readFileSync(expanded, "utf8");
  } catch (err) {
    throw new Error(
      `Oracle keypair file not readable at "${expanded}": ${(err as Error).message}`,
    );
  }

  return Keypair.fromSecretKey(new Uint8Array(parseKeypairBytes(fileContent, expanded)));
}
