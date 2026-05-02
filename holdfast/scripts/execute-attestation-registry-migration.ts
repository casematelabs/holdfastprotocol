/**
 * Devnet execution script: migrate_attestation_registry (HOL-249).
 *
 * Reallocates the AttestationRegistry from 49 to 81 bytes on devnet,
 * inserting the oracle_authority field introduced in HOL-182.
 *
 * Pre-requisites:
 *   - Updated vaultpact program deployed to devnet (with migrate_attestation_registry)
 *   - keys/devnet-protocol-authority.json — INITIAL_AUTHORITY signer
 *
 * What this does:
 *   1. Probes pre-migration state and logs it
 *   2. Calls migrate_attestation_registry as INITIAL_AUTHORITY
 *   3. Verifies post-migration state (81 bytes, fields preserved, oracle_authority set)
 *   4. Attempts a second call to verify double-migration protection (AlreadyMigrated)
 *
 * Usage:
 *   npx ts-node scripts/execute-attestation-registry-migration.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorError } from "@coral-xyz/anchor";
import { Keypair, Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

import idl from "../target/idl/vaultpact.json";

const DEFAULT_PROGRAM_ID = "2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq";
const PROGRAM_ID = new PublicKey(process.env.HOLDFAST_PROGRAM_ID ?? DEFAULT_PROGRAM_ID);
const DEVNET_RPC = process.env.HOLDFAST_RPC_URL ?? "https://api.devnet.solana.com";
const EXPECTED_ORACLE = "3Kj7GpYVoARqCT1bfBmCC5NZhw37ahEiyxsJW9zcTSiy";

const [REGISTRY_PDA] = PublicKey.findProgramAddressSync(
  [Buffer.from("attestation_registry")],
  PROGRAM_ID,
);

function parseRegistryRaw(data: Buffer): {
  size: number;
  authority: string;
  agentCount: bigint;
  oracleAuthority: string | null;
  bump: number;
} {
  const size = data.length;
  const authority = new PublicKey(data.subarray(8, 40)).toBase58();
  const agentCount = data.readBigUInt64LE(40);
  if (size === 49) {
    return { size, authority, agentCount, oracleAuthority: null, bump: data[48] };
  }
  if (size === 81) {
    const oracleAuthority = new PublicKey(data.subarray(48, 80)).toBase58();
    return { size, authority, agentCount, oracleAuthority, bump: data[80] };
  }
  throw new Error(`Unexpected registry size: ${size}`);
}

async function getRegistryState(connection: Connection) {
  const info = await connection.getAccountInfo(REGISTRY_PDA, "confirmed");
  if (!info) throw new Error("AttestationRegistry account not found on devnet");
  return parseRegistryRaw(Buffer.from(info.data));
}

async function main() {
  const defaultKeyPath = path.join(__dirname, "..", "keys", "devnet-protocol-authority.json");
  const configuredAuthority = process.env.HOLDFAST_AUTHORITY_KEYPAIR?.trim() ?? "";
  const authorityPath = configuredAuthority.length > 0
    ? (path.isAbsolute(configuredAuthority) ? configuredAuthority : path.resolve(process.cwd(), configuredAuthority))
    : defaultKeyPath;
  if (!fs.existsSync(authorityPath)) {
    throw new Error(
      `authority keypair not found at ${authorityPath}. ` +
      `Set HOLDFAST_AUTHORITY_KEYPAIR to a valid keypair file path.`,
    );
  }
  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(authorityPath, "utf8"))),
  );
  const configuredFeePayer = process.env.HOLDFAST_FEE_PAYER_KEYPAIR?.trim() ?? "";
  const feePayerPath = configuredFeePayer.length > 0
    ? (path.isAbsolute(configuredFeePayer) ? configuredFeePayer : path.resolve(process.cwd(), configuredFeePayer))
    : authorityPath;
  if (!fs.existsSync(feePayerPath)) {
    throw new Error(
      `fee-payer keypair not found at ${feePayerPath}. ` +
      `Set HOLDFAST_FEE_PAYER_KEYPAIR to a valid keypair file path.`,
    );
  }
  const feePayer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(feePayerPath, "utf8"))),
  );

  console.log("Authority key file:", authorityPath);
  console.log("Authority pubkey:", authority.publicKey.toBase58());
  console.log("Fee payer key file:", feePayerPath);
  console.log("Fee payer pubkey:", feePayer.publicKey.toBase58());

  const connection = new Connection(DEVNET_RPC, "confirmed");
  const wallet = new anchor.Wallet(feePayer);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });

  // Ensure Program runtime ID matches the target deployment under test.
  // The generated IDL may carry a different `address` field.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runtimeIdl = { ...(idl as any), address: PROGRAM_ID.toBase58() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const program = new Program(runtimeIdl as any, provider);

  // ── Step 1: Pre-migration snapshot ────────────────────────────────────────────
  console.log("\n=== Pre-migration state ===");
  const pre = await getRegistryState(connection);
  console.log("PDA:          ", REGISTRY_PDA.toBase58());
  console.log("Size (bytes): ", pre.size);
  console.log("authority:    ", pre.authority);
  console.log("agent_count:  ", pre.agentCount.toString());
  console.log("oracle_auth:  ", pre.oracleAuthority ?? "(not present)");
  console.log("bump:         ", pre.bump);

  if (pre.size === 81) {
    console.log("\n⚠️  Account already at 81 bytes — migration already applied.");
    return;
  }

  if (pre.size !== 49) {
    throw new Error(`Unexpected pre-migration size: ${pre.size}. Aborting.`);
  }

  // ── Step 2: Execute migration ──────────────────────────────────────────────
  console.log("\n=== Executing migrate_attestation_registry ===");
  const tx = await (program.methods as any)
    .migrateAttestationRegistry()
    .accounts({
      attestationRegistry: REGISTRY_PDA,
      authority: authority.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([authority])
    .rpc({ commitment: "confirmed" });

  console.log("Transaction signature:", tx);
  console.log(`Explorer: https://explorer.solana.com/tx/${tx}?cluster=devnet`);

  // ── Step 3: Post-migration verification ────────────────────────────────────
  console.log("\n=== Post-migration state ===");
  const post = await getRegistryState(connection);
  console.log("Size (bytes):  ", post.size);
  console.log("authority:     ", post.authority);
  console.log("agent_count:   ", post.agentCount.toString());
  console.log("oracle_auth:   ", post.oracleAuthority);
  console.log("bump:          ", post.bump);

  const errors: string[] = [];
  if (post.size !== 81) errors.push(`Expected size 81, got ${post.size}`);
  if (post.authority !== pre.authority) errors.push(`authority changed: ${pre.authority} → ${post.authority}`);
  if (post.agentCount !== pre.agentCount) errors.push(`agent_count changed: ${pre.agentCount} → ${post.agentCount}`);
  if (post.oracleAuthority !== EXPECTED_ORACLE) errors.push(`oracle_authority: expected ${EXPECTED_ORACLE}, got ${post.oracleAuthority}`);
  if (post.bump !== pre.bump) errors.push(`bump changed: ${pre.bump} → ${post.bump}`);

  if (errors.length > 0) {
    console.error("\n❌ Post-migration verification FAILED:");
    errors.forEach((e) => console.error("  -", e));
    process.exit(1);
  }
  console.log("\n✅ Post-migration verification passed.");

  // ── Step 4: Double-migration protection ────────────────────────────────────
  console.log("\n=== Verifying double-migration protection ===");
  try {
    await (program.methods as any)
      .migrateAttestationRegistry()
      .accounts({
        attestationRegistry: REGISTRY_PDA,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc({ commitment: "confirmed" });

    console.error("❌ Second migration call did NOT revert — double-migration protection MISSING");
    process.exit(1);
  } catch (err) {
    const anchorErr = err as AnchorError;
    if (
      anchorErr?.error?.errorCode?.code === "AlreadyMigrated" ||
      String(err).includes("AlreadyMigrated") ||
      String(err).includes("0x1784") // error offset
    ) {
      console.log("✅ Double-migration correctly rejected with AlreadyMigrated.");
    } else {
      console.error("❌ Second migration failed with unexpected error:", err);
      process.exit(1);
    }
  }

  console.log("\n=== Migration complete ===");
  console.log("Registry PDA:      ", REGISTRY_PDA.toBase58());
  console.log("New size:          81 bytes");
  console.log("oracle_authority:  ", post.oracleAuthority);
  console.log("All invariants verified. Safe to proceed with mainnet planning (HOL-250).");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
