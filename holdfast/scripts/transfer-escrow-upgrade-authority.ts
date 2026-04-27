/**
 * Check or transfer the upgrade authority of the vaultpact_escrow program.
 *
 * The upgrade authority controls who can deploy new bytecode to the program via
 * `solana program upgrade`. On mainnet this must be the Squads 2-of-2 vault PDA
 * (F7koW9b6RYpGrwEXNCGx5V5cKmK2YwhR5e5UyPyBj1J9).
 *
 * The transfer uses the BPF Upgradeable Loader's SetAuthority instruction (index 4).
 * The new authority does NOT need to sign — consistent with the CLI's
 * `--skip-new-upgrade-authority-signer-check` flag, which allows transferring
 * to a PDA like the Squads vault.
 *
 * Usage:
 *   # Inspect current upgrade authority (devnet):
 *   npx ts-node scripts/transfer-escrow-upgrade-authority.ts --check
 *
 *   # Inspect on mainnet:
 *   npx ts-node scripts/transfer-escrow-upgrade-authority.ts --check --network mainnet
 *
 *   # Print solana CLI command for manual mainnet execution:
 *   npx ts-node scripts/transfer-escrow-upgrade-authority.ts \
 *     --new-authority F7koW9b6RYpGrwEXNCGx5V5cKmK2YwhR5e5UyPyBj1J9 \
 *     --network mainnet \
 *     --program-id <MAINNET_ESCROW_PROGRAM_ID> \
 *     --dry-run
 *
 *   # Direct devnet transfer (keypair must be the current upgrade authority):
 *   npx ts-node scripts/transfer-escrow-upgrade-authority.ts \
 *     --new-authority <NEW_AUTHORITY_PUBKEY> \
 *     --authority-keypair ~/.config/solana/upgrade-authority.json \
 *     --network devnet
 *
 * Flags:
 *   --check                     Read and print current upgrade authority; no transfer
 *   --new-authority <BASE58>    New upgrade authority pubkey (required for transfer)
 *   --authority-keypair <path>  Path to the current upgrade authority keypair JSON
 *   --network devnet|mainnet    RPC target (default: devnet)
 *   --program-id <BASE58>       Override program ID (default: devnet ID)
 *   --dry-run                   Print CLI command; do not sign or send
 *   --help                      Show this message
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── Constants ────────────────────────────────────────────────────────────────

const DEVNET_ESCROW_PROGRAM_ID = "BNxA76z6vjQYtUJXGpH8qjA3wHvtAAqGqL6rvVWH6b3H";
const SQUADS_VAULT_PDA = "F7koW9b6RYpGrwEXNCGx5V5cKmK2YwhR5e5UyPyBj1J9";

// Solana BPF Upgradeable Loader program ID (immutable system program)
const BPF_UPGRADEABLE_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

// SetAuthority instruction: bincode-serialized enum variant index 4
const SET_AUTHORITY_DATA = Buffer.from([4, 0, 0, 0]);

const RPC: Record<string, string> = {
  devnet: "https://api.devnet.solana.com",
  mainnet: "https://api.mainnet-beta.solana.com",
};

// ─── BPF Upgradeable Loader helpers ──────────────────────────────────────────

/**
 * Read the ProgramData address from a BPF Upgradeable program account.
 * Program account layout: [discriminator(4)] [programdata_address(32)]
 */
function parseProgramAccount(data: Buffer): PublicKey {
  if (data.length < 36) {
    throw new Error(`Program account too small (${data.length} bytes) — is this a BPF upgradeable program?`);
  }
  const discriminator = data.readUInt32LE(0);
  if (discriminator !== 2) {
    throw new Error(`Expected Program discriminator (2), got ${discriminator}. Not an upgradeable program.`);
  }
  return new PublicKey(data.slice(4, 36));
}

/**
 * Read the upgrade authority from a ProgramData account.
 * Layout: [discriminator(4)] [slot(8)] [has_authority(1)] [authority(32 if present)]
 * Returns null if the program is immutable (no upgrade authority).
 */
function parseUpgradeAuthority(data: Buffer): PublicKey | null {
  if (data.length < 13) {
    throw new Error(`ProgramData account too small (${data.length} bytes)`);
  }
  const discriminator = data.readUInt32LE(0);
  if (discriminator !== 3) {
    throw new Error(`Expected ProgramData discriminator (3), got ${discriminator}`);
  }
  const hasAuthority = data[12] === 1;
  if (!hasAuthority) return null;
  if (data.length < 45) {
    throw new Error("ProgramData has authority flag set but insufficient bytes for pubkey");
  }
  return new PublicKey(data.slice(13, 45));
}

async function readUpgradeAuthority(
  connection: Connection,
  programId: PublicKey,
): Promise<{ programDataAddress: PublicKey; upgradeAuthority: PublicKey | null }> {
  const programAccount = await connection.getAccountInfo(programId);
  if (!programAccount) {
    throw new Error(`Program account not found: ${programId.toBase58()}`);
  }
  const programDataAddress = parseProgramAccount(Buffer.from(programAccount.data));

  const programDataAccount = await connection.getAccountInfo(programDataAddress);
  if (!programDataAccount) {
    throw new Error(`ProgramData account not found: ${programDataAddress.toBase58()}`);
  }
  const upgradeAuthority = parseUpgradeAuthority(Buffer.from(programDataAccount.data));
  return { programDataAddress, upgradeAuthority };
}

// ─── CLI arg parsing ──────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  check: boolean;
  newAuthority: string | null;
  authorityKeypairPath: string | null;
  network: string;
  programId: string;
  dryRun: boolean;
} {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    const src = fs.readFileSync(__filename, "utf8");
    const doc = src.match(/^\/\*\*([\s\S]*?)\*\//)?.[0] ?? "";
    console.log(doc.replace(/^ \* ?/gm, ""));
    process.exit(0);
  }

  let check = false;
  let newAuthority: string | null = null;
  let authorityKeypairPath: string | null = null;
  let network = "devnet";
  let programId = DEVNET_ESCROW_PROGRAM_ID;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--check":
        check = true;
        break;
      case "--new-authority":
        newAuthority = args[++i];
        break;
      case "--authority-keypair":
        authorityKeypairPath = args[++i];
        break;
      case "--network":
        network = args[++i];
        break;
      case "--program-id":
        programId = args[++i];
        break;
      case "--dry-run":
        dryRun = true;
        break;
      default:
        console.error(`Unknown argument: ${args[i]}`);
        process.exit(1);
    }
  }

  return { check, newAuthority, authorityKeypairPath, network, programId, dryRun };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { check, newAuthority, authorityKeypairPath, network, programId, dryRun } =
    parseArgs(process.argv);

  if (!check && !newAuthority && !dryRun) {
    console.error("Error: specify --check to read state, or --new-authority <PUBKEY> to transfer.");
    console.error("       Add --dry-run to print the CLI command instead of sending.");
    process.exit(1);
  }

  const programPubkey = new PublicKey(programId);
  const rpcUrl = RPC[network] ?? network;
  const connection = new Connection(rpcUrl, "confirmed");

  console.log("Network:    ", network);
  console.log("Program ID: ", programId);
  console.log();

  const { programDataAddress, upgradeAuthority } = await readUpgradeAuthority(connection, programPubkey);

  console.log("ProgramData:       ", programDataAddress.toBase58());
  console.log("Upgrade authority: ", upgradeAuthority?.toBase58() ?? "(none — program is immutable)");
  console.log();

  // ── Check-only mode ───────────────────────────────────────────────────────

  if (check) return;

  // ── Validate transfer target ──────────────────────────────────────────────

  if (!newAuthority) {
    console.error("Error: --new-authority is required for transfer");
    process.exit(1);
  }

  let newAuthorityPubkey: PublicKey;
  try {
    newAuthorityPubkey = new PublicKey(newAuthority);
  } catch {
    console.error(`Invalid --new-authority pubkey: ${newAuthority}`);
    process.exit(1);
  }

  if (upgradeAuthority?.toBase58() === newAuthorityPubkey.toBase58()) {
    console.log("Upgrade authority is already set to the target — nothing to do.");
    return;
  }

  // ── Dry-run: print CLI command ────────────────────────────────────────────

  if (dryRun) {
    const rpcFlag = network === "mainnet" ? "--url mainnet-beta" : `--url ${rpcUrl}`;
    console.log("DRY RUN — transaction not sent\n");
    console.log("Solana CLI command to execute this transfer:");
    console.log();
    console.log(
      `  solana program set-upgrade-authority \\
    --skip-new-upgrade-authority-signer-check \\
    ${programId} \\
    --new-upgrade-authority ${newAuthorityPubkey.toBase58()} \\
    --keypair <PATH_TO_CURRENT_AUTHORITY_KEYPAIR> \\
    ${rpcFlag}`,
    );
    console.log();
    console.log("Raw instruction details:");
    console.log("  Program:            ", BPF_UPGRADEABLE_LOADER.toBase58());
    console.log("  Instruction data:   ", SET_AUTHORITY_DATA.toString("hex"), "(SetAuthority, variant 4)");
    console.log("  Account 0 (w,!s):  ", programDataAddress.toBase58(), "(ProgramData)");
    console.log(
      "  Account 1 (!w,s):  ",
      upgradeAuthority?.toBase58() ?? "<current authority>",
      "(current authority, signer)",
    );
    console.log("  Account 2 (!w,!s): ", newAuthorityPubkey.toBase58(), "(new authority, no signature needed)");
    console.log();
    console.log("For Squads multisig execution:");
    console.log("  1. Open vault F7koW9b6RYpGrwEXNCGx5V5cKmK2YwhR5e5UyPyBj1J9 in Squads UI");
    console.log("  2. Create a new transaction proposal with the instruction above");
    console.log("  3. Wait for 2-of-2 approval");
    console.log("  4. Execute and verify with: npx ts-node scripts/transfer-escrow-upgrade-authority.ts --check --network", network);
    return;
  }

  // ── Live transfer (devnet only) ───────────────────────────────────────────

  if (network === "mainnet") {
    console.error("Error: live transfer is not supported in script mode for mainnet.");
    console.error("Use --dry-run to get the CLI command, then run it manually with the plaintext keypair.");
    console.error("See docs/escrow-upgrade-authority-transfer-runbook.md for the full procedure.");
    process.exit(1);
  }

  if (!authorityKeypairPath) {
    console.error("Error: --authority-keypair is required for live transfer.");
    console.error("Default devnet path: ~/.config/solana/upgrade-authority.json");
    process.exit(1);
  }

  const resolvedPath = authorityKeypairPath.replace(/^~/, process.env.HOME ?? "");
  if (!fs.existsSync(resolvedPath)) {
    console.error(`Authority keypair not found: ${resolvedPath}`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  const authorityKeypair = Keypair.fromSecretKey(Uint8Array.from(raw));

  if (upgradeAuthority && authorityKeypair.publicKey.toBase58() !== upgradeAuthority.toBase58()) {
    console.error(
      `Authority mismatch: keypair pubkey (${authorityKeypair.publicKey.toBase58()}) ` +
        `does not match on-chain upgrade authority (${upgradeAuthority.toBase58()}).`,
    );
    console.error("The transaction will be rejected.");
    process.exit(1);
  }

  const ix = new TransactionInstruction({
    programId: BPF_UPGRADEABLE_LOADER,
    keys: [
      { pubkey: programDataAddress, isWritable: true, isSigner: false },
      { pubkey: authorityKeypair.publicKey, isWritable: false, isSigner: true },
      { pubkey: newAuthorityPubkey, isWritable: false, isSigner: false },
    ],
    data: SET_AUTHORITY_DATA,
  });

  console.log(`Transferring upgrade authority on ${network}...`);
  console.log("  From:", authorityKeypair.publicKey.toBase58());
  console.log("  To:  ", newAuthorityPubkey.toBase58());
  console.log();

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [authorityKeypair]);
  console.log("Transaction:", sig);
  console.log(`  https://explorer.solana.com/tx/${sig}?cluster=${network}`);

  // ── Verify ────────────────────────────────────────────────────────────────

  const { upgradeAuthority: authorityAfter } = await readUpgradeAuthority(connection, programPubkey);
  console.log("\nVerification:");
  console.log("  Before:", upgradeAuthority?.toBase58() ?? "(none)");
  console.log("  After: ", authorityAfter?.toBase58() ?? "(none)");

  if (authorityAfter?.toBase58() !== newAuthorityPubkey.toBase58()) {
    console.error("FAIL: upgrade authority mismatch after transaction");
    process.exit(1);
  }

  console.log("\nPASS: upgrade authority transferred successfully");
}

main().catch((err) => {
  console.error("Fatal:", err.message ?? err);
  process.exit(1);
});
