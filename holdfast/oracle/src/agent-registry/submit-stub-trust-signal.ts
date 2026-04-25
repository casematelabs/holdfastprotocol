// One-shot devnet script: submit a stub trust signal to ATOM Engine via the bridge program.
//
// Usage:
//   ORACLE_KEYPAIR_PATH=~/.config/solana/oracle-devnet.json \
//   node --loader ts-node/esm src/agent-registry/submit-stub-trust-signal.ts
//
// The script uses the known devnet test accounts from the initial ATOM Engine
// publisher deployment (CAS-60). A new set of accounts can be supplied via env vars.

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { AtomEngineSubmitter, type TrustSignalTarget } from "./atom-engine-submitter.js";

// ── program IDs ──────────────────────────────────────────────────────────────
const ATOM_ENGINE_PROGRAM_ID = new PublicKey(
  "AToMufS4QD6hEXvcvBDg9m1AHeCLpmZQsyfYa5h9MwAF",
);

// Bridge program that wraps publish_legit_score via CPI and is registered as an
// authorized source_program in ATOM Engine's creator_policy.
const BRIDGE_PROGRAM_ID = new PublicKey(
  process.env["ATOM_BRIDGE_PROGRAM_ID"] ??
    "5dDk9suKgyS9QqbgRf3Fet6v3sa37VsACsVaJFBgZg92",
);

// Bridge config PDA (owner: BRIDGE_PROGRAM_ID) — the 9-byte Anchor state account
// that acts as the CPI authority marker ATOM Engine validates.
const BRIDGE_CONFIG_PUBKEY = new PublicKey(
  process.env["ATOM_BRIDGE_CONFIG"] ??
    "GFk2wGMVakcS3AwM6P8orW33zcY1n2xBjtjJEcbR49zn",
);

// ── test agent accounts (devnet) ─────────────────────────────────────────────
// These are the existing atom_legit_snapshot and atom_stats accounts for the
// first test agent on devnet.  Supply ATOM_LEGIT_SNAPSHOT and ATOM_STATS_PUBKEY
// env vars to target a different agent.
const DEVNET_TEST_TARGET: TrustSignalTarget = {
  atomLegitSnapshotPubkey: new PublicKey(
    process.env["ATOM_LEGIT_SNAPSHOT"] ??
      "CoqRXe2K5X52SCHfzFpbNwS1bhFZ2KyyQBnvcyxZP1d5",
  ),
  atomStatsPubkey: new PublicKey(
    process.env["ATOM_STATS_PUBKEY"] ??
      "KMqMvMkw2S6rKQMBKbQYvGFFigYwQp4aCQWJzDVCScg",
  ),
};

// ── keypair ──────────────────────────────────────────────────────────────────
function loadKeypair(): Keypair {
  const inlineJson = process.env["ORACLE_KEYPAIR_JSON"];
  if (inlineJson) {
    return Keypair.fromSecretKey(new Uint8Array(JSON.parse(inlineJson) as number[]));
  }
  const raw = process.env["ORACLE_KEYPAIR_PATH"] ?? "~/.config/solana/oracle-devnet.json";
  const expanded = raw.startsWith("~") ? raw.replace("~", homedir()) : raw;
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(readFileSync(expanded, "utf8")) as number[]));
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const rpcUrl = process.env["SOLANA_RPC_URL"] ?? "https://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");
  const keypair = loadKeypair();

  console.log("[stub-signal] ATOM Engine trust signal prototype (CAS-60)");
  console.log(`[stub-signal] Oracle pubkey:   ${keypair.publicKey.toBase58()}`);
  console.log(`[stub-signal] Bridge program:  ${BRIDGE_PROGRAM_ID.toBase58()}`);
  console.log(`[stub-signal] ATOM Engine:     ${ATOM_ENGINE_PROGRAM_ID.toBase58()}`);
  console.log(`[stub-signal] Snapshot target: ${DEVNET_TEST_TARGET.atomLegitSnapshotPubkey.toBase58()}`);

  const submitter = new AtomEngineSubmitter(
    connection,
    BRIDGE_PROGRAM_ID,
    ATOM_ENGINE_PROGRAM_ID,
    BRIDGE_CONFIG_PUBKEY,
    keypair,
  );

  const signal = submitter.buildStubSignal();
  console.log(
    `[stub-signal] Submitting stub signal: ` +
    `scoreBps=${signal.scoreBps} confidenceBps=${signal.confidenceBps} ` +
    `metricCount=${signal.metricCount} seq=${signal.sequence}`,
  );

  let sig: string;
  try {
    sig = await submitter.submitTrustSignal(DEVNET_TEST_TARGET, signal);
  } catch (err) {
    console.error("[stub-signal] Submission failed:", err);
    process.exit(1);
  }

  // Confirm on-chain state: read the snapshot account post-submission.
  const snapshotInfo = await connection.getAccountInfo(
    DEVNET_TEST_TARGET.atomLegitSnapshotPubkey,
    "confirmed",
  );
  if (snapshotInfo === null) {
    console.error("[stub-signal] atom_legit_snapshot account not found after submission");
    process.exit(1);
  }

  console.log(
    `[stub-signal] On-chain confirmation OK: ` +
    `sig=${sig} ` +
    `snapshot_size=${snapshotInfo.data.length}B ` +
    `snapshot_head=${snapshotInfo.data.subarray(0, 16).toString("hex")}`,
  );
}

main().catch((err: unknown) => {
  console.error("[stub-signal] Fatal:", err);
  process.exit(1);
});
