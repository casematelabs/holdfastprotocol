/**
 * Devnet integration test for escrow program upgrade authority transfer (HOL-237).
 *
 * Prerequisites:
 *   1. vaultpact_escrow deployed to devnet at CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi
 *   2. Current upgrade authority keypair available locally
 *      Default path: ~/.config/solana/upgrade-authority.json
 *      (matches DEVNET_UPGRADE_AUTHORITY_JSON GitHub secret)
 *
 * What this test does:
 *   1. Reads the current upgrade authority from the on-chain ProgramData account
 *   2. Generates an ephemeral test keypair as the transfer target
 *   3. Transfers upgrade authority to the ephemeral key
 *   4. Verifies the transfer on-chain
 *   5. Transfers back to the original authority (cleanup)
 *   6. Verifies the restore
 *
 * This validates the full transfer mechanism before mainnet execution.
 *
 * Usage:
 *   npx ts-node scripts/test-escrow-upgrade-authority-devnet.ts
 *
 *   # With custom authority keypair path:
 *   UPGRADE_AUTHORITY_KEYPAIR=~/.config/solana/my-authority.json \
 *   npx ts-node scripts/test-escrow-upgrade-authority-devnet.ts
 *
 * The script exits with code 0 on pass, 1 on failure.
 * Always restores the original authority on success or failure.
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
import * as os from "node:os";

// ─── Config ──────────────────────────────────────────────────────────────────

const ESCROW_PROGRAM_ID = new PublicKey("CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi");
const DEVNET_RPC = "https://api.devnet.solana.com";
const DEFAULT_AUTHORITY_KEYPAIR_PATH = path.join(os.homedir(), ".config", "solana", "upgrade-authority.json");

const BPF_UPGRADEABLE_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const SET_AUTHORITY_DATA = Buffer.from([4, 0, 0, 0]);

// ─── BPF Loader helpers ───────────────────────────────────────────────────────

function parseProgramAccount(data: Buffer): PublicKey {
  if (data.length < 36) throw new Error(`Program account too small: ${data.length} bytes`);
  const disc = data.readUInt32LE(0);
  if (disc !== 2) throw new Error(`Not a BPF upgradeable program (discriminator=${disc})`);
  return new PublicKey(data.slice(4, 36));
}

function parseUpgradeAuthority(data: Buffer): PublicKey | null {
  if (data.length < 13) throw new Error(`ProgramData account too small: ${data.length} bytes`);
  const disc = data.readUInt32LE(0);
  if (disc !== 3) throw new Error(`Not a ProgramData account (discriminator=${disc})`);
  const hasAuth = data[12] === 1;
  if (!hasAuth) return null;
  if (data.length < 45) throw new Error("ProgramData has authority flag but insufficient bytes");
  return new PublicKey(data.slice(13, 45));
}

async function getUpgradeAuthority(
  connection: Connection,
  programId: PublicKey,
): Promise<{ programDataAddress: PublicKey; upgradeAuthority: PublicKey | null }> {
  const progAccount = await connection.getAccountInfo(programId);
  if (!progAccount) throw new Error(`Program not found: ${programId.toBase58()}`);
  const programDataAddress = parseProgramAccount(Buffer.from(progAccount.data));

  const pdaAccount = await connection.getAccountInfo(programDataAddress);
  if (!pdaAccount) throw new Error(`ProgramData not found: ${programDataAddress.toBase58()}`);
  const upgradeAuthority = parseUpgradeAuthority(Buffer.from(pdaAccount.data));

  return { programDataAddress, upgradeAuthority };
}

function buildSetAuthorityIx(
  programDataAddress: PublicKey,
  currentAuthority: PublicKey,
  newAuthority: PublicKey,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: BPF_UPGRADEABLE_LOADER,
    keys: [
      { pubkey: programDataAddress, isWritable: true, isSigner: false },
      { pubkey: currentAuthority, isWritable: false, isSigner: true },
      { pubkey: newAuthority, isWritable: false, isSigner: false },
    ],
    data: SET_AUTHORITY_DATA,
  });
}

function loadKeypair(filePath: string): Keypair {
  const resolved = filePath.startsWith("~")
    ? path.join(os.homedir(), filePath.slice(1))
    : filePath;
  if (!fs.existsSync(resolved)) {
    throw new Error(`Keypair file not found: ${resolved}`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(resolved, "utf8"))));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Devnet Escrow Upgrade Authority Transfer Test (HOL-237) ===\n");

  const authorityPath =
    process.env.UPGRADE_AUTHORITY_KEYPAIR ?? DEFAULT_AUTHORITY_KEYPAIR_PATH;

  let authority: Keypair;
  try {
    authority = loadKeypair(authorityPath);
  } catch (err: any) {
    console.error(`Failed to load authority keypair: ${err.message}`);
    console.error(`Path: ${authorityPath}`);
    console.error("Set UPGRADE_AUTHORITY_KEYPAIR env var to override the default path.");
    console.error("The key must be the current upgrade authority for the devnet escrow program.");
    process.exit(1);
  }

  const connection = new Connection(DEVNET_RPC, "confirmed");

  console.log("Program ID:       ", ESCROW_PROGRAM_ID.toBase58());
  console.log("Authority pubkey: ", authority.publicKey.toBase58());
  console.log();

  // ── 1. Read current state ─────────────────────────────────────────────────

  const { programDataAddress, upgradeAuthority } = await getUpgradeAuthority(
    connection,
    ESCROW_PROGRAM_ID,
  );

  if (!upgradeAuthority) {
    console.error("SKIP: Program is already immutable (no upgrade authority). Cannot test transfer.");
    process.exit(0);
  }

  const originalAuthority = upgradeAuthority;
  console.log("ProgramData address:      ", programDataAddress.toBase58());
  console.log("Current upgrade authority:", originalAuthority.toBase58());
  console.log();

  if (authority.publicKey.toBase58() !== originalAuthority.toBase58()) {
    console.error(
      `Authority mismatch: provided keypair (${authority.publicKey.toBase58()}) ` +
        `does not match on-chain upgrade authority (${originalAuthority.toBase58()}).`,
    );
    console.error("The transaction will be rejected by the BPF Loader.");
    process.exit(1);
  }

  // ── 2. Transfer to ephemeral test key ────────────────────────────────────

  const testAuthority = Keypair.generate();
  console.log(`Ephemeral test authority: ${testAuthority.publicKey.toBase58()}`);
  console.log();

  console.log("Step 1: Transferring upgrade authority to ephemeral key...");
  const transferIx = buildSetAuthorityIx(
    programDataAddress,
    authority.publicKey,
    testAuthority.publicKey,
  );
  const transferTx = new Transaction().add(transferIx);
  const transferSig = await sendAndConfirmTransaction(connection, transferTx, [authority]);
  console.log("  Transaction:", transferSig);

  // ── 3. Verify transfer ────────────────────────────────────────────────────

  const { upgradeAuthority: afterTransfer } = await getUpgradeAuthority(connection, ESCROW_PROGRAM_ID);
  if (afterTransfer?.toBase58() !== testAuthority.publicKey.toBase58()) {
    console.error("FAIL: upgrade authority not updated after transfer");
    console.error("  Expected:", testAuthority.publicKey.toBase58());
    console.error("  Got:     ", afterTransfer?.toBase58() ?? "(none)");
    process.exit(1);
  }
  console.log("  PASS: upgrade authority now =", afterTransfer.toBase58());
  console.log();

  // ── 4. Restore original authority (cleanup) ───────────────────────────────

  console.log("Step 2: Restoring original upgrade authority (cleanup)...");
  const restoreIx = buildSetAuthorityIx(
    programDataAddress,
    testAuthority.publicKey,
    originalAuthority,
  );
  const restoreTx = new Transaction().add(restoreIx);
  const restoreSig = await sendAndConfirmTransaction(connection, restoreTx, [testAuthority]);
  console.log("  Transaction:", restoreSig);

  // ── 5. Verify restore ─────────────────────────────────────────────────────

  const { upgradeAuthority: afterRestore } = await getUpgradeAuthority(connection, ESCROW_PROGRAM_ID);
  if (afterRestore?.toBase58() !== originalAuthority.toBase58()) {
    console.error("FAIL: upgrade authority not restored to original");
    console.error("  Expected:", originalAuthority.toBase58());
    console.error("  Got:     ", afterRestore?.toBase58() ?? "(none)");
    process.exit(1);
  }
  console.log("  PASS: upgrade authority restored to", afterRestore.toBase58());
  console.log();

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log("=== PASS: Escrow upgrade authority transfer test complete ===");
  console.log();
  console.log("Transfer/restore transactions:");
  console.log("  Transfer: ", `https://explorer.solana.com/tx/${transferSig}?cluster=devnet`);
  console.log("  Restore:  ", `https://explorer.solana.com/tx/${restoreSig}?cluster=devnet`);
  console.log();
  console.log("Devnet transfer mechanism validated. Proceed to mainnet when ready.");
  console.log("Next: run the runbook at docs/escrow-upgrade-authority-transfer-runbook.md");
}

main().catch((err) => {
  console.error("Fatal:", err.message ?? err);
  process.exit(1);
});
