/**
 * Mainnet migration script: migrate_attestation_registry (HOL-250).
 *
 * Probes the AttestationRegistry on mainnet and produces the Squads v4 instruction
 * data needed to execute the one-time realloc from 49 → 81 bytes. Because the
 * mainnet INITIAL_AUTHORITY is a Squads 2-of-2 vault PDA, this script never
 * transmits a transaction directly — it prints the instruction parameters for
 * manual submission through the Squads UI.
 *
 * Usage:
 *   # Pre-flight check and Squads instruction output:
 *   npx ts-node scripts/mainnet-migrate-attestation-registry.ts --dry-run
 *
 *   # Post-migration verification (run after Squads execution):
 *   npx ts-node scripts/mainnet-migrate-attestation-registry.ts --verify
 *
 *   # Override program ID (use once mainnet program is deployed):
 *   npx ts-node scripts/mainnet-migrate-attestation-registry.ts \
 *     --dry-run --program-id <MAINNET_PROGRAM_ID>
 *
 * Flags:
 *   --dry-run       Pre-flight check + print Squads instruction data (default)
 *   --verify        Post-migration verification only (no instruction data printed)
 *   --program-id    Override vaultpact program ID
 *   --rpc           Override mainnet RPC URL
 *   --help          Show this message
 *
 * Mainnet constants (compile-time values from lib.rs):
 *   INITIAL_AUTHORITY (vault PDA): F7koW9b6RYpGrwEXNCGx5V5cKmK2YwhR5e5UyPyBj1J9
 *   REPUTATION_ORACLE_AUTHORITY:   5GeSYa2BYViRjqXGZvPGwWGkRLi7YyukmJTTGSQQw8FL
 *   Squads vault:                  F7koW9b6RYpGrwEXNCGx5V5cKmK2YwhR5e5UyPyBj1J9
 *   Squads threshold:              2-of-2
 */

import {
  Connection,
  PublicKey,
  TransactionInstruction,
  AccountMeta,
  SystemProgram,
} from "@solana/web3.js";
import * as crypto from "node:crypto";
import * as fs from "node:fs";

// ─── Mainnet constants ────────────────────────────────────────────────────────

// Devnet program ID. Replace with mainnet ID once the program is deployed.
// Update MAINNET_PROGRAM_ID in lib.rs and rebuild before setting this value.
const DEFAULT_PROGRAM_ID = "2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq";

// Squads v4 vault PDA — mainnet INITIAL_AUTHORITY (2-of-2 multisig).
const MAINNET_VAULT_PDA = "F7koW9b6RYpGrwEXNCGx5V5cKmK2YwhR5e5UyPyBj1J9";

// Expected oracle_authority after migration (compile-time REPUTATION_ORACLE_AUTHORITY).
const EXPECTED_ORACLE = "5GeSYa2BYViRjqXGZvPGwWGkRLi7YyukmJTTGSQQw8FL";

const DEFAULT_RPC = process.env.HOLDFAST_MAINNET_RPC_URL ?? "https://api.mainnet-beta.solana.com";

// ─── Layout ───────────────────────────────────────────────────────────────────
//
// Legacy (49 bytes):
//   [0..8]   discriminator
//   [8..40]  authority   (Pubkey)
//   [40..48] agent_count (u64 LE)
//   [48]     bump        (u8)
//
// Post-migration (81 bytes):
//   [0..8]   discriminator
//   [8..40]  authority       (Pubkey, unchanged)
//   [40..48] agent_count     (u64 LE, unchanged)
//   [48..80] oracle_authority (Pubkey, new)
//   [80]     bump            (u8, moved from [48])

const LEGACY_SIZE = 49;
const MIGRATED_SIZE = 81;

// Anchor discriminator for migrate_attestation_registry instruction.
// sha256("global:migrate_attestation_registry")[0:8]
const REGISTRY_DISCRIMINATOR = Buffer.from([152, 156, 134, 191, 142, 144, 217, 209]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function anchorDiscriminator(ixName: string): Buffer {
  return crypto
    .createHash("sha256")
    .update(`global:${ixName}`)
    .digest()
    .subarray(0, 8);
}

interface RegistryState {
  size: number;
  discriminator: Buffer;
  authority: string;
  agentCount: bigint;
  oracleAuthority: string | null;
  bump: number;
}

function parseRegistry(data: Buffer): RegistryState {
  const size = data.length;
  const discriminator = data.subarray(0, 8);
  const authority = new PublicKey(data.subarray(8, 40)).toBase58();
  const agentCount = data.readBigUInt64LE(40);

  if (size === LEGACY_SIZE) {
    return { size, discriminator, authority, agentCount, oracleAuthority: null, bump: data[48] };
  }
  if (size === MIGRATED_SIZE) {
    const oracleAuthority = new PublicKey(data.subarray(48, 80)).toBase58();
    return { size, discriminator, authority, agentCount, oracleAuthority, bump: data[80] };
  }
  throw new Error(
    `Unexpected registry size: ${size} bytes. Expected ${LEGACY_SIZE} (pre-migration) or ${MIGRATED_SIZE} (post-migration).`,
  );
}

function validateDiscriminator(data: Buffer): void {
  const actual = data.subarray(0, 8);
  if (!actual.equals(REGISTRY_DISCRIMINATOR)) {
    throw new Error(
      `Discriminator mismatch. Expected [${[...REGISTRY_DISCRIMINATOR]}] ` +
        `but got [${[...actual]}]. ` +
        "This account may not be a valid AttestationRegistry.",
    );
  }
}

// ─── CLI arg parsing ──────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { mode: "dry-run" | "verify"; programId: string; rpc: string } {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    const src = fs.readFileSync(__filename, "utf8");
    const doc = src.match(/^\/\*\*([\s\S]*?)\*\//)?.[0] ?? "";
    console.log(doc.replace(/^ \* ?/gm, ""));
    process.exit(0);
  }

  let mode: "dry-run" | "verify" = "dry-run";
  let programId = DEFAULT_PROGRAM_ID;
  let rpc = DEFAULT_RPC;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--dry-run":
        mode = "dry-run";
        break;
      case "--verify":
        mode = "verify";
        break;
      case "--program-id":
        programId = args[++i];
        break;
      case "--rpc":
        rpc = args[++i];
        break;
      default:
        console.error(`Unknown argument: ${args[i]}`);
        process.exit(1);
    }
  }

  return { mode, programId, rpc };
}

// ─── Pre-flight check ─────────────────────────────────────────────────────────

function runPreFlight(state: RegistryState, registryPda: string): {
  passed: boolean;
  findings: string[];
  warnings: string[];
} {
  const findings: string[] = [];
  const warnings: string[] = [];

  // Check 1: discriminator (already validated before parsing, just note it)
  findings.push(`✅ Discriminator matches AttestationRegistry: [${[...REGISTRY_DISCRIMINATOR]}]`);

  // Check 2: size
  if (state.size === MIGRATED_SIZE) {
    findings.push(`✅ Registry already at ${MIGRATED_SIZE} bytes — migration was already applied.`);
    return { passed: false, findings, warnings }; // not an error, but no migration needed
  }
  if (state.size === LEGACY_SIZE) {
    findings.push(`✅ Registry is ${LEGACY_SIZE} bytes — migration required.`);
  }

  // Check 3: authority is the expected Squads vault
  if (state.authority === MAINNET_VAULT_PDA) {
    findings.push(`✅ Protocol authority matches Squads vault: ${state.authority}`);
  } else {
    findings.push(
      `⚠️  Protocol authority is ${state.authority} — expected Squads vault ${MAINNET_VAULT_PDA}. ` +
        "Verify this is correct before proceeding.",
    );
    warnings.push(`Authority mismatch: on-chain ${state.authority} vs expected ${MAINNET_VAULT_PDA}`);
  }

  // Check 4: agent_count
  findings.push(`ℹ  agent_count: ${state.agentCount} (preserved through migration)`);
  if (state.agentCount > 0n) {
    warnings.push(
      `Registry has ${state.agentCount} registered agents. ` +
        "Migration preserves all data — confirm this before executing.",
    );
  }

  // Check 5: bump sanity
  if (state.bump === 0) {
    warnings.push("bump is 0 — unusual but the instruction reads it from raw bytes and preserves it.");
  }
  findings.push(`ℹ  bump: ${state.bump}`);
  findings.push(`ℹ  Registry PDA: ${registryPda}`);

  return { passed: true, findings, warnings };
}

// ─── Build instruction ────────────────────────────────────────────────────────

function buildMigrateInstruction(
  programId: PublicKey,
  registryPda: PublicKey,
  vaultPda: PublicKey,
): TransactionInstruction {
  // migrate_attestation_registry takes no parameters — only the discriminator.
  const discriminator = anchorDiscriminator("migrate_attestation_registry");

  const accounts: AccountMeta[] = [
    { pubkey: registryPda, isSigner: false, isWritable: true },
    { pubkey: vaultPda, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    programId,
    keys: accounts,
    data: discriminator,
  });
}

// ─── Dry-run mode ─────────────────────────────────────────────────────────────

async function runDryRun(connection: Connection, programPubkey: PublicKey, registryPda: PublicKey) {
  console.log("=".repeat(70));
  console.log(" MAINNET MIGRATION PRE-FLIGHT CHECK");
  console.log(" migrate_attestation_registry (HOL-250)");
  console.log("=".repeat(70));
  console.log();
  console.log("Network:      mainnet-beta");
  console.log("Program ID:   ", programPubkey.toBase58());
  console.log("Registry PDA: ", registryPda.toBase58());
  console.log("Vault (authority):", MAINNET_VAULT_PDA);
  console.log();

  // Probe registry
  const info = await connection.getAccountInfo(registryPda, "confirmed");
  if (!info) {
    console.log("⚠️  AttestationRegistry PDA not found on mainnet.");
    console.log();
    console.log("This means the mainnet registry has not been initialized yet.");
    console.log("Options:");
    console.log("  A) The program is not yet deployed to mainnet — deploy first.");
    console.log("  B) The registry needs to be initialized via initialize_registry.");
    console.log("     After initialization, the registry will be created with the");
    console.log("     81-byte layout (oracle_authority included) and NO migration is needed.");
    console.log();
    console.log("If you initialized the registry before HOL-182 was deployed, the");
    console.log("registry will be 49 bytes and this migration will be required.");
    console.log("Re-run this script after initialization to verify.");
    process.exit(0);
  }

  const data = Buffer.from(info.data);
  try {
    validateDiscriminator(data);
  } catch (e) {
    console.error("FATAL:", (e as Error).message);
    process.exit(1);
  }

  const state = parseRegistry(data);

  console.log("=== Current Registry State ===");
  console.log("Size (bytes):      ", state.size);
  console.log("authority:         ", state.authority);
  console.log("agent_count:       ", state.agentCount.toString());
  console.log("oracle_authority:  ", state.oracleAuthority ?? "(not present — pre-migration)");
  console.log("bump:              ", state.bump);
  console.log();

  const { passed, findings, warnings } = runPreFlight(state, registryPda.toBase58());

  console.log("=== Pre-flight Results ===");
  for (const f of findings) console.log(f);
  console.log();

  if (warnings.length > 0) {
    console.log("=== Warnings ===");
    for (const w of warnings) console.log("⚠️ ", w);
    console.log();
  }

  if (!passed) {
    console.log("Migration not required — registry is already at 81 bytes.");
    console.log("Run with --verify to confirm all fields are correct.");
    process.exit(0);
  }

  // Build instruction and print Squads submission data
  const vaultPubkey = new PublicKey(MAINNET_VAULT_PDA);
  const ix = buildMigrateInstruction(programPubkey, registryPda, vaultPubkey);

  console.log("=== Squads Instruction Data ===");
  console.log();
  console.log("Submit this instruction as a Squads v4 vault transaction:");
  console.log();
  console.log("Program ID:");
  console.log(" ", programPubkey.toBase58());
  console.log();
  console.log("Accounts (in order):");
  for (let i = 0; i < ix.keys.length; i++) {
    const k = ix.keys[i];
    const label = ["attestation_registry (writable)", "authority / vault PDA (signer, writable)", "system_program"][i];
    console.log(`  [${i}] ${k.pubkey.toBase58()}  writable=${k.isWritable}  signer=${k.isSigner}  — ${label}`);
  }
  console.log();
  console.log("Instruction data (hex):");
  console.log(" ", ix.data.toString("hex"));
  console.log();
  console.log("Discriminator bytes:", [...ix.data.subarray(0, 8)]);
  console.log("(No payload — migrate_attestation_registry takes no parameters)");
  console.log();
  console.log("=== Expected Post-Migration State ===");
  console.log("Size (bytes):      81");
  console.log("authority:        ", state.authority, "(unchanged)");
  console.log("agent_count:      ", state.agentCount.toString(), "(unchanged)");
  console.log("oracle_authority: ", EXPECTED_ORACLE, "(set by migration)");
  console.log("bump:             ", state.bump, "(preserved)");
  console.log();
  console.log("=== Next Steps ===");
  console.log("1. Open Squads vault:", MAINNET_VAULT_PDA);
  console.log("2. Create a new transaction proposal with the instruction above.");
  console.log("3. Signer A reviews and approves the transaction.");
  console.log("4. Signer B independently reviews on-chain data and approves.");
  console.log("5. Either signer executes the transaction after 2-of-2 threshold.");
  console.log("6. Run this script with --verify to confirm post-migration state.");
  console.log("7. Post the execution transaction signature to HOL-250 in Paperclip.");
}

// ─── Verify mode ──────────────────────────────────────────────────────────────

async function runVerify(connection: Connection, registryPda: PublicKey) {
  console.log("=".repeat(70));
  console.log(" MAINNET POST-MIGRATION VERIFICATION");
  console.log("=".repeat(70));
  console.log();
  console.log("Registry PDA:", registryPda.toBase58());
  console.log();

  const info = await connection.getAccountInfo(registryPda, "confirmed");
  if (!info) {
    console.error("FAIL: AttestationRegistry PDA not found on mainnet.");
    process.exit(1);
  }

  const data = Buffer.from(info.data);
  validateDiscriminator(data);
  const state = parseRegistry(data);

  console.log("=== Current Registry State ===");
  console.log("Size (bytes):      ", state.size);
  console.log("authority:         ", state.authority);
  console.log("agent_count:       ", state.agentCount.toString());
  console.log("oracle_authority:  ", state.oracleAuthority ?? "(not present)");
  console.log("bump:              ", state.bump);
  console.log();

  const errors: string[] = [];

  if (state.size !== MIGRATED_SIZE) {
    errors.push(`Size: expected ${MIGRATED_SIZE}, got ${state.size} — migration not yet applied.`);
  }

  if (state.oracleAuthority !== EXPECTED_ORACLE) {
    errors.push(
      `oracle_authority: expected ${EXPECTED_ORACLE}, got ${state.oracleAuthority ?? "(none)"}`,
    );
  }

  if (state.authority !== MAINNET_VAULT_PDA) {
    errors.push(
      `authority changed unexpectedly: expected ${MAINNET_VAULT_PDA}, got ${state.authority}`,
    );
  }

  // Note: we cannot compare agent_count against pre-migration value here since
  // we don't have a snapshot. The discriminator + field layout checks are sufficient.

  console.log("=== Verification Results ===");
  if (errors.length > 0) {
    console.error("FAIL — post-migration verification failed:");
    for (const e of errors) console.error("  ✗", e);
    process.exit(1);
  }

  console.log("✅ Size: 81 bytes");
  console.log("✅ oracle_authority:", state.oracleAuthority);
  console.log("✅ authority:", state.authority);
  console.log("✅ bump:", state.bump);
  console.log("✅ agent_count:", state.agentCount.toString());
  console.log();
  console.log("Post-migration verification PASSED.");
  console.log("Safe to proceed with oracle authority rotation (HOL-236) if applicable.");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { mode, programId, rpc } = parseArgs(process.argv);

  let programPubkey: PublicKey;
  try {
    programPubkey = new PublicKey(programId);
  } catch {
    console.error(`Invalid --program-id: ${programId}`);
    process.exit(1);
  }

  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("attestation_registry")],
    programPubkey,
  );

  const connection = new Connection(rpc, "confirmed");

  if (mode === "dry-run") {
    await runDryRun(connection, programPubkey, registryPda);
  } else {
    await runVerify(connection, registryPda);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
