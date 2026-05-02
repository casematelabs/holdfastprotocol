/**
 * Rotate the oracle authority stored in AttestationRegistry.
 *
 * Calls `set_oracle_authority(new_oracle: Pubkey)` on-chain. The signer must be
 * the current attestation_registry.authority (protocol authority). On mainnet
 * this is the Squads multisig vault; on devnet it is the local devnet keypair.
 *
 * Usage:
 *   # Devnet (keypair file signs directly):
 *   npx ts-node scripts/set-oracle-authority.ts \
 *     --new-oracle <BASE58_PUBKEY> \
 *     --authority-keypair keys/devnet-protocol-authority.json
 *
 *   # Mainnet (Squads/Ledger flow — see HOL-234 plan for full instructions):
 *   npx ts-node scripts/set-oracle-authority.ts \
 *     --new-oracle <BASE58_PUBKEY> \
 *     --network mainnet \
 *     --dry-run
 *   # Then submit the printed instruction through Squads.
 *
 * Flags:
 *   --new-oracle <BASE58>       New oracle authority pubkey (required)
 *   --authority-keypair <path>  Path to protocol authority keypair JSON (devnet use)
 *   --network devnet|mainnet    RPC target (default: devnet)
 *   --program-id <BASE58>       Override vaultpact program ID
 *   --dry-run                   Print instruction data and accounts, do not send
 *   --help                      Show this message
 *
 * The script builds the Anchor instruction directly from the known discriminator
 * so it does not require a freshly-built IDL.
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

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_PROGRAM_ID = "2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq";
const MAINNET_PROGRAM_ID = "2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq"; // update when mainnet program differs

const RPC: Record<string, string> = {
  devnet: "https://api.devnet.solana.com",
  mainnet: "https://api.mainnet-beta.solana.com",
};

// ─── Anchor discriminator ─────────────────────────────────────────────────────

function anchorDiscriminator(ixName: string): Buffer {
  const hash = crypto.createHash("sha256").update(`global:${ixName}`).digest();
  return hash.subarray(0, 8);
}

// ─── Registry helpers ─────────────────────────────────────────────────────────

function readOracleAuthority(data: Buffer): string {
  // AttestationRegistry layout (81 bytes):
  //   [0..8]   discriminator
  //   [8..40]  authority (Pubkey)
  //   [40..48] agent_count (u64 LE)
  //   [48..80] oracle_authority (Pubkey)
  //   [80]     bump
  if (data.length < 81) {
    throw new Error(
      `Registry is ${data.length} bytes — expected 81. Run "anchor build" and redeploy.`,
    );
  }
  return new PublicKey(data.subarray(48, 80)).toBase58();
}

function readProtocolAuthority(data: Buffer): string {
  if (data.length < 40) throw new Error("Registry account too small");
  return new PublicKey(data.subarray(8, 40)).toBase58();
}

// ─── CLI arg parsing ──────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  newOracle: string;
  authorityKeypairPath: string | null;
  network: string;
  programId: string;
  dryRun: boolean;
} {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    // Print leading doc comment
    const src = fs.readFileSync(__filename, "utf8");
    const doc = src.match(/^\/\*\*([\s\S]*?)\*\//)?.[0] ?? "";
    console.log(doc.replace(/^ \* ?/gm, ""));
    process.exit(0);
  }

  let newOracle = "";
  let authorityKeypairPath: string | null = null;
  let network = "devnet";
  let programId = DEFAULT_PROGRAM_ID;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--new-oracle":
        newOracle = args[++i];
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

  if (!newOracle) {
    console.error("Error: --new-oracle <BASE58_PUBKEY> is required");
    process.exit(1);
  }

  if (network === "mainnet") {
    programId = MAINNET_PROGRAM_ID;
  }

  return { newOracle, authorityKeypairPath, network, programId, dryRun };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { newOracle, authorityKeypairPath, network, programId, dryRun } =
    parseArgs(process.argv);

  let newOraclePubkey: PublicKey;
  try {
    newOraclePubkey = new PublicKey(newOracle);
  } catch {
    console.error(`Invalid --new-oracle pubkey: ${newOracle}`);
    process.exit(1);
  }

  if (newOraclePubkey.equals(PublicKey.default)) {
    console.error("Error: --new-oracle must not be the zero pubkey");
    process.exit(1);
  }

  const programPubkey = new PublicKey(programId);
  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("attestation_registry")],
    programPubkey,
  );

  const rpcUrl = RPC[network] ?? network; // allow raw URL as --network
  const connection = new Connection(rpcUrl, "confirmed");

  // ── Read current registry state ───────────────────────────────────────────

  const registryInfo = await connection.getAccountInfo(registryPda);
  if (!registryInfo) {
    console.error(`AttestationRegistry PDA not found: ${registryPda.toBase58()}`);
    process.exit(1);
  }

  const currentProtocolAuthority = readProtocolAuthority(
    Buffer.from(registryInfo.data),
  );
  const currentOracleAuthority = readOracleAuthority(
    Buffer.from(registryInfo.data),
  );

  console.log("Network:                  ", network);
  console.log("Program ID:               ", programId);
  console.log("Registry PDA:             ", registryPda.toBase58());
  console.log("Protocol authority:       ", currentProtocolAuthority);
  console.log("Current oracle authority: ", currentOracleAuthority);
  console.log("New oracle authority:     ", newOraclePubkey.toBase58());
  console.log();

  if (currentOracleAuthority === newOraclePubkey.toBase58()) {
    console.log("Oracle authority is already set to the target pubkey — nothing to do.");
    process.exit(0);
  }

  // ── Build instruction ─────────────────────────────────────────────────────
  //
  // Instruction data: discriminator (8 bytes) + new_oracle pubkey (32 bytes)
  // set_oracle_authority discriminator = sha256("global:set_oracle_authority")[0:8]

  const discriminator = anchorDiscriminator("set_oracle_authority");
  const instructionData = Buffer.concat([discriminator, newOraclePubkey.toBuffer()]);

  // Accounts: attestation_registry (mut), authority (signer)
  // We use a placeholder authority pubkey for dry-run; in live mode we need the
  // actual authority keypair.

  let authorityPubkey: PublicKey;
  let authorityKeypair: Keypair | null = null;

  if (authorityKeypairPath) {
    const raw = JSON.parse(fs.readFileSync(authorityKeypairPath, "utf8"));
    authorityKeypair = Keypair.fromSecretKey(Uint8Array.from(raw));
    authorityPubkey = authorityKeypair.publicKey;
  } else {
    // dry-run or Squads flow: use on-chain authority pubkey as placeholder
    authorityPubkey = new PublicKey(currentProtocolAuthority);
  }

  const accounts: AccountMeta[] = [
    { pubkey: registryPda, isSigner: false, isWritable: true },
    { pubkey: authorityPubkey, isSigner: true, isWritable: false },
  ];

  const ix = new TransactionInstruction({
    programId: programPubkey,
    keys: accounts,
    data: instructionData,
  });

  // ── Dry-run output ────────────────────────────────────────────────────────

  if (dryRun) {
    console.log("DRY RUN — instruction not sent\n");
    console.log("Instruction accounts:");
    for (const acc of accounts) {
      console.log(
        `  ${acc.pubkey.toBase58()}  writable=${acc.isWritable}  signer=${acc.isSigner}`,
      );
    }
    console.log("\nInstruction data (hex):");
    console.log(" ", instructionData.toString("hex"));
    console.log("\nDiscriminator bytes:", [...discriminator]);
    console.log(
      "\nTo execute via Squads multisig, submit this instruction against the vaultpact program.",
    );
    return;
  }

  // ── Live send ─────────────────────────────────────────────────────────────

  if (!authorityKeypair) {
    console.error(
      "Error: --authority-keypair is required for live (non-dry-run) execution.\n" +
        "For mainnet Squads flow, use --dry-run to get the instruction data.",
    );
    process.exit(1);
  }

  if (
    authorityPubkey.toBase58() !== currentProtocolAuthority &&
    network !== "devnet"
  ) {
    console.warn(
      `Warning: signing authority (${authorityPubkey.toBase58()}) ` +
        `does not match on-chain protocol authority (${currentProtocolAuthority}). ` +
        "The transaction will be rejected.",
    );
  }

  console.log(`Sending set_oracle_authority transaction on ${network}...`);
  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [authorityKeypair]);
  console.log("Transaction signature:", sig);

  // ── Verify ────────────────────────────────────────────────────────────────

  const updatedInfo = await connection.getAccountInfo(registryPda);
  if (!updatedInfo) throw new Error("Registry account disappeared after update");
  const oracleAfter = readOracleAuthority(Buffer.from(updatedInfo.data));

  console.log("\nVerification:");
  console.log("  Before:", currentOracleAuthority);
  console.log("  After: ", oracleAfter);

  if (oracleAfter !== newOraclePubkey.toBase58()) {
    console.error("FAIL: oracle authority mismatch after transaction");
    process.exit(1);
  }

  console.log("\nPASS: oracle authority rotated successfully");
  console.log("\nNext steps:");
  console.log("  1. Update oracle daemon: set ORACLE_KEYPAIR_PATH or ORACLE_KEYPAIR_JSON");
  console.log("     to the new keypair that corresponds to:", newOraclePubkey.toBase58());
  console.log("  2. Restart oracle daemon and confirm it logs the correct oracle authority.");
  console.log("  3. Verify first update_reputation transaction succeeds with new key.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
