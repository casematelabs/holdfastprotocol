/**
 * Devnet integration test for oracle authority rotation (HOL-236 AC#1).
 *
 * Prerequisites (must all be true before running):
 *   1. New vaultpact program deployed to devnet (AttestationRegistry = 81 bytes).
 *      The devnet program must be built from the HOL-182 codebase or later
 *      (i.e., target/idl/vaultpact.json must include `set_oracle_authority`).
 *   2. AttestationRegistry initialized on devnet (run init-registry-devnet.ts if not).
 *   3. keys/devnet-protocol-authority.json present and funded (pays tx fees).
 *
 * What this test does:
 *   1. Reads the current oracle authority from the on-chain registry.
 *   2. Generates an ephemeral test oracle keypair.
 *   3. Rotates the oracle authority to the test pubkey.
 *   4. Verifies the on-chain state changed.
 *   5. Rotates back to the original oracle authority (cleanup).
 *   6. Verifies the registry is restored.
 *
 * Usage:
 *   npx ts-node scripts/test-oracle-rotation-devnet.ts
 *
 * The script exits with code 0 on pass, 1 on failure.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  AccountMeta,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── Config ──────────────────────────────────────────────────────────────────

const PROGRAM_ID = "D6mUa4wGtFyLyJorMfxoKvA9ybohjUSsfw88t66ATxg";
const DEVNET_RPC = "https://api.devnet.solana.com";
const AUTHORITY_KEYPAIR_PATH = path.join(__dirname, "..", "keys", "devnet-protocol-authority.json");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function anchorDiscriminator(ixName: string): Buffer {
  return crypto.createHash("sha256").update(`global:${ixName}`).digest().subarray(0, 8);
}

function readRegistryLayout(data: Buffer): { authority: string; oracleAuthority: string } {
  // AttestationRegistry layout (81 bytes):
  //   [0..8]   discriminator
  //   [8..40]  authority (Pubkey)
  //   [40..48] agent_count (u64 LE)
  //   [48..80] oracle_authority (Pubkey)
  //   [80]     bump
  if (data.length < 81) {
    throw new Error(
      `Registry is ${data.length} bytes — expected 81.\n` +
      "The devnet program must be redeployed with the HOL-182 changes before running this test.\n" +
      "HOL-215 (CI/CD secret fix) must be resolved first.",
    );
  }
  return {
    authority: new PublicKey(data.subarray(8, 40)).toBase58(),
    oracleAuthority: new PublicKey(data.subarray(48, 80)).toBase58(),
  };
}

function buildSetOracleAuthorityIx(
  programId: PublicKey,
  registryPda: PublicKey,
  authorityPubkey: PublicKey,
  newOracle: PublicKey,
): TransactionInstruction {
  const disc = anchorDiscriminator("set_oracle_authority");
  const data = Buffer.concat([disc, newOracle.toBuffer()]);
  const keys: AccountMeta[] = [
    { pubkey: registryPda, isSigner: false, isWritable: true },
    { pubkey: authorityPubkey, isSigner: true, isWritable: false },
  ];
  return new TransactionInstruction({ programId, keys, data });
}

function loadKeypair(filePath: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Devnet Oracle Rotation Test (HOL-236 AC#1) ===\n");

  if (!fs.existsSync(AUTHORITY_KEYPAIR_PATH)) {
    console.error(`Missing authority keypair: ${AUTHORITY_KEYPAIR_PATH}`);
    console.error("Generate devnet keypairs first: node scripts/gen-devnet-keypairs.js");
    process.exit(1);
  }

  const authority = loadKeypair(AUTHORITY_KEYPAIR_PATH);
  const programId = new PublicKey(PROGRAM_ID);
  const connection = new Connection(DEVNET_RPC, "confirmed");

  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("attestation_registry")],
    programId,
  );

  // ── 1. Read current registry state ───────────────────────────────────────

  const registryInfo = await connection.getAccountInfo(registryPda);
  if (!registryInfo) {
    console.error(`AttestationRegistry PDA not found: ${registryPda.toBase58()}`);
    console.error("Run: npx ts-node scripts/init-registry-devnet.ts");
    process.exit(1);
  }

  const before = readRegistryLayout(Buffer.from(registryInfo.data));
  const originalOracle = new PublicKey(before.oracleAuthority);

  console.log("Registry PDA:              ", registryPda.toBase58());
  console.log("Protocol authority:        ", before.authority);
  console.log("Current oracle authority:  ", before.oracleAuthority);
  console.log("Signing authority keypair: ", authority.publicKey.toBase58());
  console.log();

  if (authority.publicKey.toBase58() !== before.authority) {
    console.error(
      `Authority mismatch: keypair pubkey ${authority.publicKey.toBase58()} ` +
      `does not match registry.authority ${before.authority}.\n` +
      "The has_one = authority constraint will reject this transaction.",
    );
    process.exit(1);
  }

  // ── 2. Generate ephemeral test oracle ────────────────────────────────────

  const testOracle = Keypair.generate();
  console.log(`Test oracle (ephemeral): ${testOracle.publicKey.toBase58()}`);
  console.log();

  // ── 3. Rotate to test oracle ──────────────────────────────────────────────

  console.log("Step 1: Rotating oracle authority to test pubkey...");
  const rotateIx = buildSetOracleAuthorityIx(
    programId, registryPda, authority.publicKey, testOracle.publicKey,
  );
  const rotateTx = new Transaction().add(rotateIx);
  const rotateSig = await sendAndConfirmTransaction(connection, rotateTx, [authority]);
  console.log("  Transaction:", rotateSig);

  // ── 4. Verify rotation ────────────────────────────────────────────────────

  const afterRotate = await connection.getAccountInfo(registryPda);
  if (!afterRotate) throw new Error("Registry disappeared after rotation");
  const stateAfterRotate = readRegistryLayout(Buffer.from(afterRotate.data));

  if (stateAfterRotate.oracleAuthority !== testOracle.publicKey.toBase58()) {
    console.error("FAIL: oracle_authority not updated after rotation");
    console.error("  Expected:", testOracle.publicKey.toBase58());
    console.error("  Got:     ", stateAfterRotate.oracleAuthority);
    process.exit(1);
  }
  console.log("  PASS: oracle_authority now =", stateAfterRotate.oracleAuthority);
  console.log();

  // ── 5. Rotate back (cleanup) ──────────────────────────────────────────────

  console.log("Step 2: Rotating back to original oracle authority (cleanup)...");
  const restoreIx = buildSetOracleAuthorityIx(
    programId, registryPda, authority.publicKey, originalOracle,
  );
  const restoreTx = new Transaction().add(restoreIx);
  const restoreSig = await sendAndConfirmTransaction(connection, restoreTx, [authority]);
  console.log("  Transaction:", restoreSig);

  // ── 6. Verify restore ─────────────────────────────────────────────────────

  const afterRestore = await connection.getAccountInfo(registryPda);
  if (!afterRestore) throw new Error("Registry disappeared after restore");
  const stateAfterRestore = readRegistryLayout(Buffer.from(afterRestore.data));

  if (stateAfterRestore.oracleAuthority !== originalOracle.toBase58()) {
    console.error("FAIL: oracle_authority not restored to original");
    console.error("  Expected:", originalOracle.toBase58());
    console.error("  Got:     ", stateAfterRestore.oracleAuthority);
    process.exit(1);
  }
  console.log("  PASS: oracle_authority restored to", stateAfterRestore.oracleAuthority);
  console.log();

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log("=== PASS: Oracle rotation test complete ===");
  console.log();
  console.log("Rotation/restore transactions:");
  console.log("  Rotate:  ", `https://explorer.solana.com/tx/${rotateSig}?cluster=devnet`);
  console.log("  Restore: ", `https://explorer.solana.com/tx/${restoreSig}?cluster=devnet`);
  console.log();
  console.log("Devnet oracle rotation is validated. Ready for mainnet rotation.");
  console.log("Next: obtain Ledger pubkey from HOL-234, then run set-oracle-authority.ts on mainnet.");
}

main().catch((err) => {
  console.error("Fatal:", err.message ?? err);
  process.exit(1);
});
